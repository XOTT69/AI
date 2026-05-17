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

      const userId = getUserId(request);
      const publicRoutes = new Set(["/api/health"]);

      if (!publicRoutes.has(url.pathname) && !userId) {
        return json(request, { error: "Missing X-User-Id header", reqId }, 401);
      }

      if (url.pathname === "/api/chats" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT
            c.id,
            c.title,
            c.model,
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
        const title = String(body?.title || "Новий чат").slice(0, 120);
        const model = String(body?.model || "auto").slice(0, 120);
        const now = new Date().toISOString();

        const result = await env.DB.prepare(`
          INSERT INTO chats (user_id, title, model, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(userId, title, model, now, now).run();

        return json(
          request,
          {
            chat: {
              id: result.meta?.last_row_id ?? null,
              title,
              model,
              created_at: now,
              updated_at: now
            },
            reqId
          },
          201
        );
      }

      if (/^\/api\/chats\/\d+$/.test(url.pathname) && request.method === "GET") {
        const chatId = url.pathname.split("/").pop();

        const chat = await env.DB.prepare(`
          SELECT id, title, model, created_at, updated_at
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!chat) {
          return json(request, { error: "Chat not found", reqId }, 404);
        }

        const { results: messageRows } = await env.DB.prepare(`
          SELECT id, role, content, model, created_at
          FROM messages
          WHERE chat_id = ?
          ORDER BY id ASC
        `).bind(chatId).all();

        const { results: attachmentRows } = await env.DB.prepare(`
          SELECT
            ma.message_id,
            a.id,
            a.kind,
            a.r2_key,
            a.file_name,
            a.mime_type,
            a.file_size,
            a.created_at
          FROM message_attachments ma
          JOIN attachments a ON a.id = ma.attachment_id
          WHERE a.chat_id = ?
          ORDER BY a.id ASC
        `).bind(chatId).all();

        const attachMap = new Map();
        for (const row of attachmentRows || []) {
          const key = String(row.message_id);
          const list = attachMap.get(key) || [];
          list.push({
            id: row.id,
            kind: row.kind,
            file_name: row.file_name,
            mime_type: row.mime_type,
            file_size: row.file_size,
            created_at: row.created_at,
            url: fileUrlFor(env, row.r2_key)
          });
          attachMap.set(key, list);
        }

        const messages = (messageRows || []).map((row) => ({
          id: String(row.id),
          role: row.role,
          content: row.content || "",
          model: row.model || "",
          createdAt: row.created_at,
          attachments: attachMap.get(String(row.id)) || []
        }));

        return json(
          request,
          {
            chat: {
              id: String(chat.id),
              title: chat.title,
              model: chat.model || "auto",
              createdAt: chat.created_at,
              updatedAt: chat.updated_at,
              messages
            },
            reqId
          },
          200
        );
      }

      if (/^\/api\/chats\/\d+$/.test(url.pathname) && request.method === "DELETE") {
        const chatId = url.pathname.split("/").pop();

        const exists = await env.DB.prepare(`
          SELECT id
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!exists) {
          return json(request, { error: "Chat not found", reqId }, 404);
        }

        const { results: attached } = await env.DB.prepare(`
          SELECT r2_key
          FROM attachments
          WHERE chat_id = ?
        `).bind(chatId).all();

        for (const row of attached || []) {
          if (row.r2_key) {
            await env.FILES.delete(row.r2_key);
          }
        }

        await env.DB.prepare(`
          DELETE FROM message_attachments
          WHERE message_id IN (SELECT id FROM messages WHERE chat_id = ?)
        `).bind(chatId).run();

        await env.DB.prepare(`DELETE FROM attachments WHERE chat_id = ?`).bind(chatId).run();
        await env.DB.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(chatId).run();
        await env.DB.prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`).bind(chatId, userId).run();

        return json(request, { ok: true, reqId }, 200);
      }

      if (/^\/api\/chats\/\d+\/messages$/.test(url.pathname) && request.method === "POST") {
        const chatId = url.pathname.split("/")[3];

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
        const model = String(body?.model || "auto").slice(0, 120);
        const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
        const now = new Date().toISOString();

        const insertResult = await env.DB.prepare(`
          INSERT INTO messages (chat_id, role, content, model, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(chatId, role, content, model, now).run();

        const messageId = insertResult.meta?.last_row_id ?? null;

        for (const attachmentId of attachments) {
          await env.DB.prepare(`
            INSERT INTO message_attachments (message_id, attachment_id)
            VALUES (?, ?)
          `).bind(messageId, attachmentId).run();
        }

        await env.DB.prepare(`
          UPDATE chats
          SET updated_at = ?
          WHERE id = ? AND user_id = ?
        `).bind(now, chatId, userId).run();

        return json(
          request,
          {
            message: {
              id: messageId,
              role,
              content,
              model,
              created_at: now
            },
            reqId
          },
          201
        );
      }

      if (url.pathname === "/api/attachments/upload" && request.method === "POST") {
        const form = await request.formData();
        const chatId = String(form.get("chat_id") || "");
        const file = form.get("file");

        if (!chatId) {
          return json(request, { error: "chat_id required", reqId }, 400);
        }

        if (!(file instanceof File)) {
          return json(request, { error: "file required", reqId }, 400);
        }

        const exists = await env.DB.prepare(`
          SELECT id
          FROM chats
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `).bind(chatId, userId).first();

        if (!exists) {
          return json(request, { error: "Chat not found", reqId }, 404);
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
        const now = new Date().toISOString();

        await env.FILES.put(key, file.stream(), {
          httpMetadata: {
            contentType: mimeType,
            contentDisposition: `inline; filename="${safeName}"`
          },
          customMetadata: {
            userId,
            chatId,
            originalName: safeName
          }
        });

        const insert = await env.DB.prepare(`
          INSERT INTO attachments (
            chat_id,
            user_id,
            kind,
            r2_key,
            file_name,
            mime_type,
            file_size,
            created_at
          )
          VALUES (?, ?, 'image', ?, ?, ?, ?, ?)
        `).bind(chatId, userId, key, safeName, mimeType, size, now).run();

        return json(
          request,
          {
            attachment: {
              id: insert.meta?.last_row_id ?? null,
              kind: "image",
              r2_key: key,
              file_name: safeName,
              mime_type: mimeType,
              file_size: size,
              created_at: now,
              url: fileUrlFor(env, key)
            },
            reqId
          },
          201
        );
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

function getUserId(request) {
  return String(request.headers.get("X-User-Id") || "").trim();
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
