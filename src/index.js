const WEBHOOK_PATH = "/webhook";
const REGISTER_PATH = "/registerWebhook";

const MEMORY_LIMIT = 400;
const CONTEXT_LIMIT = 40;

const PROMPTS = {
  general: `Ти дуже розумний, уважний і корисний AI-асистент у Telegram.
Завжди відповідай грамотною, природною українською мовою.
Розумій намір користувача, а не лише буквальні слова.
Пояснюй по суті, без води, але достатньо повно.
Якщо питання просте — відповідай коротко.
Якщо питання складне — дай суть, потім пояснення і що робити далі.
Якщо користувач питає "що краще" — дай рекомендацію і коротко поясни чому.
Якщо запит нечіткий — постав одне коротке уточнювальне питання.
Не вигадуй фактів. Якщо не впевнений — так і скажи.
Тон: дружній, практичний, розумний.`,

  coding: `Ти сильний AI-помічник для програмування.
Завжди відповідай українською.
Якщо користувач просить код, виправлення, інтеграцію або готове рішення:
1) спочатку дай ГОТОВИЙ код або конкретне рішення;
2) потім коротко поясни, що саме зроблено;
3) не давай довгу теорію перед кодом;
4) якщо є найкращий практичний варіант — давай саме його.
Якщо користувач технічний — пиши по-діловому, без зайвої води.
Не вигадуй API, параметри чи можливості сервісів.`,

  search: `Ти AI-асистент із доступом до актуального веб-пошуку.
Відповідай українською.
Використай надані результати пошуку як основу відповіді.
Не вигадуй факти поза результатами пошуку.
Якщо є кілька джерел — узагальни коротко і ясно.
Наприкінці обов'язково додай блок "Джерела:" зі списком посилань.
Якщо даних недостатньо — прямо скажи про це.`,

  vision: `Ти AI-асистент, який аналізує зображення.
Відповідай українською, просто і зрозуміло.
Опиши, що видно на фото, а якщо користувач просить — зверни увагу на конкретні деталі.
Не вигадуй того, чого не видно або в чому не впевнений.`
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Telegram AI Worker bot is running");
    }

    if (request.method === "GET" && url.pathname === REGISTER_PATH) {
      return registerWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === WEBHOOK_PATH) {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await request.json();
      ctx.waitUntil(handleUpdate(update, env));

      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
};

