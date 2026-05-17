export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const method = request.method;

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      const userId = getUserId(request);
      if (!userId) {
        return json({ error: "Missing X-User-Id header" }, 401);
      }

      if (url.pathname === "/api/chats" && method === "GET") {
        return handleListChats(env, userId);
      }

      if (url.pathname === "/api/chats" && method === "POST") {
        return handleCreateChat(request, env, userId);
      }

      if (url.pathname.match(/^\/api\/chats\/\d+$/) && method === "GET") {
        const chatId = url.pathname.split("/").pop();
        return handleGetChat(env, userId, chatId);
      }

      if (url.pathname.match(/^\/api\/chats\/\d+$/) && method === "DELETE") {
        const chatId = url.pathname.split("/").pop();
        return handleDeleteChat(env, userId, chatId);
      }

      if (url.pathname.match(/^\/api\/chats\/\d+\/messages$/) && method === "POST") {
        const chatId = url.pathname.split("/")[3];
        return handleCreateMessage(request, env, userId, chatId);
      }

      if (url.pathname === "/api/attachments/upload" && method === "POST") {
        return handleUploadAttachment(request, env, userId);
      }

      if (url.pathname.startsWith("/api/files/") && method === "GET") {
        const key = decodeURIComponent(url.pathname.replace("/api/files/", ""));
        return handleServeFile(env, key);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Worker error:", error);
      return json({ error: error.message || "Server error" }, 500);
    }
  }
};

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    ...extra
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({
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

async function handleListChats(env, userId) {
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

  return json({ chats: results || [] });
}

async function handleCreateChat(request, env, userId) {
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
    }
  }, 201);
}

async function handleGetChat(env, userId, chatId) {
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
    return json({ error: "Chat not found" }, 404);
  }

  const { results: messageRows } = await env.DB
    .prepare(`
      SELECT
        id,
        role,
        content,
        model,
        created_at
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
    }
  });
}

async function handleDeleteChat(env, userId, chatId) {
  const exists = await chatBelongsToUser(env, chatId, userId);
  if (!exists) return json({ error: "Chat not found" }, 404);

  const { results: attached } = await env.DB
    .prepare(`
      SELECT a.r2_key
      FROM attachments a
      WHERE a.chat_id = ?
    `)
    .bind(chatId)
    .all();

  const keys = (attached || []).map((r) => r.r2_key).filter(Boolean);
  if (keys.length) {
    for (const key of keys) {
      await env.FILES.delete(key);
    }
  }

  await env.DB
    .prepare(`DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE chat_id = ?)`)
    .bind(chatId)
    .run();

  await env.DB.prepare(`DELETE FROM attachments WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`).bind(chatId, userId).run();

  return json({ ok: true });
}

async function handleCreateMessage(request, env, userId, chatId) {
  const exists = await chatBelongsToUser(env, chatId, userId);
  if (!exists) return json({ error: "Chat not found" }, 404);

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
    }
  }, 201);
}

async function handleUploadAttachment(request, env, userId) {
  const form = await request.formData();
  const chatId = String(form.get("chat_id") || "");
  const file = form.get("file");

  if (!chatId) return json({ error: "chat_id required" }, 400);
  if (!(file instanceof File)) return json({ error: "file required" }, 400);

  const exists = await chatBelongsToUser(env, chatId, userId);
  if (!exists) return json({ error: "Chat not found" }, 404);

  const mimeType = file.type || "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    return json({ error: "Only image uploads are allowed" }, 400);
  }

  const size = Number(file.size || 0);
  if (size > 8 * 1024 * 1024) {
    return json({ error: "File too large" }, 400);
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
    }
  }, 201);
}

async function handleServeFile(env, key) {
  const object = await env.FILES.get(key);
  if (!object) {
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }

  const headers = new Headers(corsHeaders());
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, {
    headers
  });
}
