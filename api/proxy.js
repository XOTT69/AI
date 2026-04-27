export const config = {
  runtime: "nodejs"
};

function json(res, status, data) {
  return res.status(status).json(data);
}

// 1. Карта моделей для NVIDIA
const NVIDIA_MODEL_MAP = {
  "google/gemma-3-27b-it": "google/gemma-3-27b-it",
  "meta/llama-3.2-90b-vision-instruct": "meta/llama-3.2-90b-vision-instruct",
  "meta/llama-3.3-70b-instruct": "meta/llama-3.3-70b-instruct"
};

// 2. Карта моделей для OpenRouter (щоб точно працювало)
const OPENROUTER_MODEL_MAP = {
  "qwen/qwen3.5-122b-a10b": "qwen/qwen-2.5-72b-instruct", // Замінив на стабільний Qwen, бо 122b-a10b міг зникнути
  "abacusai/dracarys-llama-3.1-70b-instruct": "abacusai/dracarys-llama-3.1-70b-instruct" 
};

function getProviderConfig(model) {
  if (!model || typeof model !== "string") {
    throw new Error("Model is required");
  }

  // GROQ
  if (model.startsWith("groq/")) {
    return {
      provider: "groq",
      apiKey: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: model.replace(/^groq\//, "")
    };
  }

  // GEMINI
  if (model.startsWith("gemini/")) {
    return {
      provider: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: model.replace(/^gemini\//, "")
    };
  }

  // OPENROUTER
  if (OPENROUTER_MODEL_MAP[model]) {
    return {
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: OPENROUTER_MODEL_MAP[model] 
    };
  }

  // NVIDIA
  if (NVIDIA_MODEL_MAP[model]) {
    return {
      provider: "nvidia",
      apiKey: process.env.NVIDIA_API_KEY,
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: NVIDIA_MODEL_MAP[model]
    };
  }

  throw new Error(`Модель не підтримується цим proxy: ${model}`);
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(m => m && typeof m === "object" && m.role)
    .map(m => {
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: m.content
            .filter(part => part && typeof part === "object")
            .map(part => {
              if (part.type === "text") {
                return {
                  type: "text",
                  text: typeof part.text === "string" ? part.text : ""
                };
              }
              if (part.type === "image_url" && part.image_url?.url) {
                return {
                  type: "image_url",
                  image_url: {
                    url: part.image_url.url
                  }
                };
              }
              return null;
            })
            .filter(Boolean)
        };
      }
      return {
        role: m.role,
        content: typeof m.content === "string" ? m.content : ""
      };
    });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const {
      model,
      messages,
      temperature = 0.2,
      max_tokens = 1024,
      top_p = 0.9,
      stream = true
    } = req.body || {};

    if (!model) {
      return json(res, 400, { error: "Missing model" });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return json(res, 400, { error: "Missing messages" });
    }

    const cfg = getProviderConfig(model);

    if (!cfg.apiKey) {
      return json(res, 500, {
        error: `Missing API key for provider: ${cfg.provider}`
      });
    }

    const cleanMessages = sanitizeMessages(messages);

    const payload = {
      model: cfg.model,
      messages: cleanMessages,
      temperature,
      top_p,
      stream
    };

    // OpenRouter вимагає заголовок HTTP-Referer
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`
    };
    
    if (cfg.provider === "openrouter") {
       headers["HTTP-Referer"] = "https://ai-chat.com"; 
       headers["X-Title"] = "AI Chat";
    }

    if (cfg.provider === "groq") {
      payload.max_completion_tokens = max_tokens;
    } else {
      payload.max_tokens = max_tokens;
    }

    const upstream = await fetch(cfg.url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => "");
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (_) {}

      return json(res, upstream.status, {
        error: parsed?.error || raw || `Upstream error ${upstream.status}`,
        provider: cfg.provider,
        model: cfg.model,
        details: raw
      });
    }

    if (!stream) {
      const data = await upstream.json();
      return res.status(200).json(data);
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    });

    if (!upstream.body) {
      res.write(`data: ${JSON.stringify({ error: { message: "Empty upstream body" } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (error) {
    return json(res, 500, {
      error: error?.message || "Internal server error"
    });
  }
}