async function registerWebhook(request, env) {
  const url = new URL(request.url);
  const webhookUrl = `${url.origin}${WEBHOOK_PATH}`;

  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      drop_pending_updates: true,
      allowed_updates: ["message"]
    })
  });

  const data = await resp.text();
  return new Response(data, {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function handleUpdate(update, env) {
  try {
    const message = update?.message;
    if (!message) return;

    const chatId = message.chat.id;
    let userText = (message.text || message.caption || "").trim();

    if (!userText && message.photo) {
      userText = "Опиши, що на фото.";
    }

    if (userText === "/start" || userText === "/help") {
      await sendMessage(
        env,
        chatId,
        "👋 Привіт! Я AI-бот.\n\n" +
          "Можу:\n" +
          "• відповідати як розумний помічник\n" +
          "• шукати актуальну інформацію в інтернеті\n" +
          "• допомагати з кодом\n" +
          "• аналізувати фото\n" +
          "• пам'ятати контекст розмови\n\n" +
          "Команди:\n" +
          "/clear — очистити пам'ять"
      );
      return;
    }

    if (userText === "/clear") {
      if (env.BOT_KV) {
        await env.BOT_KV.delete(`history:${chatId}`);
      }
      await sendMessage(env, chatId, "🧹 Історію очищено.");
      return;
    }

    await sendChatAction(env, chatId, "typing");

    const fullHistory = await getHistory(env, chatId);
    const recentContext = fullHistory.slice(-CONTEXT_LIMIT);

    let replyText = "";

    if (message.photo && message.photo.length > 0) {
      replyText = await handlePhotoMessage(message, userText, env);
    } else {
      replyText = await handleTextMessage(userText, recentContext, env);
    }

    if (!replyText) {
      replyText = "⚠️ Не вдалося отримати відповідь від AI.";
    }

    await saveHistory(env, chatId, userText || "[empty]", replyText);
    await sendMessage(env, chatId, replyText);
  } catch (error) {
    console.error("handleUpdate error:", error);
    const chatId = update?.message?.chat?.id;
    if (chatId) {
      await sendMessage(env, chatId, `🚨 Помилка: ${error.message}`);
    }
  }
}

async function handleTextMessage(userText, history, env) {
  const text = (userText || "").trim();

  const mode = detectMode(text);

  if (mode === "search") {
    const searchData = await searchWithTavily(text, env);
    if (searchData) {
      const groundedReply = await answerFromSearchResults(text, searchData, env);
      if (groundedReply) return groundedReply;
    }

    const geminiSearchReply = await askGeminiWithSearchFallback(text, env);
    if (geminiSearchReply) return geminiSearchReply;
  }

  if (mode === "coding") {
    const groqReply = await askGroq(text, history, env, PROMPTS.coding);
    if (groqReply) return groqReply;

    const geminiReply = await askGemini(text, history, env, PROMPTS.coding);
    if (geminiReply) return geminiReply;

    const openRouterReply = await askOpenRouter(text, history, env, PROMPTS.coding);
    if (openRouterReply) return openRouterReply;

    return null;
  }

  const isLong = text.length > 1200;
  const looksComplex =
    /аналіз|проаналізуй|порівняй|детально|summary|summarize|поясни|що краще|як краще|чому/i.test(text);

  if (isLong || looksComplex) {
    const geminiReply = await askGemini(text, history, env, PROMPTS.general);
    if (geminiReply) return geminiReply;
  }

  const groqReply = await askGroq(text, history, env, PROMPTS.general);
  if (groqReply) return groqReply;

  const openRouterReply = await askOpenRouter(text, history, env, PROMPTS.general);
  if (openRouterReply) return openRouterReply;

  return null;
}

function detectMode(text) {
  const t = text.toLowerCase();

  const looksLikeSearch =
    /знайди|пошукай|в інтернеті|в интернете|останні новини|актуально|сьогодні|сейчас|зараз|ціна|курс|погода|новини|новость|latest|news|current|official site|офіційний сайт/.test(t);

  const looksLikeCoding =
    /код|code|js|javascript|html|css|api|worker|vercel|cloudflare|node|npm|json|sql|bug|пофікс|виправ|готовий код|дай код|function|react|vue|telegram bot|бот|скрипт/.test(t);

  if (looksLikeSearch) return "search";
  if (looksLikeCoding) return "coding";
  return "general";
}

async function searchWithTavily(query, env) {
  if (!env.TAVILY_API_KEY) return null;

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      topic: "general",
      max_results: 5,
      include_answer: true,
      include_raw_content: false
    })
  });

  if (!resp.ok) return null;
  return await resp.json();
}

