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
    let history = [];
    
    // 1. Отримуємо історію та виправляємо можливі помилки формату
    if (KV_URL && KV_TOKEN) {
      try {
        const getReq = await fetch(`${KV_URL}/get/chat_${chatId}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        const kvData = await getReq.json();
        
        if (kvData.result) {
          let parsed = JSON.parse(kvData.result);
          // Якщо історія випадково збереглася як текст (через минулий баг), розпаковуємо ще раз
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          // Якщо це дійсно масив, використовуємо його
          if (Array.isArray(parsed)) {
            history = parsed;
          }
        }
      } catch (e) {
        console.error("Помилка читання історії:", e);
        history = []; // Якщо база зламалася, починаємо з чистого аркуша
      }
    }

    if (history.length > 10) history = history.slice(-10);
    history.push({ role: "user", content: userText });

    // 2. Відправляємо запит до GROQ (з жорстким системним промптом для української)
    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { 
            role: "system", 
            content: "Ти розумний і корисний AI-асистент. Спілкуйся ВИКЛЮЧНО чистою та грамотною українською мовою, без вкраплень англійських слів. Відповідай лаконічно." 
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

      // 3. Зберігаємо історію правильним форматом (ОДИН JSON.stringify)
      if (KV_URL && KV_TOKEN) {
        await fetch(`${KV_URL}/set/chat_${chatId}`, {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
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
