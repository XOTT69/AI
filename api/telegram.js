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
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  // Відправляємо статус "друкує...", не чекаючи завершення
  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  }).catch(() => {});

  try {
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nim-chat.vercel.app", 
        "X-Title": "Telegram AI Bot"
      },
      body: JSON.stringify({
        // Використовуємо стабільну безкоштовну модель для тесту
        model: "google/gemini-2.0-flash-lite-preview-02-05:free", 
        messages: [{ role: "user", content: userText }]
      })
    });

    const aiData = await aiResponse.json();
    let replyText = "";

    // Перевіряємо, чи є помилка від OpenRouter
    if (aiData.error) {
      replyText = `⚠️ Помилка OpenRouter:\n${aiData.error.message || JSON.stringify(aiData.error)}`;
    } 
    // Перевіряємо, чи є успішна відповідь
    else if (aiData.choices && aiData.choices.length > 0) {
      replyText = aiData.choices[0].message.content;
    } 
    // Якщо прийшло щось незрозуміле
    else {
      replyText = `❓ Невідома структура відповіді:\n${JSON.stringify(aiData).substring(0, 200)}`;
    }

    // Відправляємо повідомлення в Telegram
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
      body: JSON.stringify({ chat_id: chatId, text: `🚨 Системна помилка Vercel: ${error.message}` })
    });
  }

  return res.status(200).send('OK');
}
