const ALLOWED_MODELS = {
  "deepseek-ai/deepseek-v4-pro": {
    label: "DeepSeek V4 Pro — Найрозумніший",
    system: "Ти дуже сильний AI-помічник. Відповідай українською мовою, чітко, розумно, по суті, без води."
  },
  "deepseek-ai/deepseek-v3_2": {
    label: "DeepSeek V3.2 — Логіка і складні задачі",
    system: "Ти AI-помічник для складних задач, логіки, аналізу і reasoning. Відповідай українською, структуровано і точно."
  },
  "z-ai/glm-4.7": {
    label: "GLM-4.7 — Агент і інструменти",
    system: "Ти AI-помічник, сильний у коді, інструментах, аналізі та агентних задачах. Відповідай українською, практично і чітко."
  },
  "mistralai/mistral-large-3-675b-instruct-2512": {
    label: "Mistral Large 3 — Сильний універсал",
    system: "Ти універсальний AI-помічник для чату, текстів, аналізу та ідей. Відповідай українською природно, розумно і стисло."
  },
  "mistralai/devstral-2-123b-instruct-2512": {
    label: "Devstral 2 — Найкращий для коду",
    system: "Ти AI-помічник для програмування. Допомагай з кодом, дебагом, архітектурою і поясненнями. Відповідай українською."
  },
  "deepseek-ai/deepseek-v4-flash": {
    label: "DeepSeek V4 Flash — Швидкий",
    system: "Ти швидкий AI-помічник. Відповідай українською коротко, чітко і корисно."
  },
  "bytedance/seed-oss-36b-instruct": {
    label: "Seed OSS 36B — Довгі тексти і контекст",
    system: "Ти AI-помічник для довгих текстів, великих контекстів, reasoning і загальних задач. Відповідай українською, структуровано."
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.NVIDIA_API_KEY) {
      return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { messages, model, thinking } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const selectedModel = ALLOWED_MODELS[model] ? model : "deepseek-ai/deepseek-v4-pro";
    const modelConfig = ALLOWED_MODELS[selectedModel];

    const safeMessages = [
      {
        role: "system",
        content: `${modelConfig.system} ${thinking ? "Detailed thinking on." : "Detailed thinking off."}`
      },
      ...messages
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

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: safeMessages,
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 1500,
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
      label: modelConfig.label
    });
  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      details: error?.message || String(error)
    });
  }
}
