const ALLOWED_MODELS = {
  "meta/llama-3.1-8b-instruct": {
    label: "Llama 3.1 8B — Швидкий",
    system: "Ти дуже швидкий AI-помічник. Відповідай українською мовою коротко і чітко.",
    fast: { maxTokens: 1500, temperature: 0.15 },
    smart: { maxTokens: 2500, temperature: 0.3 }
  },
  "meta/llama-3.3-70b-instruct": {
    label: "Llama 3.3 70B — Універсал",
    system: "Ти дуже сильний AI-помічник. Відповідай українською мовою, чітко, розумно і структуровано.",
    fast: { maxTokens: 2000, temperature: 0.3 },
    smart: { maxTokens: 4000, temperature: 0.5 }
  },
  "google/gemma-3-27b-it": {
    label: "Gemma 3 (27B) — Фото й OCR",
    system: [
      "Ти мультимодальний AI-помічник для точного OCR, аналізу фото, скрінів і документів.",
      "Відповідай українською.",
      "Не вигадуй факти, не домислюй невидимий текст, не повторюй блоки тексту."
    ].join(" "),
    fast: { maxTokens: 2000, temperature: 0.1 },
    smart: { maxTokens: 4000, temperature: 0.2 }
  },
  "abacusai/dracarys-llama-3.1-70b-instruct": {
    label: "Dracarys Llama (70B) — Код",
    system: "Ти AI-помічник експертного рівня для написання коду та аналітики. Відповідай українською.",
    fast: { maxTokens: 2000, temperature: 0.2 },
    smart: { maxTokens: 4000, temperature: 0.4 }
  }
};

function trimMessages(messages, maxItems = 10) {
  return messages.slice(-maxItems);
}

function sendSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildVisionPrompt(userText = "") {
  const text = String(userText || "").trim();
  return [
    text || "Опиши, що на цьому зображенні.",
    "Якщо на зображенні є текст, перепиши лише чітко видимий текст без вигадок."
  ].join("\n");
}

function normalizeMessagesForModel(recentMessages, modelConfig, selectedModel, image) {
  if (image?.dataUrl && selectedModel === "google/gemma-3-27b-it") {
    const lastUser = recentMessages.reverse().find(m => m?.role === "user");
    const visionPrompt = buildVisionPrompt(lastUser?.content || "");
    return [
      { role: "system", content: modelConfig.system },
      {
        role: "user",
        content: [
          { type: "text", text: visionPrompt },
          { type: "image_url", image_url: { url: image.dataUrl } }
        ]
      }
    ];
  }

  return [
    { role: "system", content: modelConfig.system },
    ...recentMessages
      .filter((m) => m && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content }))
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let clientClosed = false;
  req.on("close", () => { clientClosed = true; });

  try {
    if (!process.env.NVIDIA_API_KEY) {
      return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { messages, model, thinking, responseMode, image } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const selectedModel = ALLOWED_MODELS[model] ? model : "meta/llama-3.1-8b-instruct";
    const modelConfig = ALLOWED_MODELS[selectedModel];
    const recentMessages = trimMessages(messages, 10);
    const modeConfig = responseMode === "smart" ? modelConfig.smart : modelConfig.fast;
    const safeMessages = normalizeMessagesForModel(recentMessages, modelConfig, selectedModel, image);

    const requestPayload = {
      model: selectedModel,
      messages: safeMessages,
      temperature: thinking ? Math.max(modeConfig.temperature, 0.25) : modeConfig.temperature,
      top_p: 0.9,
      max_tokens: thinking ? Math.min(Math.max(modeConfig.maxTokens, 2200), 4000) : modeConfig.maxTokens,
      stream: true 
    };

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(requestPayload)
    });

    if (!upstream.ok || !upstream.body) {
      const raw = await upstream.text();
      return res.status(upstream.status).json({ error: "NVIDIA API error", details: raw });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    sendSSE(res, { type: "meta", label: modelConfig.label, model: selectedModel });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        if (clientClosed) {
          try { reader.cancel(); } catch {}
          break;
        }
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const lines = event.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              const payload = trimmed.slice(5).trim();
              if (payload === "[DONE]") {
                sendSSE(res, { type: "done" });
                res.write("data: [DONE]\n\n");
                res.end();
                return;
              }

              try {
                const json = JSON.parse(payload);
                const deltaContent = json?.choices?.[0]?.delta?.content ?? "";
                if (deltaContent) sendSSE(res, { type: "content", content: deltaContent });
              } catch (err) {}
            }
          }
        }
      }
      res.end();
    } catch (e) {
      sendSSE(res, { type: "error", message: "Stream crashed" });
      res.end();
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: "Server crashed", details: String(e) });
    else res.end();
  }
}
