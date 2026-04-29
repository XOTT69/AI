const WEBHOOK_PATH = "/webhook";
const REGISTER_PATH = "/registerWebhook";

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

  const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`;

  const resp = await fetch(tgUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      drop_pending_updates: true
    })
  });

  const data = await resp.text();
  return new Response(data, {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function handleUpdate(update, env) {
  try {
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const userText = message.text || message.caption || "";

    if (userText === "/start" || userText === "/help") {
      await sendMessage(env, chatId,
        "Привіт! Я AI-бот на Cloudflare Workers.\n\n" +
        "Що вмію:\n" +
        "- текстові відповіді\n" +
        "- авто-вибір AI моделі\n" +
        "- стабільніший webhook без Vercel timeout\n\n" +
        "/clear — очистити контекст"
      );
      return;
    }

    if (userText === "/clear") {
      await env.BOT_KV.delete(`history:${chatId}`);
      await sendMessage(env, chatId, "Історію очищено.");
      return;
    }

    await sendChatAction(env, chatId, "typing");

    const history = await getHistory(env, chatId);

    let replyText = "";

    if (message.photo && message.photo.length > 0) {
      replyText = await handlePhotoMessage(message, userText, env);
    } else {
      replyText = await handleTextMessage(userText, history, env);
    }

    if (!replyText) {
      replyText = "Не вдалося отримати відповідь.";
    }

    await saveHistory(env, chatId, userText || "[empty]", replyText);
    await sendMessage(env, chatId, replyText);
  } catch (error) {
    console.error("handleUpdate error:", error);
    try {
      const chatId = update?.message?.chat?.id;
      if (chatId) {
        await sendMessage(env, chatId, `Помилка: ${error.message}`);
      }
    } catch {}
  }
}

async function handleTextMessage(userText, history, env) {
  const text = (userText || "").trim();

  const isLong = text.length > 1200;
  const looksComplex =
    /pdf|файл|аналіз|проаналізуй|порівняй|детально|summary|summarize|code|код/i.test(text);

  if (isLong || looksComplex) {
    const geminiReply = await askGemini(text, history, env);
    if (geminiReply) return geminiReply;
  }

  const groqReply = await askGroq(text, history, env);
  if (groqReply) return groqReply;

  const openRouterReply = await askOpenRouter(text, history, env);
  if (openRouterReply) return openRouterReply;

  return "Не вдалося отримати відповідь від AI.";
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
    (userText && userText.trim())
      ? userText.trim()
      : "Опиши, що зображено на фото, українською мовою.";

  const geminiReply = await askGeminiVision(prompt, base64Image, env);
  if (geminiReply) return geminiReply;

  const openRouterReply = await askOpenRouterVision(prompt, base64Image, env);
  if (openRouterReply) return openRouterReply;

  return "Не вдалося розпізнати фото.";
}

async function askGroq(userText, history, env) {
  if (!env.GROQ_API_KEY) return null;

  const messages = [
    {
      role: "system",
      content: "Ти професійний AI-асистент. Відповідай грамотною українською мовою."
    },
    ...history,
    { role: "user", content: userText }
  ];

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      messages
    })
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function askGemini(userText, history, env) {
  if (!env.GEMINI_API_KEY) return null;

  const historyText = history
    .map(m => `${m.role === "assistant" ? "Асистент" : "Користувач"}: ${m.content}`)
    .join("\n");

  const prompt = `${historyText}\nКористувач: ${userText}\nАсистент:`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `Відповідай грамотною українською мовою.\n${prompt}` }
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

async function askOpenRouter(userText, history, env) {
  if (!env.OPENROUTER_API_KEY) return null;

  const messages = [
    {
      role: "system",
      content: "Ти професійний AI-асистент. Відповідай грамотною українською мовою."
    },
    ...history,
    { role: "user", content: userText }
  ];

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://workers.dev",
      "X-Title": "Telegram AI Worker Bot"
    },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages
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
              { text: `Відповідай українською. Запит: ${prompt}` },
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
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://workers.dev",
      "X-Title": "Telegram AI Worker Bot"
    },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Відповідай українською. Запит: ${prompt}` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
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

  const trimmed = history.slice(-40);
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
