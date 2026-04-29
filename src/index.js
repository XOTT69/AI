const WEBHOOK_PATH = "/webhook";
const REGISTER_PATH = "/registerWebhook";

const MEMORY_LIMIT = 400;
const CONTEXT_LIMIT = 40;

const PROMPTS = {
  general: `Ти розумний і корисний AI-асистент у Telegram.
Відповідай українською мовою.
Якщо питання просте — коротко. Якщо складне — розгорнуто.
Не вигадуй факти. Якщо не знаєш — скажи прямо.`,

  coding: `Ти сильний AI-помічник для програмування.
Завжди відповідай українською.
Якщо просять код:
1) спочатку дай ГОТОВИЙ код;
2) потім коротко поясни зміни;
Не давай теорію перед кодом.`,

  search: `Ти AI-асистент. Тобі надали результати веб-пошуку.
ТВОЄ ГОЛОВНЕ ПРАВИЛО: Відповідай ТІЛЬКИ на основі наданого тексту. 
Якщо в результатах немає точної відповіді (наприклад, немає прогнозу погоди для вказаного міста) — суворо заборонено вигадувати! Просто скажи: "На жаль, я не зміг знайти актуальну інформацію про це в інтернеті."
Наприкінці відповіді додай "Джерела:" і список посилань.`,

  vision: `Ти AI-асистент, який аналізує зображення. Відповідай українською.`
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
      await sendMessage(env, chatId, "👋 Привіт! Я AI-бот з доступом до інтернету.\n/clear — очистити пам'ять");
      return;
    }

    if (userText === "/clear") {
      if (env.BOT_KV) await env.BOT_KV.delete(`history:${chatId}`);
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
      replyText = "⚠️ Не вдалося отримати відповідь.";
    }

    await saveHistory(env, chatId, userText || "[empty]", replyText);
    await sendMessage(env, chatId, replyText);
  } catch (error) {
    console.error("handleUpdate error:", error);
    const chatId = update?.message?.chat?.id;
    if (chatId) await sendMessage(env, chatId, `🚨 Помилка: ${error.message}`);
  }
}

async function handleTextMessage(userText, history, env) {
  const text = (userText || "").trim();
  const mode = detectMode(text);

  // РЕЖИМ ПОШУКУ
  if (mode === "search") {
    // 1. Пробуємо Tavily
    const searchData = await searchWithTavily(text, env);
    if (searchData && searchData.results && searchData.results.length > 0) {
      const groundedReply = await answerFromSearchResults(text, searchData, env);
      if (groundedReply) return groundedReply;
    }

    // 2. Якщо Tavily не впорався (або нема ключа) — Пробуємо Gemini зі справжнім Google Search
    const geminiSearchReply = await askGeminiWithRealGoogleSearch(text, env);
    if (geminiSearchReply) return geminiSearchReply;
    
    return "На жаль, не зміг знайти актуальну інформацію з інтернету.";
  }

  // РЕЖИМ КОДУ
  if (mode === "coding") {
    const groqReply = await askGroq(text, history, env, PROMPTS.coding);
    if (groqReply) return groqReply;
    const geminiReply = await askGemini(text, history, env, PROMPTS.coding);
    if (geminiReply) return geminiReply;
    return askOpenRouter(text, history, env, PROMPTS.coding);
  }

  // ЗВИЧАЙНИЙ ЧАТ
  const isLong = text.length > 1200;
  if (isLong) {
    const geminiReply = await askGemini(text, history, env, PROMPTS.general);
    if (geminiReply) return geminiReply;
  }

  const groqReply = await askGroq(text, history, env, PROMPTS.general);
  if (groqReply) return groqReply;

  return askOpenRouter(text, history, env, PROMPTS.general);
}

function detectMode(text) {
  const t = text.toLowerCase();
  const looksLikeSearch = /знайди|пошукай|в інтернеті|в интернете|новини|актуально|сьогодні|сейчас|зараз|ціна|курс|погода/.test(t);
  const looksLikeCoding = /код|code|js|javascript|html|css|api|worker|vercel|cloudflare|node|npm|bug|пофікс|виправ|готовий код/.test(t);

  if (looksLikeSearch) return "search";
  if (looksLikeCoding) return "coding";
  return "general";
}

