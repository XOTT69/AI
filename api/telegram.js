export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  // Telegram очікує 200 OK на всі запити, інакше буде дублювати повідомлення
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const { message } = req.body;
  if (!message || !message.text) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id;
  const userText = message.text;
  
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  // 1. Відправляємо в Telegram статус "Бот друкує..."
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  });

  try {
    // 2. Запит до OpenRouter (використовуємо стабільну модель з твого попереднього коду)
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nim-chat.vercel.app", 
        "X-Title": "Telegram AI Bot"
      },
      body: JSON.stringify({
        model: "qwen/qwen-2.5-72b-instruct:free", // Можеш змінити на іншу з твого списку
        messages: [{ role: "user", content: userText }],
        route: "fallback"
      })
    });

    const aiData = await aiResponse.json();
    const replyText = aiData.choices?.[0]?.message?.content || "Не вдалося отримати відповідь від моделі.";

    // 3. Відправляємо готову відповідь користувачу в Telegram
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText
      })
    });

  } catch (error) {
    console.error("Telegram Bot Error:", error);
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: "Виникла помилка на сервері під час обробки запиту." })
    });
  }

  return res.status(200).send('OK');
}
