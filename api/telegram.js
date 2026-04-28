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
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});

  try {
    let userText = message.text || message.caption || "Поясни цей файл або зображення.";
    
    // --- ОБРОБКА КОМАНД ---
    if (userText.trim() === '/start' || userText.trim() === '/help') {
      const helpText = `👋 **Привіт! Я твій універсальний AI-помічник.**\n\n` +
                       `**Що я вмію:**\n` +
                       `• Писати тексти і спілкуватися 📝\n` +
                       `• Розпізнавати **фотографії** 🖼️\n` +
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

    let base64Image = null;
    let targetModel = "llama-3.3-70b-versatile"; 
    let fileTextContext = "";

    // --- ОБРОБКА ФОТО ---
    if (message.photo && message.photo.length > 0) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();
      if (fileData.ok) {
        const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`);
        const arrayBuffer = await imgRes.arrayBuffer();
        base64Image = Buffer.from(arrayBuffer).toString('base64');
        
        // НОВА ОФІЦІЙНА МОДЕЛЬ ДЛЯ ЗОРУ
        targetModel = "llama-3.2-11b-vision-instruct"; 
      }
    }
    
    // --- ОБРОБКА ДОКУМЕНТІВ (PDF / TXT) ---
    else if (message.document) {
      const doc = message.document;
      const mime = doc.mime_type || "";
      const fileName = doc.file_name?.toLowerCase() || "";
      const fileSize = doc.file_size || 0;

      if (fileSize < 10000000) {
        const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${doc.file_id}`);
        const fileData = await fileRes.json();
        
        if (fileData.ok) {
          const docRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`);
          const arrayBuffer = await docRes.arrayBuffer();

          if (mime === "application/pdf" || fileName.endsWith('.pdf')) {
            const pdfBuffer = Buffer.from(arrayBuffer);
            const pdfData = await pdfParse(pdfBuffer);
            fileTextContext = `\n\n--- Зміст PDF-файлу "${doc.file_name}" ---\n${pdfData.text}\n-------------------`;
          } 
          else if (mime.startsWith("text/") || fileName.endsWith('.txt') || fileName.endsWith('.js') || fileName.endsWith('.html') || fileName.endsWith('.json') || fileName.endsWith('.csv')) {
            const textContent = Buffer.from(arrayBuffer).toString('utf-8');
            fileTextContext = `\n\n--- Зміст текстового файлу "${doc.file_name}" ---\n${textContent}\n-------------------`;
          } 
          else {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: "⚠️ Наразі я розумію тільки PDF, текстові файли (.txt, .js тощо) та картинки." })
            });
            return res.status(200).send('OK');
          }
          
          userText += fileTextContext;
        }
      } else {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: "⚠️ Цей файл завеликий. Будь ласка, надішліть файл до 10 МБ." })
        });
        return res.status(200).send('OK');
      }
    }

    // --- ЧИТАННЯ ІСТОРІЇ ---
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

    history.push({ role: "user", content: userText });

    const currentApiMessage = base64Image 
      ? { role: "user", content: [{ type: "text", text: userText }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }
      : { role: "user", content: userText };

    // --- ЗАПИТ ДО GROQ ---
    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: targetModel,
        temperature: 0.3,
        messages: [
          { role: "system", content: "Ти професійний AI-асистент. Спілкуйся виключно грамотною українською мовою. КАТЕГОРИЧНО заборонено використовувати китайські ієрогліфи або інші нетипові символи. Якщо користувач надсилає зміст файлу або фотографію, проаналізуй їх і дай відповідь на запитання." },
          ...history.slice(0, -1), 
          currentApiMessage        
        ]
      })
    });

    const aiData = await aiResponse.json();
    let replyText = "";

    if (aiData.error) {
      replyText = `⚠️ Помилка Groq:\n${aiData.error.message || JSON.stringify(aiData.error)}`;
    } else if (aiData.choices && aiData.choices.length > 0) {
      replyText = aiData.choices[0].message.content;
      history.push({ role: "assistant", content: replyText });

      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(history) 
        });
      }
    } else {
      replyText = `❓ Невідома відповідь:\n${JSON.stringify(aiData).substring(0, 200)}`;
    }

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: 'Markdown' })
    });

  } catch (error) {
    console.error("Помилка:", error);
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: `🚨 Помилка: ${error.message}` })
    });
  }
  return res.status(200).send('OK');
}
