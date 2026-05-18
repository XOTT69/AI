export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reqId = crypto.randomUUID();

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: buildCorsHeaders(request)
        });
      }

      if (url.pathname === "/api/health") {
        return json(
          request,
          {
            ok: true,
            reqId,
            service: "ai1-worker",
            hasDB: !!env.DB,
            hasFILES: !!env.FILES,
            hasAI: !!env.AI
          },
          200
        );
      }

      if (!env.DB) {
        return json(request, { error: "Missing DB binding", reqId }, 500);
      }

      if (!env.FILES) {
        return json(request, { error: "Missing FILES binding", reqId }, 500);
      }

      const userId = getUserId(request, url);

      if (!userId && url.pathname !== "/api/health") {
        return json(request, { error: "Missing X-User-Id header or user_id query", reqId }, 401);
      }

      if (url.pathname === "/api/chats" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT
            c.id,
            c.user_id,
            c.title,
            c.model,
            c.system_prompt,
            c.created_at,
            c.updated_at,
            (
              SELECT m.content
              FROM messages m
              WHERE m.chat_id = c.id AND m.role = 'user'
              ORDER BY m.id DESC
              LIMIT 1
            ) AS preview
          FROM chats c
          WHERE c.user_id = ?
          ORDER BY c.updated_at DESC, c.id DESC
        `).bind(userId).all();

        return json(request, { chats: results || [], reqId }, 200);
      }

      if (url.pathname === "/api/chats" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const title = String(body?.title || "New chat").slice(0, 120);
        const model = body?.model ? String(body.model).slice(0, 120) : null;
        const systemPrompt = body?.system_prompt ? String(body.system_prompt) : null;

        const result = await env.DB.prepare(`
          INSERT INTO chats (user_id, title, model, system_prompt)
          VALUES (?, ?, ?, ?)
        `).bind(userId, title, model, systemPrompt).run();

        const chat = await env.DB.prepare(`
          SELECT id, user_id, title, model, system_prompt, created_at, updated_at
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(result.meta?.last_row_id, userId).first();

        return json(request, { chat, reqId }, 201);
      }

      if (/^\/api\/chats\/\d+$/.test(url.pathname) && request.method === "GET") {
        const chatId = Number(url.pathname.split("/").pop());

        const chat = await env.DB.prepare(`
          SELECT id, user_id, title, model, system_prompt, created_at, updated_at
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!chat) {
          return json(request, { error: "Chat not found", reqId }, 404);
        }

        const { results: messageRows } = await env.DB.prepare(`
          SELECT
            id,
            chat_id,
            role,
            content,
            provider,
            model,
            prompt_tokens,
            completion_tokens,
            created_at
          FROM messages
          WHERE chat_id = ?
          ORDER BY id ASC
        `).bind(chatId).all();

        const { results: attachmentRows } = await env.DB.prepare(`
          SELECT
            id,
            message_id,
            user_id,
            chat_id,
            name,
            type,
            size,
            url,
            r2_key,
            created_at
          FROM message_attachments
          WHERE chat_id = ? AND user_id = ?
          ORDER BY id ASC
        `).bind(chatId, userId).all();

        const attachMap = new Map();
        for (const row of attachmentRows || []) {
          const key = String(row.message_id || "");
          const list = attachMap.get(key) || [];
          list.push({
            id: row.id,
            name: row.name,
            type: row.type,
            size: row.size,
            url: row.url || fileUrlFor(env, row.r2_key),
            r2_key: row.r2_key,
            created_at: row.created_at
          });
          attachMap.set(key, list);
        }

        const messages = (messageRows || []).map((row) => ({
          id: String(row.id),
          chat_id: row.chat_id,
          role: row.role,
          content: row.content,
          provider: row.provider,
          model: row.model,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: row.completion_tokens,
          created_at: row.created_at,
          attachments: attachMap.get(String(row.id)) || []
        }));

        return json(
          request,
          {
            chat: {
              ...chat,
              messages
            },
            reqId
          },
          200
        );
      }

      if (/^\/api\/chats\/\d+$/.test(url.pathname) && request.method === "DELETE") {
        const chatId = Number(url.pathname.split("/").pop());

        const exists = await env.DB.prepare(`
          SELECT id
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!exists) {
          return json(request, { error: "Chat not found", reqId }, 404);
        }

        const { results: files } = await env.DB.prepare(`
          SELECT r2_key
          FROM message_attachments
          WHERE chat_id = ? AND user_id = ?
        `).bind(chatId, userId).all();

        for (const row of files || []) {
          if (row.r2_key) {
            await env.FILES.delete(row.r2_key);
          }
        }

        await env.DB.prepare(`
          DELETE FROM message_attachments
          WHERE chat_id = ? AND user_id = ?
        `).bind(chatId, userId).run();

        await env.DB.prepare(`
          DELETE FROM chats
          WHERE id = ? AND user_id = ?
        `).bind(chatId, userId).run();

        return json(request, { ok: true, reqId }, 200);
      }

      if (/^\/api\/chats\/\d+\/messages$/.test(url.pathname) && request.method === "POST") {
        const chatId = Number(url.pathname.split("/")[3]);

        const exists = await env.DB.prepare(`
          SELECT id
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!exists) {
          return json(request, { error: "Chat not found", reqId }, 404);
        }

        const body = await request.json().catch(() => ({}));
        const role = String(body?.role || "user").slice(0, 20);
        const content = String(body?.content || "");
        const provider = body?.provider ? String(body.provider).slice(0, 120) : null;
        const model = body?.model ? String(body.model).slice(0, 120) : null;
        const promptTokens = Number(body?.prompt_tokens || 0);
        const completionTokens = Number(body?.completion_tokens || 0);

        const insertResult = await env.DB.prepare(`
          INSERT INTO messages (
            chat_id, role, content, provider, model, prompt_tokens, completion_tokens
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          chatId,
          role,
          content,
          provider,
          model,
          promptTokens,
          completionTokens
        ).run();

        await env.DB.prepare(`
          UPDATE chats
          SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?
        `).bind(chatId, userId).run();

        const message = await env.DB.prepare(`
          SELECT
            id, chat_id, role, content, provider, model,
            prompt_tokens, completion_tokens, created_at
          FROM messages
          WHERE id = ?
          LIMIT 1
        `).bind(insertResult.meta?.last_row_id).first();

        return json(request, { message, reqId }, 201);
      }

      if (url.pathname === "/api/attachments/upload" && request.method === "POST") {
        const form = await request.formData();
        const chatId = Number(form.get("chat_id") || 0);
        const messageIdRaw = form.get("message_id");
        const messageId = messageIdRaw ? Number(messageIdRaw) : null;
        const file = form.get("file");

        if (!chatId) {
          return json(request, { error: "chat_id required", reqId }, 400);
        }

        if (!(file instanceof File)) {
          return json(request, { error: "file required", reqId }, 400);
        }

        const chat = await env.DB.prepare(`
          SELECT id
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!chat) {
          return json(request, { error: "Chat not found", reqId }, 404);
        }

        if (messageId) {
          const msg = await env.DB.prepare(`
            SELECT id
            FROM messages
            WHERE id = ? AND chat_id = ?
            LIMIT 1
          `).bind(messageId, chatId).first();

          if (!msg) {
            return json(request, { error: "Message not found", reqId }, 404);
          }
        }

        const mimeType = file.type || "application/octet-stream";
        if (!mimeType.startsWith("image/")) {
          return json(request, { error: "Only image uploads are allowed", reqId }, 400);
        }

        const size = Number(file.size || 0);
        if (size > 8 * 1024 * 1024) {
          return json(request, { error: "File too large", reqId }, 400);
        }

        const ext = getExtension(file.name, mimeType);
        const safeName = String(file.name || `image.${ext}`).replace(/[^\w.\-]+/g, "_");
        const key = `uploads/${userId}/${chatId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

        await env.FILES.put(key, file.stream(), {
          httpMetadata: {
            contentType: mimeType,
            contentDisposition: `inline; filename="${safeName}"`
          },
          customMetadata: {
            userId: String(userId),
            chatId: String(chatId),
            messageId: String(messageId || ""),
            originalName: safeName
          }
        });

        const publicUrl = fileUrlFor(env, key);

        const insert = await env.DB.prepare(`
          INSERT INTO message_attachments (
            message_id,
            user_id,
            chat_id,
            name,
            type,
            size,
            url,
            r2_key
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          messageId,
          userId,
          chatId,
          safeName,
          mimeType,
          size,
          publicUrl,
          key
        ).run();

        const attachment = await env.DB.prepare(`
          SELECT
            id, message_id, user_id, chat_id,
            name, type, size, url, r2_key, created_at
          FROM message_attachments
          WHERE id = ?
          LIMIT 1
        `).bind(insert.meta?.last_row_id).first();

        return json(request, { attachment, reqId }, 201);
      }

      if (url.pathname.startsWith("/api/files/") && request.method === "GET") {
        const key = decodeURIComponent(url.pathname.replace("/api/files/", ""));
        const object = await env.FILES.get(key);

        if (!object) {
          return json(request, { error: "File not found", reqId }, 404);
        }

        const headers = new Headers(buildCorsHeaders(request));
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");

        return new Response(object.body, {
          status: 200,
          headers
        });
      }

      return json(request, { error: "Not found", reqId }, 404);
    } catch (error) {
      return json(
        request,
        {
          error: error?.message || "Internal server error",
          reqId
        },
        500
      );
    }
  }
};

function getUserId(request, url) {
  const headerValue = String(request.headers.get("X-User-Id") || "").trim();
  const queryValue = String(url.searchParams.get("user_id") || "").trim();
  const raw = headerValue || queryValue;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function getExtension(fileName, mimeType) {
  const fromName = String(fileName || "").includes(".")
    ? String(fileName).split(".").pop()?.toLowerCase()
    : "";

  if (fromName) return fromName;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/jpeg") return "jpg";
  return "bin";
}

function fileUrlFor(env, key) {
  const workerUrl = String(env.WORKER_PUBLIC_URL || "").replace(/\/$/, "");
  const r2PublicUrl = String(env.R2_PUBLIC_URL || "").replace(/\/$/, "");

  if (r2PublicUrl) {
    return `${r2PublicUrl}/${key}`;
  }

  if (workerUrl) {
    return `${workerUrl}/api/files/${encodeURIComponent(key)}`;
  }

  return `/api/files/${encodeURIComponent(key)}`;
}

function buildCorsHeaders(request) {
  const origin = request.headers.get("Origin");

  const allowedOrigins = [
    "https://ai-beta-by.vercel.app",
    "https://ai1.ai-beta69690.workers.dev",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:4173"
  ];

  const allowOrigin =
    origin && allowedOrigins.includes(origin)
      ? origin
      : "https://ai-beta-by.vercel.app";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCorsHeaders(request)
    }
  });
}
