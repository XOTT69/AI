export default {
  async fetch(request, env, ctx) {
    const reqId = crypto.randomUUID();

    try {
      const url = new URL(request.url);
      const method = request.method;

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "worker",
          reqId,
          hasDB: !!env.DB,
          hasFILES: !!env.FILES,
          workerPublicUrl: env.WORKER_PUBLIC_URL || null
        }, 200, request);
      }

      if (!env.DB) {
        return json({ error: "Missing DB binding", reqId }, 500, request);
      }

      if (!env.FILES) {
        return json({ error: "Missing FILES binding", reqId }, 500, request);
      }

      const userId = getUserId(request);
      if (!userId) {
        return json({ error: "Missing X-User-Id header", reqId }, 401, request);
      }

      if (url.pathname === "/api/chats" && method === "GET") {
        return handleListChats(env, userId, reqId, request);
      }

      if (url.pathname === "/api/chats" && method === "POST") {
        return handleCreateChat(request, env, userId, reqId);
      }

      if (url.pathname.match(/^\/api\/chats\/\d+$/) && method === "GET") {
        const chatId = url.pathname.split("/").pop();
        return handleGetChat(env, userId, chatId, reqId, request);
      }

      if (url.pathname.match(/^\/api\/chats\/\d+$/) && method === "DELETE") {
        const chatId = url.pathname.split("/").pop();
        return handleDeleteChat(env, userId, chatId, reqId, request);
      }

      if (url.pathname.match(/^\/api\/chats\/\d+\/messages$/) && method === "POST") {
        const chatId = url.pathname.split("/")[3];
        return handleCreateMessage(request, env, userId, chatId, reqId);
      }

      if (url.pathname === "/api/attachments/upload" && method === "POST") {
        return handleUploadAttachment(request, env, userId, reqId);
      }

      if (url.pathname.startsWith("/api/files/") && method === "GET") {
        const key = decodeURIComponent(url.pathname.replace("/api/files/", ""));
        return handleServeFile(env, key, request, reqId);
      }

      return json({ error: "Not found", reqId }, 404, request);
    } catch (error) {
      console.error("Worker error:", error);
      return json({
        error: error.message || "Server error",
        stack: error.stack || null,
        reqId
      }, 500, request);
    }
  }
};

function corsHeaders(request, extra = {}) {
  const origin = request?.headers?.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    ...extra
  };
}

function json(data, status = 200, request = null, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request, {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    })
  });
}

function getUserId(request) {
  const raw = request.headers.get("X-User-Id");
  return raw ? String(raw).trim() : "";
}

