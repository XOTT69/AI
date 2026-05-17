export const config = {
  runtime: "edge"
};

const MODEL_REGISTRY = {
  auto: {
    provider: "auto",
    model: "auto"
  },

  "groq/llama-3.3-70b-versatile": {
    provider: "groq",
    model: "llama-3.3-70b-versatile"
  },

  "gemini/gemini-2.5-flash": {
    provider: "gemini",
    model: "gemini-2.5-flash"
  },

  "meta/llama-3.3-70b-instruct": {
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct"
  },

  "qwen/qwen3-coder": {
    provider: "openrouter",
    model: "qwen/qwen3-coder"
  },

  "google/gemma-3-27b-it": {
    provider: "openrouter",
    model: "google/gemma-3-27b-it"
  },

  "meta/llama-3.2-90b-vision-instruct": {
    provider: "openrouter",
    model: "meta-llama/llama-3.2-90b-vision-instruct"
  },

  "cerebras/llama-3.1-70b": {
    provider: "cerebras",
    model: "llama3.1-70b"
  },

  "mistral/mistral-large": {
    provider: "mistral",
    model: "mistral-large-latest"
  },

  "mistral/codestral": {
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

function hasImage(messages = []) {
  return messages.some((m) => {
    if (!Array.isArray(m.content)) return false;
    return m.content.some((part) => part?.type === "image_url");
  });
}

function extractText(messages = []) {
  return messages
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((part) => (part?.type === "text" ? part.text || "" : ""))
          .join(" ");
      }
      return "";
    })
    .join("\n")
    .toLowerCase();
}

function chooseAutoModel(messages = []) {
  const text = extractText(messages);
  const image = hasImage(messages);

  if (image) {
    return {
      provider: "gemini",
      model: "gemini-2.5-flash"
    };
  }

  const codeHints = [
    "code", "js", "javascript", "typescript", "node", "sql", "regex", "json",
    "api", "bug", "error", "fix", "debug", "worker", "cloudflare", "vercel",
    "deploy", "schema", "database", "frontend", "backend", "react", "next"
  ];

  const hardReasoningHints = [
    "architecture", "архітект", "migration", "strategy", "compare", "порівняй",
    "design", "analysis", "аналіз", "tradeoff", "scalability", "оптиміза"
  ];

  if (codeHints.some((x) => text.includes(x))) {
    return {
      provider: "mistral",
      model: "codestral-latest"
    };
  }

  if (text.length > 3000 || hardReasoningHints.some((x) => text.includes(x))) {
    return {
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct"
    };
  }

  return {
    provider: "github",
    model: "gpt-4o-mini"
  };
}

function normalizeMessages(messages = []) {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return {
        role: m.role,
        content: m.content
      };
    }

    if (Array.isArray(m.content)) {
      return {
        role: m.role,
        content: m.content.map((part) => {
          if (part.type === "image_url") {
            return {
              type: "image_url",
              image_url: {
                url: part?.image_url?.url || ""
              }
            };
          }

          return {
            type: "text",
            text: part?.text || ""
          };
        })
      };
    }

    return {
      role: m.role,
      content: ""
    };
  });
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  };
}

async function readError(res) {
  const txt = await res.text().catch(() => "");
  try {
    return JSON.parse(txt);
  } catch {
    return txt || `HTTP ${res.status}`;
  }
}

async function fetchGroq(messages, body) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: body.modelResolved,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 4096,
      top_p: body.top_p ?? 0.9,
      stream: true
    })
  });
}

async function fetchOpenRouter(messages, body) {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.FRONTEND_URL || "https://vercel.app",
      "X-Title": "AI Chat"
    },
    body: JSON.stringify({
      model: body.modelResolved,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 4096,
      top_p: body.top_p ?? 0.9,
      stream: true
    })
  });
}

async function fetchCerebras(messages, body) {
  return fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`
    },
    body: JSON.stringify({
      model: body.modelResolved,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 4096,
      stream: true
    })
  });
}

async function fetchMistral(messages, body) {
  return fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`
    },
    body: JSON.stringify({
      model: body.modelResolved,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 4096,
      stream: true
    })
  });
}

async function fetchGitHub(messages, body) {
  return fetch("https://models.inference.ai.azure.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GITHUB_MODELS_TOKEN}`
    },
    body: JSON.stringify({
      model: body.modelResolved,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 4096,
      stream: true
    })
  });
}

async function fetchGemini(messages, body) {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts = [];

      if (typeof m.content === "string") {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === "text") {
            parts.push({ text: part.text || "" });
          } else if (part.type === "image_url") {
            const dataUrl = part?.image_url?.url || "";
            const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
            if (match) {
              parts.push({
                inline_data: {
                  mime_type: match[1],
                  data: match[2]
                }
              });
            }
          }
        }
      }

      return {
        role: m.role === "assistant" ? "model" : "user",
        parts
      };
    });

  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${body.modelResolved}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: systemText
          ? { parts: [{ text: systemText }] }
          : undefined,
        contents,
        generationConfig: {
          temperature: body.temperature ?? 0.2,
          topP: body.top_p ?? 0.9,
          maxOutputTokens: body.max_tokens ?? 4096
        }
      })
    }
  );
}

async function handleOpenAICompatible(fetcher, messages, body) {
  const res = await fetcher(messages, body);

  if (!res.ok) {
    const err = await readError(res);
    return new Response(
      JSON.stringify({
        error: "Provider error",
        details: err
      }),
      {
        status: res.status,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return new Response(res.body, {
    status: 200,
    headers: sseHeaders()
  });
}

async function handleGemini(messages, body) {
  const res = await fetchGemini(messages, body);

  if (!res.ok) {
    const err = await readError(res);
    return new Response(
      JSON.stringify({
        error: "Gemini error",
        details: err
      }),
      {
        status: res.status,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body.getReader();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const lines = event.split("\n").filter(Boolean);

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const parsed = JSON.parse(raw);
              const text =
                parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

              if (text) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      choices: [{ delta: { content: text } }]
                    })}\n\n`
                  )
                );
              }
            } catch {}
          }
        }
      }

      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: sseHeaders()
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json();
    const incomingModel = body.model || "auto";
    const messages = normalizeMessages(body.messages || []);

    const selected =
      incomingModel === "auto"
        ? chooseAutoModel(messages)
        : MODEL_REGISTRY[incomingModel];

    if (!selected) {
      return new Response(JSON.stringify({ error: "Unsupported model" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const requestBody = {
      ...body,
      modelResolved: selected.model
    };

    if (selected.provider === "gemini") {
      return handleGemini(messages, requestBody);
    }

    if (selected.provider === "groq") {
      return handleOpenAICompatible(fetchGroq, messages, requestBody);
    }

    if (selected.provider === "openrouter") {
      return handleOpenAICompatible(fetchOpenRouter, messages, requestBody);
    }

    if (selected.provider === "cerebras") {
      return handleOpenAICompatible(fetchCerebras, messages, requestBody);
    }

    if (selected.provider === "mistral") {
      return handleOpenAICompatible(fetchMistral, messages, requestBody);
    }

    if (selected.provider === "github") {
      return handleOpenAICompatible(fetchGitHub, messages, requestBody);
    }

    return new Response(JSON.stringify({ error: "Auto selection failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Server error",
        details: error?.message || "Unknown error"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
