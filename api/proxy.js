export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
  }

  try {
    const body = await req.json();
    const originalModel = body.model;

    let apiUrl = "";
    let apiKey = "";

    // РОУТЕР ПРОВАЙДЕРІВ
    if (originalModel.startsWith("groq/")) {
      apiUrl = "https://api.groq.com/openai/v1/chat/completions";
      apiKey = process.env.GROQ_API_KEY;
      body.model = originalModel.replace("groq/", ""); 
    } 
    else if (originalModel.startsWith("gemini/")) {
      apiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      apiKey = process.env.GEMINI_API_KEY;
      body.model = originalModel.replace("gemini/", "");
    } 
    else if (originalModel.startsWith("openrouter/")) {
      apiUrl = "https://openrouter.ai/api/v1/chat/completions";
      apiKey = process.env.OPENROUTER_API_KEY;
      body.model = originalModel.replace("openrouter/", "");
    } 
    else {
      // За замовчуванням - NVIDIA
      apiUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
      apiKey = process.env.NVIDIA_API_KEY;
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ error: `Не знайдено API ключ для провайдера: ${originalModel}` }), { status: 500 });
    }

    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://tvoy-site.com", 
        "X-Title": "My AI Chat" 
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "");
      return new Response(JSON.stringify({ error: "Upstream API Error", details: errorText }), { status: upstream.status });
    }

    if (body.stream) {
      return new Response(upstream.body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive" },
      });
    }

    const data = await upstream.text();
    return new Response(data, { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
