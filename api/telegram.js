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
  const GROQ_KEY = process.env.GROQ_API_KEY;
  
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});

  try {
    // Якщо користувач написав /clear
    if (userText.trim() === '/clear') {
      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([]) 
        });
      }
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: "🧹 Історію розмови очищено! Починаємо з чистого аркуша." })
      });
      return res.status(200).send('OK');
    }

    let history = [];
    
    // Читаємо історію
    if (KV_URL && KV_TOKEN) {
      try {
        const getReq = await fetch(`${KV_URL}/get/chat_${chatId}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        const kvData = await getReq.json();
        
        if (kvData.result) {
          let parsed = JSON.parse(kvData.result);
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          if (Array.isArray(parsed)) history = parsed;
        }
      } catch (e) {
        console.error("Помилка читання історії:", e);
        history = [];
      }
    }

    // ЗБІЛЬШЕНА ПАМ'ЯТЬ: тепер зберігаємо останні 30 повідомлень (15 пар питань-відповідей)
    if (history.length > 30) history = history.slice(-30);
    history.push({ role: "user", content: userText });

    // Запит до GROQ
    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3, // Робимо її менш "творчою", щоб уникнути появи ієрогліфів
        messages: [
          { 
            role: "system", 
            content: "Ти професійний AI-асистент. Спілкуйся виключно грамотною українською мовою. КАТЕГОРИЧНО заборонено використовувати китайські ієрогліфи або інші нетипові символи. Формуй речення чітко та логічно." 
          },
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
      
      history.push({ role: "assistant", content: replyText });

      // Зберігаємо історію
      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(history) 
        });
      }
    } else {
      replyText = `❓ Невідома відповідь:\n${JSON.stringify(aiData).substring(0, 200)}`;
    }

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
