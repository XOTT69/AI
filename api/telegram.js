export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  
  const { message } = req.body;
  if (!message) return res.status(200).send('OK');

  const chatId = message.chat.id;
  
  // Витягуємо текст або підпис до фото/документа
  const userText = message.text || message.caption || "Що ти бачиш на цьому фото?";
  
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
    // --- ОБРОБКА КОМАНД ---
    if (userText.trim() === '/start' || userText.trim() === '/help') {
      const helpText = `👋 **Привіт! Я твій універсальний AI-помічник.**\n\n` +
                       `Я працюю на базі потужних моделей Llama 3.\n\n` +
                       `**Що я вмію:**\n` +
                       `• Відповідати на питання і писати тексти 📝\n` +
                       `• **Розпізнавати фотографії!** (Просто надішли мені фото і запитай щось) 🖼️\n` +
                       `• Пам'ятати контекст нашої розмови 🧠\n\n` +
                       `**Команди:**\n` +
                       `🧹 /clear — Очистити пам'ять і почати нову розмову.`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: helpText, parse_mode: 'Markdown' })
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

    // --- РОБОТА З ФОТО (VISION) ---
    let base64Image = null;
    let targetModel = "llama-3.3-70b-versatile"; // Стандартна текстова модель

    if (message.photo && message.photo.length > 0) {
      // Беремо фото найкращої якості (останнє в масиві Telegram)
      const fileId = message.photo[message.photo.length - 1].file_id;
      
      // Отримуємо шлях до файлу
      const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();
      
      if (fileData.ok) {
        // Завантажуємо саме фото
        const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`);
        const arrayBuffer = await imgRes.arrayBuffer();
        
        // Перетворюємо у Base64 (формат, який розуміє ШІ)
        base64Image = Buffer.from(arrayBuffer).toString('base64');
        targetModel = "llama-3.2-90b-vision-preview"; // Перемикаємось на модель із "зором"
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

    // Зберігаємо текстовий варіант запиту в пам'ять бази даних (щоб фото не забивало базу)
    history.push({ role: "user", content: userText });

    // Формуємо фінальний запит для API (якщо є фото - додаємо його масив, якщо ні - просто текст)
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
          { role: "system", content: "Ти професійний AI-асистент. Спілкуйся виключно грамотною українською мовою. КАТЕГОРИЧНО заборонено використовувати китайські ієрогліфи або інші нетипові символи. Формуй речення чітко." },
          ...history.slice(0, -1), // Всі попередні повідомлення (тільки текст)
          currentApiMessage        // Поточне повідомлення (може містити картинку)
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
