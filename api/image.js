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

    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        size: "1024x1024"
      })
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "NVIDIA image upstream error",
        details: raw
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({
        error: "Invalid JSON from NVIDIA image API",
        details: raw
      });
    }

    const imageUrl =
      data?.data?.[0]?.url ||
      data?.data?.[0]?.b64_json ||
      null;

    if (!imageUrl) {
      return res.status(500).json({
        error: "Image URL was not returned",
        details: data
      });
    }

    const finalUrl = imageUrl.startsWith("http")
      ? imageUrl
      : `data:image/png;base64,${imageUrl}`;

    return res.status(200).json({
      url: finalUrl
    });
  } catch (error) {
    return res.status(500).json({
      error: "Image function crashed",
      details: error?.message || String(error)
    });
  }
}
