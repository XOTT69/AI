const ALLOWED_MODELS = {
  "deepseek-ai/deepseek-v4-pro": {
    label: "DeepSeek V4 Pro — Найрозумніший",
    system: "Ти дуже сильний AI-помічник. Відповідай українською мовою, чітко, розумно, по суті, без води.",
    fast: { maxTokens: 900, temperature: 0.2 },
    smart: { maxTokens: 1800, temperature: 0.5 }
  },
  "deepseek-ai/deepseek-v3-2": {
    label: "DeepSeek V3.2 — Логіка і складні задачі",
    system: "Ти AI-помічник для складних задач, логіки, аналізу і reasoning. Відповідай українською, структуровано і точно.",
    fast: { maxTokens: 900, temperature: 0.2 },
    smart: { maxTokens: 1800, temperature: 0.5 }
  },
  "z-ai/glm4-7": {
    label: "GLM-4.7 — Агент і інструменти",
    system: "Ти AI-помічник, сильний у коді, інструментах, аналізі та агентних задачах. Відповідай українською, практично і чітко.",
    fast: { maxTokens: 900, temperature: 0.2 },
    smart: { maxTokens: 1500, temperature: 0.4 }
  },
  "z-ai/glm5.1": {
    label: "GLM-5.1 — Новий флагман",
    system: "Ти AI-помічник нового покоління, сильний в агентних задачах, коді, reasoning і довгих workflow. Відповідай українською, чітко, технічно і практично.",
    fast: { maxTokens: 1000, temperature: 0.2 },
    smart: { maxTokens: 2000, temperature: 0.45 }
  },
  "mistralai/mistral-large-3-675b-instruct-2512": {
    label: "Mistral Large 3 — Сильний універсал",
    system: "Ти універсальний AI-помічник для чату, текстів, аналізу та ідей. Відповідай українською природно, розумно і стисло.",
    fast: { maxTokens: 900, temperature: 0.2 },
    smart: { maxTokens: 1500, temperature: 0.4 }
  },
  "mistralai/devstral-2-123b-instruct-2512": {
    label: "Devstral 2 — Найкращий для коду",
    system: "Ти AI-помічник для програмування. Допомагай з кодом, дебагом, архітектурою і поясненнями. Відповідай українською.",
    fast: { maxTokens: 1000, temperature: 0.1 },
    smart: { maxTokens: 1600, temperature: 0.2 }
  },
  "deepseek-ai/deepseek-v4-flash": {
    label: "DeepSeek V4 Flash — Швидкий",
    system: "Ти швидкий AI-помічник. Відповідай українською коротко, чітко і корисно.",
    fast: { maxTokens: 700, temperature: 0.1 },
    smart: { maxTokens: 1200, temperature: 0.3 }
  },
  "bytedance/seed-oss-36b-instruct": {
    label: "Seed OSS 36B — Довгі тексти і контекст",
    system: "Ти AI-помічник для довгих текстів, великих контекстів, reasoning і загальних задач. Відповідай українською, структуровано.",
    fast: { maxTokens: 900, temperature: 0.2 },
    smart: { maxTokens: 1500, temperature: 0.4 }
  }
};

function trimMessages(messages, maxItems = 12) {
  return messages.slice(-maxItems);
}

function sendSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.NVIDIA_API_KEY) {
      return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});

    const {
      messages,
      model,
      thinking,
      stream,
      responseMode
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const selectedModel = ALLOWED_MODELS[model]
      ? model
      : "deepseek-ai/deepseek-v4-flash";

    const modelConfig = ALLOWED_MODELS[selectedModel];
    const recentMessages = trimMessages(messages, 12);
    const modeConfig =
      responseMode === "smart"
        ? modelConfig.smart
        : modelConfig.fast;

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

    const requestPayload = {
      model: selectedModel,
      messages: safeMessages,
      temperature: thinking
        ? Math.max(modeConfig.temperature, 0.5)
        : modeConfig.temperature,
      top_p: 0.95,
      max_tokens: thinking
        ? Math.max(modeConfig.maxTokens, 1400)
        : modeConfig.maxTokens,
      stream: Boolean(stream)
    };

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": stream ? "text/event-stream" : "application/json"
      },
      body: JSON.stringify(requestPayload)
    });

    if (!stream) {
      const raw = await upstream.text();

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: "NVIDIA upstream error",
          model: selectedModel,
          details: raw
        });
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(500).json({
          error: "Invalid JSON from NVIDIA",
          model: selectedModel,
          details: raw
        });
      }

      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        "";

      return res.status(200).json({
        content,
        model: selectedModel,
        label: modelConfig.label,
        finish_reason: data?.choices?.[0]?.finish_reason || null
      });
    }

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

    sendSSE(res, {
      type: "meta",
      label: modelConfig.label,
      model: selectedModel
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const lines = event.split("\n");
        let dataLines = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("data:")) {
            dataLines.push(trimmed.slice(5).trim());
          }
        }

        const payload = dataLines.join("");
        if (!payload) continue;

        if (payload === "[DONE]") {
          sendSSE(res, { type: "done" });
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }

        try {
          const json = JSON.parse(payload);
          const choice = json?.choices?.[0];
          const deltaContent = choice?.delta?.content ?? "";
          const deltaReasoning = choice?.delta?.reasoning ?? "";
          const finishReason = choice?.finish_reason ?? null;

          if (deltaContent) {
            sendSSE(res, {
              type: "content",
              content: deltaContent
            });
          }

          if (deltaReasoning) {
            sendSSE(res, {
              type: "reasoning",
              content: deltaReasoning
            });
          }

          if (finishReason) {
            sendSSE(res, {
              type: "finish",
              finish_reason: finishReason
            });
          }
        } catch {
        }
      }
    }

    sendSSE(res, { type: "done" });
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
      sendSSE(res, {
        type: "error",
        message: error?.message || "Streaming crashed"
      });
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch {}
  }
}
