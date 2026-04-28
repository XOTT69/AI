import pdfParse from 'pdf-parse';

export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  
  const { message } = req.body;
  if (!message) return res.status(200).send('OK');

  const chatId = message.chat.id;
  
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const GROQ_KEY = process.env.GROQ_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY; // Ключ для розпізнавання фото
  
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});

  try {
    let userText = message.text || message.caption || "Що зображено на цьому фото?";
    
    // --- ОБРОБКА КОМАНД ---
    if (userText.trim() === '/start' || userText.trim() === '/help') {
      const helpText = `👋 **Привіт! Я твій універсальний AI-помічник.**\n\n` +
                       `**Що я вмію:**\n` +
                       `• Писати тексти і спілкуватися 📝 (через Llama 3.3)\n` +
                       `• Розпізнавати **фотографії** 🖼️ (через Gemini)\n` +
                       `• Читати **PDF-документи** та текстові файли (.txt, код) 📄\n` +
                       `• Пам'ятати контекст розмови 🧠\n\n` +
                       `🧹 /clear — Очистити пам'ять і почати з чистого аркуша.`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: helpText, parse_mode: 'Markdown' })
      });
      return res.status(200).send('OK');
    }

    if (userText.trim() === '/clear') {
      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify([]) 
        });
      }
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: "🧹 **Історію очищено!**", parse_mode: 'Markdown' })
      });
      return res.status(200).send('OK');
    }

    // --- ЧИТАННЯ ІСТОРІЇ (Спільна для тексту і фото) ---
    let history = [];
    if (KV_URL && KV_TOKEN) {
      try {
        const getReq = await fetch(`${KV_URL}/get/chat_${chatId}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
        const kvData = await getReq.json();
        if (kvData.result) {
          let parsed = JSON.parse(kvData.result);
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          if (Array.isArray(parsed)) history = parsed;
        }
      } catch (e) { history = []; }
    }
    if (history.length > 30) history = history.slice(-30);

    let replyText = "";

    // ==========================================
    // ЛОГІКА ДЛЯ ФОТО (GEMINI API)
    // ==========================================
    if (message.photo && message.photo.length > 0) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();
      
      if (fileData.ok) {
        const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`);
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString('base64');
        
        // Відправляємо запит до Gemini
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: `Ти професійний AI-асистент. Відповідай українською. Запитання: ${userText}` },
                { inline_data: { mime_type: "image/jpeg", data: base64Image } }
              ]
            }]
          })
        });

        const geminiData = await geminiResponse.json();
        
        if (geminiData.error) {
          replyText = `⚠️ Помилка Gemini: ${geminiData.error.message}`;
        } else if (geminiData.candidates && geminiData.candidates.length > 0) {
          replyText = geminiData.candidates[0].content.parts[0].text;
          // Зберігаємо в історію тільки текстовий опис
          history.push({ role: "user", content: `[Надіслано фото]: ${userText}` });
        } else {
          replyText = "❓ Не вдалося розпізнати фото.";
        }
      }
    } 
    // ==========================================
    // ЛОГІКА ДЛЯ ТЕКСТУ ТА PDF (GROQ API)
    // ==========================================
    else {
      let fileTextContext = "";

      // Читання PDF або TXT
      if (message.document) {
        const doc = message.document;
        const mime = doc.mime_type || "";
        const fileName = doc.file_name?.toLowerCase() || "";
        
        if (doc.file_size < 10000000) {
          const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${doc.file_id}`);
          const fileData = await fileRes.json();
          if (fileData.ok) {
            const docRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`);
            const arrayBuffer = await docRes.arrayBuffer();

            if (mime === "application/pdf" || fileName.endsWith('.pdf')) {
              const pdfData = await pdfParse(Buffer.from(arrayBuffer));
              fileTextContext = `\n\n--- Зміст PDF "${doc.file_name}" ---\n${pdfData.text}\n-------------------`;
            } 
            else if (mime.startsWith("text/") || fileName.endsWith('.txt') || fileName.endsWith('.js') || fileName.endsWith('.csv')) {
              fileTextContext = `\n\n--- Зміст файлу "${doc.file_name}" ---\n${Buffer.from(arrayBuffer).toString('utf-8')}\n-------------------`;
            } 
            else {
              replyText = "⚠️ Розумію тільки PDF, TXT та картинки.";
            }
            if (fileTextContext) userText += fileTextContext;
          }
        } else {
          replyText = "⚠️ Файл завеликий (ліміт 10 МБ).";
        }
      }

      // Якщо це був текст або успішно прочитаний документ, йдемо в Groq
      if (!replyText) {
        history.push({ role: "user", content: userText });

        const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            temperature: 0.3,
            messages: [
              { role: "system", content: "Ти професійний AI-асистент. Спілкуйся виключно грамотною українською мовою без китайських символів." },
              ...history
            ]
          })
        });

        const aiData = await aiResponse.json();
        
        if (aiData.error) {
          replyText = `⚠️ Помилка Groq: ${aiData.error.message}`;
        } else if (aiData.choices && aiData.choices.length > 0) {
          replyText = aiData.choices[0].message.content;
        } else {
          replyText = "❓ Невідома відповідь сервера.";
        }
      }
    }

    // --- ЗБЕРЕЖЕННЯ ІСТОРІЇ ТА ВІДПРАВКА ---
    if (replyText && !replyText.includes("⚠️")) {
      history.push({ role: "assistant", content: replyText });
      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(history) 
        });
      }
    }

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: replyText || "Помилка обробки", parse_mode: 'Markdown' })
    });

  } catch (error) {
    console.error("Помилка:", error);
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: `🚨 Помилка: ${error.message}` })
    });
  }
  return res.status(200).send('OK');
}
