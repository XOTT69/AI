export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  // Telegram вимагає статус 200, інакше повторюватиме запит
  if (req.method !== 'POST') return res.status(200).send('OK');
  
  const { message } = req.body;
  if (!message || !message.text) return res.status(200).send('OK');

  const chatId = message.chat.id;
  const userText = message.text;
  
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  // Відправляємо статус "друкує...", щоб бот не здавався завислим
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
        // Використовуємо актуальну безкоштовну Google Gemma
        model: "google/gemma-4-31b-it:free", 
        messages: [{ role: "user", content: userText }],
        route: "fallback" // Додаємо для стабільності на OpenRouter
      })
    });

    const aiData = await aiResponse.json();
    let replyText = "";

    // Обробка помилок та формування відповіді
    if (aiData.error) {
      replyText = `⚠️ Помилка OpenRouter:\n${aiData.error.message || JSON.stringify(aiData.error)}`;
    } else if (aiData.choices && aiData.choices.length > 0) {
      replyText = aiData.choices[0].message.content;
    } else {
      replyText = `❓ Невідома структура відповіді:\n${JSON.stringify(aiData).substring(0, 200)}`;
    }

    // Відправка фінального тексту в Telegram
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
