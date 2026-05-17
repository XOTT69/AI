export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const model = String(body.model || "auto");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const maxTokens = Number(body.max_tokens || 4096);

    if (!messages.length) {
      return res.status(400).json({ error: "messages are required" });
    }

    const normalized = normalizeMessages(messages);

    const result = await routeAndGenerate({
      model,
      messages: normalized,
      maxTokens,
      env: process.env
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("proxy error:", error);
    return res.status(500).json({
      error: error.message || "Proxy server error"
    });
  }
}

function normalizeMessages(messages) {
  return messages
    .filter(Boolean)
    .map((m) => {
      const role = String(m.role || "user");

      if (Array.isArray(m.content)) {
        const normalizedContent = m.content
          .map((part) => {
            if (!part || typeof part !== "object") return null;

            if (part.type === "text") {
              return {
                type: "text",
                text: String(part.text || "")
              };
            }

            if (part.type === "image_url") {
              const url =
                typeof part.image_url === "string"
                  ? part.image_url
                  : part.image_url?.url;

              if (!url) return null;

              return {
                type: "image_url",
                image_url: { url: String(url) }
              };
            }

            return null;
          })
          .filter(Boolean);

        return { role, content: normalizedContent };
      }

      return {
        role,
        content: String(m.content || "")
      };
    });
}

async function routeAndGenerate({ model, messages, maxTokens, env }) {
  if (model === "auto") {
    return autoRoute({ messages, maxTokens, env });
  }

  const direct = await tryDirectProvider({ model, messages, maxTokens, env });
  if (direct) return direct;

  const fallback = await tryOpenRouterFallback({ model, messages, maxTokens, env });
  if (fallback) return fallback;

  throw new Error(`No available provider for model: ${model}`);
}

async function autoRoute({ messages, maxTokens, env }) {
  const hasImage = containsImage(messages);

  const candidates = hasImage
    ? [
        "gemini/gemini-2.5-flash",
        "meta/llama-3.2-90b-vision-instruct",
        "google/gemma-3-27b-it",
        "github/gpt-4o-mini"
      ]
    : [
        "groq/llama-3.3-70b-versatile",
        "github/gpt-4o-mini",
        "mistral/mistral-large",
        "cerebras/llama-3.1-70b",
        "github/phi-4"
      ];

  for (const candidate of candidates) {
    try {
      const result = await tryDirectProvider({
        model: candidate,
        messages,
        maxTokens,
        env
      });
      if (result) return result;
    } catch (err) {
      console.warn("auto direct fail:", candidate, err.message);
    }

    try {
      const result = await tryOpenRouterFallback({
        model: candidate,
        messages,
        maxTokens,
        env
      });
      if (result) return result;
    } catch (err) {
      console.warn("auto fallback fail:", candidate, err.message);
    }
  }

  throw new Error("Auto routing failed for all providers");
}

function containsImage(messages) {
  return messages.some((m) =>
    Array.isArray(m.content) &&
    m.content.some((part) => part?.type === "image_url" && part?.image_url?.url)
  );
}

