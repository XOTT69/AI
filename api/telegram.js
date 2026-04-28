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
    // ------------------------------------
    // ОБРОБКА КОМАНД (Start, Help, Clear)
    // ------------------------------------
    
    // Команди /start або /help
    if (userText.trim() === '/start' || userText.trim() === '/help') {
      const helpText = `👋 **Привіт! Я твій особистий AI-помічник.**\n\n` +
                       `🧠 Я працюю на базі потужної моделі Llama 3.3 (70B) і розумію українську.\n\n` +
                       `**Що я вмію:**\n` +
                       `• Відповідати на будь-які питання\n` +
                       `• Писати тексти, код, ідеї\n` +
                       `• Пам'ятати контекст розмови (останні 30 повідомлень)\n\n` +
                       `**Корисні команди:**\n` +
                       `🧹 /clear — Очистити пам'ять. Використовуй це, коли хочеш змінити тему і почати розмову з чистого аркуша.`;
                       
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: helpText, parse_mode: 'Markdown' })
      });
      return res.status(200).send('OK');
    }

    // Команда /clear
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
        body: JSON.stringify({ chat_id: chatId, text: "🧹 **Історію розмови успішно очищено!** Починаємо з чистого аркуша.", parse_mode: 'Markdown' })
      });
      return res.status(200).send('OK');
    }

    // ------------------------------------
    // ОСНОВНА ЛОГІКА AI (Читання історії та запит)
    // ------------------------------------

    let history = [];
    
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

    if (history.length > 30) history = history.slice(-30);
    history.push({ role: "user", content: userText });

    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
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
      body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: 'Markdown' }) // Markdown для красивого форматування жирного тексту і списків
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
