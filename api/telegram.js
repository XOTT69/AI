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
  const GEMINI_KEY = process.env.GEMINI_API_KEY; 
  
  // Використовуємо змінні, які створив Vercel (як на твоєму скріншоті)
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});

  try {
    let history = [];
    
    // 1. Читаємо історію з бази даних
    if (KV_URL && KV_TOKEN) {
      // Звертаємося до REST API Upstash/Vercel KV
      const getReq = await fetch(`${KV_URL}/get/chat_${chatId}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const kvData = await getReq.json();
      
      // Якщо історія вже є, парсимо її
      if (kvData.result) {
        history = JSON.parse(kvData.result);
      }
    }

    // Залишаємо останні 10 повідомлень (5 пар питання-відповідь), щоб не переповнити пам'ять
    if (history.length > 10) history = history.slice(-10);
    
    // Додаємо нове повідомлення
    history.push({ role: "user", content: userText });

    // 2. Відправляємо запит до Gemini
    const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GEMINI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [
          { role: "system", content: "Ти розумний і корисний AI-асистент. Відповідай українською мовою." },
          ...history
        ]
      })
    });

    const aiData = await aiResponse.json();
    let replyText = "";

    if (aiData.error) {
      replyText = `⚠️ Помилка Gemini:\n${aiData.error.message || JSON.stringify(aiData.error)}`;
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
          body: JSON.stringify(JSON.stringify(history)) // Подвійна стрінгіфікація потрібна для Upstash REST API
        });
      }
    } else {
      replyText = `❓ Невідома відповідь:\n${JSON.stringify(aiData).substring(0, 200)}`;
    }

    // Відправляємо відповідь користувачу
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
