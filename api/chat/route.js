export const config = {
  runtime: 'edge'
};

const ALLOWED_MODELS = {
  "meta/llama-3.3-70b-instruct": {
    label: "Llama 3.3 70B",
    system: "Ти швидкий, розумний і точний AI-помічник. Відповідай українською мовою.",
    fast: { maxTokens: 2000, temperature: 0.2 },
    smart: { maxTokens: 4000, temperature: 0.5 }
  },
  "google/gemma-2-27b-it": {
    label: "Gemma 2 27B",
    system: "Ти дуже швидкий AI-помічник. Відповідай українською мовою коротко і чітко.",
    fast: { maxTokens: 1500, temperature: 0.2 },
    smart: { maxTokens: 3000, temperature: 0.4 }
  },
  "google/gemma-3-27b-it": {
    label: "Gemma 3 27B",
    system: [
      "Ти мультимодальний AI-помічник для точного OCR, аналізу фото, скрінів і документів.",
      "Відповідай українською. Не вигадуй факти і не домислюй текст."
    ].join(" "),
    fast: { maxTokens: 2000, temperature: 0.1 },
    smart: { maxTokens: 4000, temperature: 0.2 }
  },
  "abacusai/dracarys-llama-3.1-70b-instruct": {
    label: "Dracarys Llama 70B",
    system: "Ти AI-помічник експертного рівня для написання коду та аналітики. Відповідай українською.",
    fast: { maxTokens: 2000, temperature: 0.2 },
    smart: { maxTokens: 4000, temperature: 0.4 }
  }
};

function trimMessages(messages, maxItems = 10) {
  return messages.slice(-maxItems);
}

function buildVisionPrompt(userText = "") {
  const text = String(userText || "").trim();
  return [
    text || "Опиши, що на цьому зображенні.",
    "Якщо на зображенні є текст, перепиши лише чітко видимий текст без вигадок."
  ].join("\n");
}

function normalizeMessagesForModel(recentMessages, modelConfig, selectedModel, image) {
  if (image?.dataUrl && selectedModel.includes("gemma-3")) {
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

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    // Беремо ключ NVIDIA безпечно з Vercel Environment Variables
    if (!process.env.NVIDIA_API_KEY) {
      return new Response(JSON.stringify({ error: "NVIDIA_API_KEY is missing in Vercel settings" }), { status: 500 });
    }

    const body = await req.json();
    const { messages, model, thinking, responseMode, image } = body;

    const fallbackModel = "meta/llama-3.3-70b-instruct";
    const selectedModel = ALLOWED_MODELS[model] ? model : fallbackModel;
    const modelConfig = ALLOWED_MODELS[selectedModel];
    
    const recentMessages = trimMessages(messages || [], 10);
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); 

    let upstream;
    try {
      upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      return new Response(JSON.stringify({ 
        error: "NVIDIA Timeout", 
        details: "Сервери NVIDIA перевантажені і не відповіли. Спробуй іншу модель або повтори запит." 
      }), { status: 504 });
    }

    if (!upstream.ok || !upstream.body) {
      const raw = await upstream.text();
      return new Response(JSON.stringify({ error: "NVIDIA API error", details: raw }), { status: upstream.status });
    }

    const stream = new ReadableStream({
      async start(streamController) {
        const metaPayload = `data: ${JSON.stringify({ type: "meta", label: modelConfig.label, model: selectedModel })}\n\n`;
        streamController.enqueue(new TextEncoder().encode(metaPayload));

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
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
                    streamController.enqueue(new TextEncoder().encode(`data: {"type":"done"}\n\n`));
                    streamController.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
                    streamController.close();
                    return;
                  }

                  try {
                    const json = JSON.parse(payload);
                    const deltaContent = json?.choices?.[0]?.delta?.content ?? "";
                    if (deltaContent) {
                      const contentPayload = `data: ${JSON.stringify({ type: "content", content: deltaContent })}\n\n`;
                      streamController.enqueue(new TextEncoder().encode(contentPayload));
                    }
                  } catch (err) {}
                }
              }
            }
          }
          streamController.close();
        } catch (e) {
          streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "error", message: "Stream crashed" })}\n\n`));
          streamController.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server crashed", details: String(e) }), { status: 500 });
  }
}