async function answerFromSearchResults(userText, searchData, env) {
  const results = Array.isArray(searchData?.results) ? searchData.results : [];
  const answer = searchData?.answer || "";

  if (!results.length && !answer) return null;

  const compactResults = results.slice(0, 5).map((r, i) => {
    return `${i + 1}. ${r.title || "Без назви"}
URL: ${r.url || ""}
Текст: ${r.content || ""}`;
  }).join("\n\n");

  const sourcesBlock = results
    .slice(0, 5)
    .map((r) => `- ${r.title || r.url}\n${r.url || ""}`)
    .join("\n");

  const prompt = `${PROMPTS.search}

Питання користувача:
${userText}

Коротка відповідь з пошуку, якщо є:
${answer}

Результати пошуку:
${compactResults}

Сформуй фінальну відповідь українською.
Наприкінці додай:

Джерела:
${sourcesBlock}`;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      messages: [
        { role: "system", content: PROMPTS.search },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!resp.ok) {
    const fallbackText =
      (answer ? `${answer}\n\n` : "") +
      "Джерела:\n" +
      results.slice(0, 5).map((r) => `- ${r.title || r.url}\n${r.url || ""}`).join("\n");
    return fallbackText || null;
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGeminiWithSearchFallback(userText, env) {
  if (!env.GEMINI_API_KEY) return null;

  const prompt =
    `${PROMPTS.search}\n\n` +
    `Якщо тобі бракує актуальності, дай максимально обережну відповідь і прямо скажи, що потрібна перевірка в джерелах.\n\n` +
    `Питання: ${userText}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function handlePhotoMessage(message, userText, env) {
  const photo = message.photo?.[message.photo.length - 1];
  if (!photo) return "Не вдалося прочитати фото.";

  const fileInfo = await tgApi(env, "getFile", { file_id: photo.file_id });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) return "Не вдалося отримати файл фото.";

  const imageResp = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`
  );
  const imageBuffer = await imageResp.arrayBuffer();
  const base64Image = arrayBufferToBase64(imageBuffer);

  const prompt =
    userText && userText.trim()
      ? userText.trim()
      : "Опиши, що зображено на фото, українською мовою, просто і зрозуміло.";

  const geminiReply = await askGeminiVision(prompt, base64Image, env);
  if (geminiReply) return geminiReply;

  const openRouterReply = await askOpenRouterVision(prompt, base64Image, env);
  if (openRouterReply) return openRouterReply;

  return null;
}

async function askGroq(userText, history, env, systemPrompt) {
  if (!env.GROQ_API_KEY) return null;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.35,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userText }
      ]
    })
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGemini(userText, history, env, systemPrompt) {
  if (!env.GEMINI_API_KEY) return null;

  const historyText = history
    .map((m) => `${m.role === "assistant" ? "Асистент" : "Користувач"}: ${m.content}`)
    .join("\n");

  const prompt =
    `${systemPrompt}\n\n` +
    `Попередній контекст:\n${historyText}\n\n` +
    `Нове повідомлення користувача:\n${userText}\n\n` +
    `Відповідь:`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function askOpenRouter(userText, history, env, systemPrompt) {
  if (!env.OPENROUTER_API_KEY) return null;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://workers.dev",
      "X-Title": "Telegram AI Worker"
    },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userText }
      ]
    })
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGeminiVision(prompt, base64Image, env) {
  if (!env.GEMINI_API_KEY) return null;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${PROMPTS.vision}\n\nЗапит користувача: ${prompt}` },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image
                }
              }
            ]
          }
        ]
      })
    }
  );

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function askOpenRouterVision(prompt, base64Image, env) {
  if (!env.OPENROUTER_API_KEY) return null;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://workers.dev",
      "X-Title": "Telegram AI Worker"
    },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [
        { role: "system", content: PROMPTS.vision },
        {
          role: "user",
          content: [
            { type: "text", text: `Запит користувача: ${prompt}` },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` }
            }
          ]
        }
      ]
    })
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function getHistory(env, chatId) {
  if (!env.BOT_KV) return [];
  const raw = await env.BOT_KV.get(`history:${chatId}`);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveHistory(env, chatId, userText, replyText) {
  if (!env.BOT_KV) return;

  const history = await getHistory(env, chatId);
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: replyText });

  const trimmed = history.slice(-MEMORY_LIMIT);
  await env.BOT_KV.put(`history:${chatId}`, JSON.stringify(trimmed));
}

async function sendChatAction(env, chatId, action) {
  return tgApi(env, "sendChatAction", {
    chat_id: chatId,
    action
  });
}

async function sendMessage(env, chatId, text) {
  const safeText = String(text || "").slice(0, 4000);
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: safeText
  });
}

async function tgApi(env, method, payload) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return resp.json();
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}