/* --- РОБОТА З ІНТЕРНЕТОМ --- */

async function searchWithTavily(query, env) {
  if (!env.TAVILY_API_KEY) return null;
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, search_depth: "advanced", max_results: 5 })
  });
  if (!resp.ok) return null;
  return await resp.json();
}

async function answerFromSearchResults(userText, searchData, env) {
  const results = searchData.results || [];
  if (results.length === 0) return null;

  const compactResults = results.map((r, i) => `${i + 1}. ${r.title}\nТекст: ${r.content}`).join("\n\n");
  const sourcesBlock = results.map(r => `- ${r.title}\n${r.url}`).join("\n");

  const prompt = `${PROMPTS.search}\n\nПитання: ${userText}\n\nЗнайдені дані:\n${compactResults}\n\nНаприкінці додай джерела:\n${sourcesBlock}`;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, // Низька температура, щоб не вигадував
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGeminiWithRealGoogleSearch(userText, env) {
  if (!env.GEMINI_API_KEY) return null;

  // ТУТ ВКЛЮЧАЄТЬСЯ СПРАВЖНІЙ GOOGLE SEARCH У GEMINI
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Ти шукаєш інформацію в інтернеті. Знайди і відповідай українською. Запит: ${userText}` }] }],
        tools: [{ googleSearch: {} }] // МАГІЯ ТУТ
      })
    }
  );

  if (!resp.ok) return null;
  const data = await resp.json();
  
  // Gemini сам повертає джерела у своїй структурі, або просто текст
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

/* --- ІНШІ ФУНКЦІЇ --- */

async function handlePhotoMessage(message, userText, env) { /* ... той самий код для фото ... */ 
  const photo = message.photo?.[message.photo.length - 1];
  if (!photo) return "Не вдалося прочитати фото.";
  const fileInfo = await tgApi(env, "getFile", { file_id: photo.file_id });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) return "Не вдалося отримати файл фото.";
  const imageResp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  const imageBuffer = await imageResp.arrayBuffer();
  const base64Image = arrayBufferToBase64(imageBuffer);
  const prompt = userText && userText.trim() ? userText.trim() : "Опиши фото українською.";
  
  const geminiReply = await askGeminiVision(prompt, base64Image, env);
  if (geminiReply) return geminiReply;
  return askOpenRouterVision(prompt, base64Image, env);
}

async function askGroq(userText, history, env, systemPrompt) {
  if (!env.GROQ_API_KEY) return null;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.35,
      messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userText }]
    })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGemini(userText, history, env, systemPrompt) {
  if (!env.GEMINI_API_KEY) return null;
  const historyText = history.map(m => `${m.role === "assistant" ? "Асистент" : "Користувач"}: ${m.content}`).join("\n");
  const prompt = `${systemPrompt}\n\nПопередній контекст:\n${historyText}\n\nЗапит:\n${userText}`;
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function askOpenRouter(userText, history, env, systemPrompt) {
  if (!env.OPENROUTER_API_KEY) return null;
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://workers.dev" },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userText }]
    })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGeminiVision(prompt, base64Image, env) {
  if (!env.GEMINI_API_KEY) return null;
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${PROMPTS.vision}\n\nЗапит: ${prompt}` }, { inline_data: { mime_type: "image/jpeg", data: base64Image } }] }]
    })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function askOpenRouterVision(prompt, base64Image, env) {
  if (!env.OPENROUTER_API_KEY) return null;
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://workers.dev" },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [{ role: "system", content: PROMPTS.vision }, { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }]
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
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
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
  return tgApi(env, "sendChatAction", { chat_id: chatId, action });
}

async function sendMessage(env, chatId, text) {
  const safeText = String(text || "").slice(0, 4000);
  return tgApi(env, "sendMessage", { chat_id: chatId, text: safeText });
}

async function tgApi(env, method, payload) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return resp.json();
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
