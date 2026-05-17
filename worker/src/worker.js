function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function toMillis(value) {
  return value ? new Date(value).getTime() : Date.now();
}

async function getChatById(db, userId, chatId) {
  return db
    .prepare(`
      SELECT id, user_id, title, created_at, updated_at
      FROM chats
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `)
    .bind(chatId, userId)
    .first();
}

async function getChatMessages(db, chatId) {
  const result = await db
    .prepare(`
      SELECT id, role, content, image_data_url, is_error, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY created_at ASC
    `)
    .bind(chatId)
    .all();

  return (result.results || []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content || "",
    image: row.image_data_url ? { dataUrl: row.image_data_url } : null,
    isError: Boolean(row.is_error),
    createdAt: toMillis(row.created_at)
  }));
}

async function getChatsWithPreview(db, userId) {
  const result = await db
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
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS preview
      FROM chats c
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
    `)
    .bind(userId)
    .all();

  return (result.results || []).map((row) => ({
    id: row.id,
    title: row.title || "Новий чат",
    created_at: row.created_at,
    updated_at: row.updated_at,
    preview: row.preview || ""
  }));
}

async function createChat(db, userId, title = "Новий чат") {
  const id = uid();
  const ts = nowIso();

  await db
    .prepare(`
      INSERT INTO chats (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(id, userId, title, ts, ts)
    .run();

  return {
    id,
    user_id: userId,
    title,
    created_at: ts,
    updated_at: ts
  };
}

async function appendMessage(db, { chatId, role, content = "", imageDataUrl = null, isError = false }) {
  const id = uid();
  const ts = nowIso();

  await db
    .prepare(`
      INSERT INTO messages (id, chat_id, role, content, image_data_url, is_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(id, chatId, role, content, imageDataUrl, isError ? 1 : 0, ts)
    .run();

  await db
    .prepare(`
      UPDATE chats
      SET updated_at = ?
      WHERE id = ?
    `)
    .bind(ts, chatId)
    .run();

  return {
    id,
    chatId,
    role,
    content,
    image: imageDataUrl ? { dataUrl: imageDataUrl } : null,
    isError: Boolean(isError),
    createdAt: toMillis(ts)
  };
}

async function upsertAssistantMessage(db, { userId, chatId, messageId, content, isError = false }) {
  const chat = await getChatById(db, userId, chatId);
  if (!chat) throw new Error("Chat not found");

  const existing = await db
    .prepare(`
      SELECT id
      FROM messages
      WHERE id = ? AND chat_id = ?
      LIMIT 1
    `)
    .bind(messageId, chatId)
    .first();

  if (existing) {
    await db
      .prepare(`
        UPDATE messages
        SET content = ?, is_error = ?
        WHERE id = ? AND chat_id = ? AND role = 'assistant'
      `)
      .bind(content, isError ? 1 : 0, messageId, chatId)
      .run();
  } else {
    await db
      .prepare(`
        INSERT INTO messages (id, chat_id, role, content, image_data_url, is_error, created_at)
        VALUES (?, ?, 'assistant', ?, NULL, ?, ?)
      `)
      .bind(messageId, chatId, content, isError ? 1 : 0, nowIso())
      .run();
  }

  await db
    .prepare(`
      UPDATE chats
      SET updated_at = ?
      WHERE id = ?
    `)
    .bind(nowIso(), chatId)
    .run();

  return { ok: true, messageId };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const db = env.DB;

    if (!db) {
      return json({ error: "D1 binding DB is missing" }, 500);
    }

    if (request.method === "GET" && path === "/") {
      return text("ai1 history api ok");
    }

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, worker: "ai1", db: "connected" });
    }

    const userId = request.headers.get("X-User-Id");
    if (!userId) {
      return json({ error: "Missing X-User-Id" }, 401);
    }

    try {
      if (request.method === "GET" && path === "/api/chats") {
        const chats = await getChatsWithPreview(db, userId);
        return json({ chats });
      }

      if (request.method === "POST" && path === "/api/chats") {
        const body = await request.json().catch(() => ({}));
        const title = String(body.title || "Новий чат").trim() || "Новий чат";
        const chat = await createChat(db, userId, title);
        return json({ chat });
      }

      if (request.method === "GET" && path.startsWith("/api/chats/")) {
        const parts = path.split("/").filter(Boolean);

        if (parts.length === 3 && parts[0] === "api" && parts[1] === "chats") {
          const chatId = parts[2];
          const chat = await getChatById(db, userId, chatId);

          if (!chat) {
            return json({ error: "Chat not found" }, 404);
          }

          const messages = await getChatMessages(db, chatId);

          return json({
            chat: {
              id: chat.id,
              title: chat.title || "Новий чат",
              createdAt: toMillis(chat.created_at),
              updatedAt: toMillis(chat.updated_at),
              messages
            }
          });
        }
      }

      if (request.method === "DELETE" && path.startsWith("/api/chats/")) {
        const parts = path.split("/").filter(Boolean);

        if (parts.length === 3 && parts[0] === "api" && parts[1] === "chats") {
          const chatId = parts[2];
          const chat = await getChatById(db, userId, chatId);

          if (!chat) {
            return json({ error: "Chat not found" }, 404);
          }

          await db.batch([
            db.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(chatId),
            db.prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`).bind(chatId, userId)
          ]);

          return json({ ok: true });
        }
      }

      if (request.method === "POST" && path === "/api/messages") {
        const body = await request.json().catch(() => ({}));
        const chatId = String(body.chatId || "").trim();
        const content = String(body.content || "").trim();
        const imageDataUrl = body.imageDataUrl || null;

        if (!chatId) {
          return json({ error: "chatId is required" }, 400);
        }

        const chat = await getChatById(db, userId, chatId);
        if (!chat) {
          return json({ error: "Chat not found" }, 404);
        }

        if (!content && !imageDataUrl) {
          return json({ error: "Message content is required" }, 400);
        }

        if (content && (chat.title === "Новий чат" || !chat.title)) {
          await db
            .prepare(`
              UPDATE chats
              SET title = ?, updated_at = ?
              WHERE id = ? AND user_id = ?
            `)
            .bind(content.slice(0, 48), nowIso(), chatId, userId)
            .run();
        }

        const userMessage = await appendMessage(db, {
          chatId,
          role: "user",
          content,
          imageDataUrl
        });

        const updatedChat = await getChatById(db, userId, chatId);

        return json({
          chat: {
            id: updatedChat.id,
            title: updatedChat.title || "Новий чат"
          },
          message: userMessage
        });
      }

      if (request.method === "POST" && path === "/api/messages/assistant") {
        const body = await request.json().catch(() => ({}));
        const chatId = String(body.chatId || "").trim();
        const messageId = String(body.messageId || uid()).trim();
        const content = String(body.content || "");
        const isError = Boolean(body.isError);

        if (!chatId) {
          return json({ error: "chatId is required" }, 400);
        }

        const result = await upsertAssistantMessage(db, {
          userId,
          chatId,
          messageId,
          content,
          isError
        });

        return json(result);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error?.message || "Internal error" }, 500);
    }
  }
};
