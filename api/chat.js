const ALLOWED_MODELS = {
  "deepseek-ai/deepseek-v4-pro": {
    label: "DeepSeek V4 Pro — Універсал",
    system: "Ти дуже сильний AI-помічник. Відповідай українською мовою, чітко, розумно, глибоко і по суті.",
    fast: { maxTokens: 1800, temperature: 0.2 },
    smart: { maxTokens: 2400, temperature: 0.3 }
  },
  "deepseek-ai/deepseek-v4-flash": {
    label: "DeepSeek Flash — Швидкий",
    system: "Ти швидкий AI-помічник. Відповідай українською коротко, чітко і корисно.",
    fast: { maxTokens: 1200, temperature: 0.15 },
    smart: { maxTokens: 2200, temperature: 0.3 }
  },
  "google/gemma-3-27b-it": {
    label: "Gemma 3 (27B) — Фото й OCR",
    system: [
      "Ти мультимодальний AI-помічник для точного OCR, аналізу фото, скрінів і документів.",
      "Відповідай українською.",
      "Не вигадуй факти, не домислюй невидимий текст, не повторюй блоки тексту.",
      "Якщо щось не видно або нечитабельно — прямо напиши: нечитабельно.",
      "Якщо користувач просить OCR або аналіз документа:",
      "1) Спочатку коротко опиши тип документа.",
      "2) Потім перепиши видимий текст максимально дослівно без повторів.",
      "3) Потім дай структурований список полів, лише якщо вони реально видимі."
    ].join(" "),
    fast: { maxTokens: 2000, temperature: 0.1 },
    smart: { maxTokens: 4000, temperature: 0.2 }
  },
  "abacusai/dracarys-llama-3.1-70b-instruct": {
    label: "Dracarys Llama (70B) — Код і Текст",
    system: "Ти AI-помічник експертного рівня для написання коду, глибокої аналітики та структурованих відповідей українською мовою.",
    fast: { maxTokens: 2000, temperature: 0.2 },
    smart: { maxTokens: 3000, temperature: 0.4 }
  }
};

function trimMessages(messages, maxItems = 10) {
  return messages.slice(-maxItems);
}

function sendSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getLastUserMessage(messages) {
  return [...messages].reverse().find(m => m?.role === "user") || null;
}

function buildVisionPrompt(userText = "") {
  const text = String(userText || "").trim().toLowerCase();
  const looksLikeDoc =
    text.includes("ocr") ||
    text.includes("документ") ||
    text.includes("паспорт") ||
    text.includes("посвідч") ||
    text.includes("текст") ||
    text.includes("розпізнай") ||
    text.includes("що написано");

  if (looksLikeDoc) {
    return [
      "Зроби точний OCR цього зображення.",
      "Формат відповіді:",
      "1. Тип зображення/документа.",
      "2. Видимий текст — перепиши дослівно, без повторів і без вигадок.",
      "3. Поля документа: ПІБ, дата народження, номер документа, дата видачі, адреса, громадянство, інше.",
      "Для кожного поля, яке не видно чітко, пиши: нечитабельно.",
      "Не повторюй однакові рядки по кілька разів."
    ].join("\n");
  }

  return [
    userText || "Опиши, що на цьому зображенні.",
    "",
    "Якщо на зображенні є текст, перепиши лише чітко видимий текст без вигадок.",
    "Не повторюй фрагменти."
  ].join("\n");
}

function normalizeMessagesForModel(recentMessages, modelConfig, selectedModel, image) {
  if (image?.dataUrl && selectedModel === "google/gemma-3-27b-it") {
    const lastUser = getLastUserMessage(recentMessages);
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
      .filter((m) => m && typeof m.content === "string" && ["user", "assistant", "system"].includes(m.role))
      .map((m) => ({ role: m.role, content: m.content }))
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });

  try {
    if (!process.env.NVIDIA_API_KEY) {
      return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { messages, model, thinking, stream, responseMode, image } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const selectedModel = ALLOWED_MODELS[model] ? model : "deepseek-ai/deepseek-v4-pro";
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
        return res.status(500).json({ error: "Invalid JSON from NVIDIA", model: selectedModel, details: raw });
      }
      const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
      return res.status(200).json({
        content,
        model: selectedModel,
        label: modelConfig.label,
        finish_reason: data?.choices?.[0]?.finish_reason || null
      });
    }

    if (!upstream.ok || !upstream.body) {
      const raw = await upstream.text();
      return res.status(upstream.status).json({ error: "NVIDIA upstream error", model: selectedModel, details: raw });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    sendSSE(res, { type: "meta", label: modelConfig.label, model: selectedModel });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalSent = false;

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
          const dataLines = [];

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed.startsWith("data:")) {
              dataLines.push(trimmed.slice(5).trim());
            }
          }

          const payload = dataLines.join("");
          if (!payload) continue;

          if (payload === "[DONE]") {
            sendSSE(res, { type: "done" });
            res.write("data: [DONE]\n\n");
            finalSent = true;
            res.end();
            return;
          }

          try {
            const json = JSON.parse(payload);
            const choice = json?.choices?.[0];
            const deltaContent = choice?.delta?.content ?? "";
            const finishReason = choice?.finish_reason ?? null;

            if (deltaContent) {
              sendSSE(res, { type: "content", content: deltaContent });
            }
            if (finishReason) {
              sendSSE(res, { type: "finish", finish_reason: finishReason });
            }
          } catch {}
        }
      }

      const tail = buffer.trim();
      if (tail.startsWith("data:")) {
        const payload = tail.slice(5).trim();
        if (payload === "[DONE]") {
          sendSSE(res, { type: "done" });
          res.write("data: [DONE]\n\n");
          finalSent = true;
          res.end();
          return;
        }

        try {
          const json = JSON.parse(payload);
          const choice = json?.choices?.[0];
          const deltaContent = choice?.delta?.content ?? "";
          const finishReason = choice?.finish_reason ?? null;

          if (deltaContent) {
            sendSSE(res, { type: "content", content: deltaContent });
          }
          if (finishReason) {
            sendSSE(res, { type: "finish", finish_reason: finishReason });
          }
        } catch {}
      }

      if (!finalSent && !res.writableEnded) {
        sendSSE(res, { type: "done" });
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (streamError) {
      if (!res.writableEnded) {
        sendSSE(res, { type: "error", message: streamError?.message || "Streaming crashed" });
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Function crashed", details: error?.message || String(error) });
    }
    try {
      sendSSE(res, { type: "error", message: error?.message || "Streaming crashed" });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {}
  }
}
