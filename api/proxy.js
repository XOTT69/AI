export const config = { runtime: "nodejs" };

function json(res, status, data) {
  return res.status(status).json(data);
}

const PROVIDER_MAP = {
  // Groq — ultra fast
  "groq/llama-3.3-70b-versatile":       { provider: "groq",       model: "llama-3.3-70b-versatile",             vision: false },
  "groq/llama-3.1-8b-instant":           { provider: "groq",       model: "llama-3.1-8b-instant",               vision: false },
  "groq/llama-3.2-11b-vision-preview":   { provider: "groq",       model: "llama-3.2-11b-vision-preview",       vision: true  },
  // Gemini
  "gemini/gemini-2.5-flash":              { provider: "gemini",     model: "gemini-2.5-flash",                   vision: true  },
  "gemini/gemini-2.5-pro":               { provider: "gemini",     model: "gemini-2.5-pro",                     vision: true  },
  // Cerebras — fastest inference
  "cerebras/llama-3.3-70b":              { provider: "cerebras",   model: "llama-3.3-70b",                      vision: false },
  "cerebras/llama-3.1-8b":               { provider: "cerebras",   model: "llama-3.1-8b",                       vision: false },
  // Mistral
  "mistral/mistral-large-latest":        { provider: "mistral",    model: "mistral-large-latest",               vision: false },
  "mistral/mistral-small-latest":        { provider: "mistral",    model: "mistral-small-latest",               vision: false },
  "mistral/codestral-latest":            { provider: "mistral",    model: "codestral-latest",                   vision: false },
  // GitHub Models
  "github/gpt-4o":                       { provider: "github",     model: "gpt-4o",                             vision: true  },
  "github/o4-mini":                      { provider: "github",     model: "o4-mini",                            vision: false },
  "github/phi-4":                        { provider: "github",     model: "Phi-4",                              vision: false },
  // NVIDIA
  "nvidia/llama-3.3-70b-instruct":       { provider: "nvidia",     model: "meta/llama-3.3-70b-instruct",       vision: false },
  "nvidia/llama-3.2-90b-vision":         { provider: "nvidia",     model: "meta/llama-3.2-90b-vision-instruct",vision: true  },
  "nvidia/gemma-3-27b":                  { provider: "nvidia",     model: "google/gemma-3-27b-it",             vision: true  },
  // OpenRouter
  "openrouter/deepseek-r1":              { provider: "openrouter", model: "deepseek/deepseek-r1",               vision: false },
  "openrouter/qwen-2.5-72b":             { provider: "openrouter", model: "qwen/qwen-2.5-72b-instruct",        vision: false },
};

function getProviderConfig(model) {
  const entry = PROVIDER_MAP[model];
  if (!entry) throw new Error(`Модель не підтримується: ${model}`);

  const configs = {
    groq:       { apiKey: process.env.GROQ_API_KEY,           url: "https://api.groq.com/openai/v1/chat/completions" },
    gemini:     { apiKey: process.env.GEMINI_API_KEY,         url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
    cerebras:   { apiKey: process.env.CEREBRAS_API_KEY,       url: "https://api.cerebras.ai/v1/chat/completions" },
    mistral:    { apiKey: process.env.MISTRAL_API_KEY,        url: "https://api.mistral.ai/v1/chat/completions" },
    github:     { apiKey: process.env.GITHUB_MODELS_TOKEN,    url: "https://models.inference.ai.azure.com/chat/completions" },
    nvidia:     { apiKey: process.env.NVIDIA_API_KEY,         url: "https://integrate.api.nvidia.com/v1/chat/completions" },
    openrouter: { apiKey: process.env.OPENROUTER_API_KEY,     url: "https://openrouter.ai/api/v1/chat/completions" },
  };

  const base = configs[entry.provider];
  if (!base) throw new Error(`Провайдер не налаштований: ${entry.provider}`);
  return { ...base, provider: entry.provider, model: entry.model, vision: entry.vision };
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
            .filter(p => p && typeof p === "object")
            .map(p => {
              if (p.type === "text") return { type: "text", text: String(p.text || "") };
              if (p.type === "image_url" && p.image_url?.url) return { type: "image_url", image_url: { url: p.image_url.url } };
              return null;
            })
            .filter(Boolean),
        };
      }
      return { role: m.role, content: typeof m.content === "string" ? m.content : "" };
    });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    const { model, messages, temperature = 0.5, max_tokens = 4096, top_p = 0.9, stream = true } = req.body || {};

    if (!model) return json(res, 400, { error: "Missing model" });
    if (!Array.isArray(messages) || !messages.length) return json(res, 400, { error: "Missing messages" });

    const cfg = getProviderConfig(model);
    if (!cfg.apiKey) return json(res, 500, { error: `Відсутній API ключ для: ${cfg.provider}` });

    const cleanMessages = sanitizeMessages(messages);
    const payload = { model: cfg.model, messages: cleanMessages, temperature, top_p, stream };

    if (cfg.provider === "groq") payload.max_completion_tokens = max_tokens;
    else payload.max_tokens = max_tokens;

    if (cfg.provider === "mistral") delete payload.top_p;

    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.apiKey}` };
    if (cfg.provider === "openrouter") {
      headers["HTTP-Referer"] = process.env.FRONTEND_URL || "https://ai.vercel.app";
      headers["X-Title"] = "AI Chat";
    }

    const upstream = await fetch(cfg.url, { method: "POST", headers, body: JSON.stringify(payload) });

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => "");
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (_) {}
      let message = parsed?.error?.message || parsed?.error || raw || `HTTP ${upstream.status}`;
      if (typeof message === "object") message = JSON.stringify(message);
      return json(res, upstream.status, { error: message, provider: cfg.provider, details: raw });
    }

    if (!stream) return res.status(200).json(await upstream.json());

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });

    if (!upstream.body) { res.write("data: [DONE]\n\n"); res.end(); return; }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (error) {
    return json(res, 500, { error: error?.message || "Internal server error" });
  }
}
