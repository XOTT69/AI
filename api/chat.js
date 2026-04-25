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

    const safeMessages = [
      {
        role: "system",
        content: thinking ? "detailed thinking on" : "detailed thinking off"
      },
      ...messages
        .filter((m) => m && typeof m.content === "string" && ["user", "assistant", "system"].includes(m.role))
        .map((m) => ({
          role: m.role,
          content: m.content
        }))
    ];

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "deepseek-ai/deepseek-v4-flash",
        messages: safeMessages,
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 1024,
        stream: false
      })
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "NVIDIA upstream error",
        details: raw
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({
        error: "Invalid JSON from NVIDIA",
        details: raw
      });
    }

    const content =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "Порожня відповідь від моделі";

    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      details: error?.message || String(error)
    });
  }
}
