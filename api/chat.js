const ALLOWED_MODELS = {
  "deepseek-ai/deepseek-v4-pro": {
    label: "DeepSeek V4 Pro — Найрозумніший",
    system: "Ти дуже сильний AI-помічник. Відповідай українською мовою, чітко, розумно, по суті, без води.",
    maxTokens: 900,
    temperature: 0.4
  },
  "deepseek-ai/deepseek-v3-2": {
    label: "DeepSeek V3.2 — Логіка і складні задачі",
    system: "Ти AI-помічник для складних задач, логіки, аналізу і reasoning. Відповідай українською, структуровано і точно.",
    maxTokens: 900,
    temperature: 0.4
  },
  "z-ai/glm4-7": {
    label: "GLM-5.1 — Агент і інструменти",
    system: "Ти AI-помічник, сильний у коді, інструментах, аналізі та агентних задачах. Відповідай українською, практично і чітко.",
    maxTokens: 700,
    temperature: 0.3
  },
  "mistralai/mistral-large-3-675b-instruct-2512": {
    label: "Mistral Large 3 — Сильний універсал",
    system: "Ти універсальний AI-помічник для чату, текстів, аналізу та ідей. Відповідай українською природно, розумно і стисло.",
    maxTokens: 700,
    temperature: 0.4
  },
  "mistralai/devstral-2-123b-instruct-2512": {
    label: "Devstral 2 — Найкращий для коду",
    system: "Ти AI-помічник для програмування. Допомагай з кодом, дебагом, архітектурою і поясненнями. Відповідай українською.",
    maxTokens: 800,
    temperature: 0.2
  },
  "deepseek-ai/deepseek-v4-flash": {
    label: "DeepSeek V4 Flash — Швидкий",
    system: "Ти швидкий AI-помічник. Відповідай українською коротко, чітко і корисно.",
    maxTokens: 450,
    temperature: 0.2
  },
  "bytedance/seed-oss-36b-instruct": {
    label: "Seed OSS 36B — Довгі тексти і контекст",
    system: "Ти AI-помічник для довгих текстів, великих контекстів, reasoning і загальних задач. Відповідай українською, структуровано.",
    maxTokens: 700,
    temperature: 0.3
  }
};

function trimMessages(messages, maxItems = 10) {
  return messages.slice(-maxItems);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.NVIDIA_API_KEY) {
      return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { messages, model, thinking, stream } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const selectedModel = ALLOWED_MODELS[model] ? model : "deepseek-ai/deepseek-v4-flash";
    const modelConfig = ALLOWED_MODELS[selectedModel];
    const recentMessages = trimMessages(messages, 10);

    const safeMessages = [
      {
        role: "system",
        content: `${modelConfig.system} ${thinking ? "detailed thinking on" : "detailed thinking off"}`
      },
      ...recentMessages
        .filter((m) =>
          m &&
          typeof m.content === "string" &&
          ["user", "assistant", "system"].includes(m.role)
        )
        .map((m) => ({
          role: m.role,
          content: m.content
        }))
    ];

    if (!stream) {
      const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: safeMessages,
          temperature: thinking ? 0.6 : modelConfig.temperature,
          top_p: 0.95,
          max_tokens: thinking ? Math.max(modelConfig.maxTokens, 900) : modelConfig.maxTokens,
          stream: false
        })
      });

      const raw = await upstream.text();

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: "NVIDIA upstream error",
          model: selectedModel,
          details: raw
        });
      }

      const data = JSON.parse(raw);
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        "";

      return res.status(200).json({
        content,
        model: selectedModel,
        label: modelConfig.label
      });
    }

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: safeMessages,
        temperature: thinking ? 0.6 : modelConfig.temperature,
        top_p: 0.95,
        max_tokens: thinking ? Math.max(modelConfig.maxTokens, 900) : modelConfig.maxTokens,
        stream: true
      })
    });

    if (!upstream.ok || !upstream.body) {
      const raw = await upstream.text();
      return res.status(upstream.status).json({
        error: "NVIDIA upstream error",
        model: selectedModel,
        details: raw
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.write(`data: ${JSON.stringify({ type: "meta", label: modelConfig.label })}\n\n`);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();

        if (payload === "[DONE]") {
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }

        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content || "";
          if (delta) {
            res.write(`data: ${JSON.stringify({ type: "content", content: delta })}\n\n`);
          }
        } catch (_) {
        }
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Function crashed",
        details: error?.message || String(error)
      });
    }

    try {
      res.write(`data: ${JSON.stringify({ type: "error", message: error?.message || "Streaming crashed" })}\n\n`);
      res.end();
    } catch (_) {
    }
  }
}
