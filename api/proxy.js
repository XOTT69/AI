export const config = {
  runtime: "nodejs"
};

function json(res, status, data) {
  return res.status(status).json(data);
}

const MODEL_REGISTRY = {
  "groq/llama-3.3-70b-versatile": {
    provider: "groq",
    model: "llama-3.3-70b-versatile"
  },

  "gemini/gemini-2.5-flash": {
    provider: "gemini",
    model: "gemini-2.5-flash"
  },

  "meta/llama-3.3-70b-instruct": {
    provider: "nvidia",
    model: "meta/llama-3.3-70b-instruct"
  },

  "google/gemma-3-27b-it": {
    provider: "nvidia",
    model: "google/gemma-3-27b-it"
  },

  "meta/llama-3.2-90b-vision-instruct": {
    provider: "nvidia",
    model: "meta/llama-3.2-90b-vision-instruct"
  },

  "qwen/qwen3.5-122b-a10b": {
    provider: "openrouter",
    model: "qwen/qwen-2.5-72b-instruct"
  },

  "cerebras/llama-3.3-70b": {
    provider: "cerebras",
    model: "llama-3.3-70b"
  },

  "mistral/mistral-large-latest": {
    provider: "mistral",
    model: "mistral-large-latest"
  },

  "mistral/codestral-latest": {
    provider: "mistral",
    model: "codestral-latest"
  },

  "github/gpt-4o-mini": {
    provider: "github",
    model: "gpt-4o-mini"
  },

  "github/phi-4": {
    provider: "github",
    model: "phi-4"
  }
};

const PROVIDERS = {
  groq: {
    envKey: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    mode: "openai"
  },
  gemini: {
    envKey: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    mode: "openai"
  },
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    mode: "openai"
  },
  nvidia: {
    envKey: "NVIDIA_API_KEY",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    mode: "openai"
  },
  cerebras: {
    envKey: "CEREBRAS_API_KEY",
    url: "https://api.cerebras.ai/v1/chat/completions",
    mode: "openai"
  },
  mistral: {
    envKey: "MISTRAL_API_KEY",
    url: "https://api.mistral.ai/v1/chat/completions",
    mode: "openai"
  },
  github: {
    envKey: "GITHUB_MODELS_TOKEN",
    url: "https://models.inference.ai.azure.com/chat/completions",
    mode: "openai"
  }
};

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((m) => m && typeof m === "object" && m.role)
    .map((m) => {
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: m.content
            .filter((part) => part && typeof part === "object")
            .map((part) => {
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

function resolveModelConfig(model) {
  if (!model || typeof model !== "string") {
    throw new Error("Model is required");
  }

  const config = MODEL_REGISTRY[model];
  if (!config) {
    throw new Error(`Модель не підтримується: ${model}`);
  }

  const providerMeta = PROVIDERS[config.provider];
  if (!providerMeta) {
    throw new Error(`Невідомий provider: ${config.provider}`);
  }

  const apiKey = process.env[providerMeta.envKey];
  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${config.provider}`);
  }

  return {
    provider: config.provider,
    model: config.model,
    url: providerMeta.url,
    apiKey
  };
}

function buildHeaders(provider, apiKey, req) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.FRONTEND_URL ||
      req.headers.origin ||
      "https://your-app.example";
    headers["X-Title"] = "AI Workspace";
  }

  if (provider === "github") {
    headers["api-key"] = apiKey;
    delete headers.Authorization;
  }

  return headers;
}

function buildPayload(provider, model, body) {
  const {
    messages,
    temperature = 0.2,
    max_tokens = 1024,
    top_p = 0.9,
    stream = true
  } = body || {};

  const payload = {
    model,
    messages,
    temperature,
    top_p,
    stream
  };

  if (provider === "groq") {
    payload.max_completion_tokens = max_tokens;
  } else {
    payload.max_tokens = max_tokens;
  }

  return payload;
}

async function maybeProxyToWorker(req, res, body) {
  const workerUrl = process.env.WORKER_PUBLIC_URL;
  const workerModels = (process.env.WORKER_MODEL_PREFIXES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!workerUrl || !body?.model || !workerModels.length) return false;

  const shouldUseWorker = workerModels.some((prefix) => body.model.startsWith(prefix));
  if (!shouldUseWorker) return false;

  const upstream = await fetch(`${workerUrl.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.WORKER_API_KEY ? { Authorization: `Bearer ${process.env.WORKER_API_KEY}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => "");
    return json(res, upstream.status, {
      error: "Worker upstream error",
      details: raw
    });
  }

  if (!body.stream) {
    const data = await upstream.json();
    return res.status(200).json(data);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  if (!upstream.body) {
    res.write(`data: ${JSON.stringify({ error: { message: "Empty worker body" } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return true;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(decoder.decode(value, { stream: true }));
  }

  res.end();
  return true;
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

    const cleanMessages = sanitizeMessages(messages);
    const cleanBody = {
      model,
      messages: cleanMessages,
      temperature,
      max_tokens,
      top_p,
      stream
    };

    const workerHandled = await maybeProxyToWorker(req, res, cleanBody);
    if (workerHandled) return;

    const cfg = resolveModelConfig(model);
    const headers = buildHeaders(cfg.provider, cfg.apiKey, req);
    const payload = buildPayload(cfg.provider, cfg.model, cleanBody);

    const upstream = await fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => "");
      let parsed = null;

      try {
        parsed = JSON.parse(raw);
      } catch {}

      let message =
        parsed?.error?.message ||
        parsed?.error ||
        parsed?.message ||
        raw ||
        `Upstream error ${upstream.status}`;

      if (typeof message === "object") {
        message = JSON.stringify(message);
      }

      return json(res, upstream.status, {
        error: message,
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
      Connection: "keep-alive"
    });

    if (!upstream.body) {
      res.write(`data: ${JSON.stringify({
        error: { message: "Empty upstream body" }
      })}\n\n`);
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