async function chatBelongsToUser(env, chatId, userId) {
  const row = await env.DB
    .prepare(`SELECT id FROM chats WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(chatId, userId)
    .first();

  return !!row;
}

function fileUrlFor(env, key) {
  if (env.R2_PUBLIC_URL) {
    return `${String(env.R2_PUBLIC_URL).replace(/\/$/, "")}/${key}`;
  }
  if (env.WORKER_PUBLIC_URL) {
    return `${String(env.WORKER_PUBLIC_URL).replace(/\/$/, "")}/api/files/${encodeURIComponent(key)}`;
  }
  return `/api/files/${encodeURIComponent(key)}`;
}

async function handleListChats(env, userId, reqId, request) {
  const { results } = await env.DB
    .prepare(`
      SELECT
        c.id,
        c.title,
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
    `)
    .bind(userId)
    .all();

  return json({ chats: results || [], reqId }, 200, request);
}

async function handleCreateChat(request, env, userId, reqId) {
  const body = await request.json().catch(() => ({}));
  const title = String(body?.title || "Новий чат").slice(0, 120);
  const model = String(body?.model || "auto").slice(0, 120);
  const now = new Date().toISOString();

  const result = await env.DB
    .prepare(`
      INSERT INTO chats (user_id, title, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(userId, title, model, now, now)
    .run();

  return json({
    chat: {
      id: result.meta.last_row_id,
      title,
      model,
      created_at: now,
      updated_at: now
    },
    reqId
  }, 201, request);
}

async function handleGetChat(env, userId, chatId, reqId, request) {
  const chat = await env.DB
    .prepare(`
      SELECT id, title, model, created_at, updated_at
      FROM chats
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `)
    .bind(chatId, userId)
    .first();

  if (!chat) {
    return json({ error: "Chat not found", reqId }, 404, request);
  }

  const { results: messageRows } = await env.DB
    .prepare(`
      SELECT id, role, content, model, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY id ASC
    `)
    .bind(chatId)
    .all();

  const { results: attachmentRows } = await env.DB
    .prepare(`
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
    `)
    .bind(chatId)
    .all();

  const attachMap = new Map();
  for (const row of attachmentRows || []) {
    const list = attachMap.get(String(row.message_id)) || [];
    list.push({
      id: row.id,
      kind: row.kind,
      file_name: row.file_name,
      mime_type: row.mime_type,
      file_size: row.file_size,
      created_at: row.created_at,
      url: fileUrlFor(env, row.r2_key)
    });
    attachMap.set(String(row.message_id), list);
  }

  const messages = (messageRows || []).map((row) => ({
    id: String(row.id),
    role: row.role,
    content: row.content || "",
    model: row.model || "",
    createdAt: row.created_at,
    attachments: attachMap.get(String(row.id)) || []
  }));

  return json({
    chat: {
      id: String(chat.id),
      title: chat.title,
      model: chat.model || "auto",
      createdAt: chat.created_at,
      updatedAt: chat.updated_at,
      messages
    },
    reqId
  }, 200, request);
}

async function handleDeleteChat(env, userId, chatId, reqId, request) {
  const exists = await chatBelongsToUser(env, chatId, userId);
  if (!exists) return json({ error: "Chat not found", reqId }, 404, request);

  const { results: attached } = await env.DB
    .prepare(`SELECT a.r2_key FROM attachments a WHERE a.chat_id = ?`)
    .bind(chatId)
    .all();

  const keys = (attached || []).map((r) => r.r2_key).filter(Boolean);
  for (const key of keys) {
    await env.FILES.delete(key);
  }

  await env.DB.prepare(`DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE chat_id = ?)`)
    .bind(chatId)
    .run();

  await env.DB.prepare(`DELETE FROM attachments WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`).bind(chatId, userId).run();

  return json({ ok: true, reqId }, 200, request);
}

async function handleCreateMessage(request, env, userId, chatId, reqId) {
  const exists = await chatBelongsToUser(env, chatId, userId);
  if (!exists) return json({ error: "Chat not found", reqId }, 404, request);

  const body = await request.json().catch(() => ({}));
  const role = String(body?.role || "user");
  const content = String(body?.content || "");
  const model = String(body?.model || "auto").slice(0, 120);
  const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
  const now = new Date().toISOString();

  const insertResult = await env.DB
    .prepare(`
      INSERT INTO messages (chat_id, role, content, model, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(chatId, role, content, model, now)
    .run();

  const messageId = insertResult.meta.last_row_id;

  for (const attachmentId of attachments) {
    await env.DB
      .prepare(`
        INSERT INTO message_attachments (message_id, attachment_id)
        VALUES (?, ?)
      `)
      .bind(messageId, attachmentId)
      .run();
  }

  const titleSeed = content.trim().slice(0, 80);
  if (role === "user" && titleSeed) {
    await env.DB
      .prepare(`
        UPDATE chats
        SET title = CASE WHEN title IS NULL OR title = '' OR title = 'Новий чат' THEN ? ELSE title END,
            updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .bind(titleSeed, now, chatId, userId)
      .run();
  } else {
    await env.DB
      .prepare(`
        UPDATE chats
        SET updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .bind(now, chatId, userId)
      .run();
  }

  return json({
    message: {
      id: messageId,
      role,
      content,
      model,
      created_at: now
    },
    reqId
  }, 201, request);
}

async function handleUploadAttachment(request, env, userId, reqId) {
  const form = await request.formData();
  const chatId = String(form.get("chat_id") || "");
  const file = form.get("file");

  if (!chatId) return json({ error: "chat_id required", reqId }, 400, request);
  if (!(file instanceof File)) return json({ error: "file required", reqId }, 400, request);

  const exists = await chatBelongsToUser(env, chatId, userId);
  if (!exists) return json({ error: "Chat not found", reqId }, 404, request);

  const mimeType = file.type || "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    return json({ error: "Only image uploads are allowed", reqId }, 400, request);
  }

  const size = Number(file.size || 0);
  if (size > 8 * 1024 * 1024) {
    return json({ error: "File too large", reqId }, 400, request);
  }

  const ext = (() => {
    const fromName = String(file.name || "").split(".").pop()?.toLowerCase();
    if (fromName && fromName !== file.name) return fromName;
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/gif") return "gif";
    return "jpg";
  })();

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

  const insert = await env.DB
    .prepare(`
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
    `)
    .bind(chatId, userId, key, safeName, mimeType, size, now)
    .run();

  return json({
    attachment: {
      id: insert.meta.last_row_id,
      kind: "image",
      r2_key: key,
      file_name: safeName,
      mime_type: mimeType,
      file_size: size,
      created_at: now,
      url: fileUrlFor(env, key)
    },
    reqId
  }, 201, request);
}

async function handleServeFile(env, key, request, reqId) {
  const object = await env.FILES.get(key);
  if (!object) {
    return new Response(JSON.stringify({ error: "Not found", reqId }), {
      status: 404,
      headers: corsHeaders(request, { "Content-Type": "application/json; charset=utf-8" })
    });
  }

  const headers = new Headers(corsHeaders(request));
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
