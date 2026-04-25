export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, model, thinking } = req.body || {};

    if (!Array.isArray(messages) || !messages.length) {
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
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "deepseek-ai/deepseek-v4-flash",
        messages: safeMessages,
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 2048,
        stream: true
      })
    });

    if (!upstream.ok || !upstream.body) {
      const errorText = await upstream.text();
      return res.status(upstream.status).send(errorText || "Upstream error");
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const text = delta?.content || "";
          if (text) {
            res.write(text);
          }
        } catch (_) {
        }
      }
    }

    res.end();
  } catch (error) {
    res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
