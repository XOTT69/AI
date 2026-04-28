export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  
  const { message } = req.body;
  if (!message || !message.text) return res.status(200).send('OK');

  const chatId = message.chat.id;
  const userText = message.text;
  
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const GROQ_KEY = process.env.GROQ_API_KEY; // Тепер використовуємо ключ Groq
  
  // Змінні для історії розмови
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  // Відправляємо статус "друкує..."
  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});

  try {
    let history = [];
    
    // 1. Читаємо попередню історію з бази даних
    if (KV_URL && KV_TOKEN) {
      const getReq = await fetch(`${KV_URL}/get/chat_${chatId}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const kvData = await getReq.json();
      if (kvData.result) {
        history = JSON.parse(kvData.result);
      }
    }

    // Залишаємо останні 10 повідомлень
    if (history.length > 10) history = history.slice(-10);
    
    // Додаємо нове повідомлення користувача
    history.push({ role: "user", content: userText });

    // 2. Відправляємо запит до GROQ
    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // Одна з найпотужніших моделей Groq
        messages: [
          { role: "system", content: "Ти розумний і корисний AI-асистент. Відповідай українською мовою лаконічно та по суті." },
          ...history
        ]
      })
    });

    const aiData = await aiResponse.json();
    let replyText = "";

    if (aiData.error) {
      replyText = `⚠️ Помилка Groq:\n${aiData.error.message || JSON.stringify(aiData.error)}`;
    } else if (aiData.choices && aiData.choices.length > 0) {
      replyText = aiData.choices[0].message.content;
      
      // Додаємо відповідь ШІ в історію
      history.push({ role: "assistant", content: replyText });

      // 3. Зберігаємо історію назад у базу даних
      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(JSON.stringify(history)) // Подвійна стрінгіфікація для Upstash
        });
      }
    } else {
      replyText = `❓ Невідома відповідь:\n${JSON.stringify(aiData).substring(0, 200)}`;
    }

    // Відправляємо відповідь користувачу в Telegram
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: replyText })
    });

  } catch (error) {
    console.error("Помилка сервера:", error);
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `🚨 Системна помилка: ${error.message}` })
    });
  }

  return res.status(200).send('OK');
}