async function tryDirectProvider({ model, messages, maxTokens, env }) {
  if (model.startsWith("groq/") && env.GROQ_API_KEY) {
    const groqModel = model.replace(/^groq\//, "");
    return callOpenAICompat({
      provider: "groq",
      model: groqModel,
      apiKey: env.GROQ_API_KEY,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      headers: {},
      messages,
      maxTokens
    });
  }

  if (model.startsWith("mistral/") && env.MISTRAL_API_KEY) {
    const mistralModel = model.replace(/^mistral\//, "");
    return callOpenAICompat({
      provider: "mistral",
      model: mistralModel === "mistral-large" ? "mistral-large-latest" : mistralModel,
      apiKey: env.MISTRAL_API_KEY,
      endpoint: "https://api.mistral.ai/v1/chat/completions",
      headers: {},
      messages,
      maxTokens
    });
  }

  if (model.startsWith("cerebras/") && env.CEREBRAS_API_KEY) {
    const cerebrasModel = model.replace(/^cerebras\//, "");
    return callOpenAICompat({
      provider: "cerebras",
      model: cerebrasModel,
      apiKey: env.CEREBRAS_API_KEY,
      endpoint: "https://api.cerebras.ai/v1/chat/completions",
      headers: {},
      messages,
      maxTokens
    });
  }

  if ((model.startsWith("meta/") || model.startsWith("google/")) && env.NVIDIA_API_KEY) {
    const nimModel = model.replace(/^meta\//, "meta/").replace(/^google\//, "google/");
    return callOpenAICompat({
      provider: "nvidia",
      model: nimModel,
      apiKey: env.NVIDIA_API_KEY,
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      headers: {},
      messages,
      maxTokens
    });
  }

  if (model.startsWith("github/") && env.GITHUB_MODELS_TOKEN) {
    const ghModel = model.replace(/^github\//, "");
    return callOpenAICompat({
      provider: "github",
      model: mapGithubModel(ghModel),
      apiKey: env.GITHUB_MODELS_TOKEN,
      endpoint: "https://models.inference.ai.azure.com/chat/completions",
      headers: {},
      messages,
      maxTokens
    });
  }

  if (model.startsWith("gemini/") && env.GEMINI_API_KEY) {
    const geminiModel = model.replace(/^gemini\//, "");
    return callGemini({
      model: geminiModel,
      apiKey: env.GEMINI_API_KEY,
      messages,
      maxTokens
    });
  }

  return null;
}

function mapGithubModel(model) {
  const map = {
    "gpt-4o-mini": "gpt-4o-mini",
    "phi-4": "Phi-4",
    "gpt-4.1": "gpt-4.1",
    "gpt-4o": "gpt-4o"
  };
  return map[model] || model;
}

async function tryOpenRouterFallback({ model, messages, maxTokens, env }) {
  if (!env.OPENROUTER_API_KEY) return null;

  const mapped = mapToOpenRouterModel(model);
  if (!mapped) return null;

  return callOpenAICompat({
    provider: "openrouter",
    model: mapped,
    apiKey: env.OPENROUTER_API_KEY,
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": env.FRONTEND_URL || "https://vercel.app",
      "X-Title": "AI Chat"
    },
    messages,
    maxTokens
  });
}

function mapToOpenRouterModel(model) {
  const table = {
    "github/gpt-4o-mini": "openai/gpt-4o-mini",
    "github/phi-4": "microsoft/phi-4",
    "groq/llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct",
    "mistral/codestral": "mistralai/codestral-2501",
    "mistral/mistral-large": "mistralai/mistral-large",
    "gemini/gemini-2.5-flash": "google/gemini-2.5-flash",
    "meta/llama-3.3-70b-instruct": "meta-llama/llama-3.3-70b-instruct",
    "google/gemma-3-27b-it": "google/gemma-3-27b-it",
    "meta/llama-3.2-90b-vision-instruct": "meta-llama/llama-3.2-90b-vision-instruct",
    "cerebras/llama-3.1-70b": "meta-llama/llama-3.1-70b-instruct"
  };

  return table[model] || null;
}

async function callOpenAICompat({
  provider,
  model,
  apiKey,
  endpoint,
  headers,
  messages,
  maxTokens
}) {
  const payload = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...headers
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `${provider} error ${response.status}: ${data?.error?.message || data?.error || "Unknown error"}`
    );
  }

  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    "";

  if (!text) {
    throw new Error(`${provider} returned empty response`);
  }

  return {
    text,
    provider,
    model
  };
}

async function callGemini({ model, apiKey, messages, maxTokens }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = [];
  let systemInstruction = "";

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction += (typeof msg.content === "string" ? msg.content : "") + "\n";
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";

    if (Array.isArray(msg.content)) {
      const parts = msg.content.map((part) => {
        if (part.type === "text") {
          return { text: String(part.text || "") };
        }

        if (part.type === "image_url" && part.image_url?.url) {
          return {
            fileData: {
              mimeType: guessMimeFromUrl(part.image_url.url),
              fileUri: part.image_url.url
            }
          };
        }

        return null;
      }).filter(Boolean);

      contents.push({ role, parts });
    } else {
      contents.push({
        role,
        parts: [{ text: String(msg.content || "") }]
      });
    }
  }

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: maxTokens
    }
  };

  if (systemInstruction.trim()) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction.trim() }]
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `gemini error ${response.status}: ${data?.error?.message || "Unknown error"}`
    );
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("gemini returned empty response");
  }

  return {
    text,
    provider: "gemini",
    model
  };
}

function guessMimeFromUrl(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".gif")) return "image/gif";
  return "image/jpeg";
}
