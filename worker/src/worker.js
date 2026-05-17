function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id"
    }
  });
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

async function getChatMessages(db, chatId) {
  const { results } = await db
    .prepare(`
      SELECT id, role, content, image_data_url, is_error, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY created_at ASC
    `)
    .bind(chatId)
    .all();

  return (results || []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content || "",
    image: row.image_data_url ? { dataUrl: row.image_data_url } : null,
    isError: !!row.is_error,
    createdAt: new Date(row.created_at).getTime()
  }));
}

async function getChatsWithPreview(db, userId) {
  const { results } = await db
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
          ORDER BY m.created_at ASC
          LIMIT 1
        ) AS preview
      FROM chats c
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
    `)
    .bind(userId)
    .all();

  return results || [];
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

async function ensureChat(db, userId, chatId, fallbackTitle = "Новий чат") {
  if (chatId) {
    const existing = await db
      .prepare(`SELECT * FROM chats WHERE id = ? AND user_id = ? LIMIT 1`)
      .bind(chatId, userId)
      .first();

    if (existing) return existing;
  }

  return createChat(db, userId, fallbackTitle);
}

async function appendMessage(db, { chatId, role, content = "", imageDataUrl = null, isError = 0 }) {
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
    .prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`)
    .bind(ts, chatId)
    .run();

  return {
    id,
    chatId,
    role,
    content,
    image: imageDataUrl ? { dataUrl: imageDataUrl } : null,
    isError: !!isError,
    createdAt: new Date(ts).getTime()
  };
}

async function replaceAssistantDraft(db, { chatId, messageId, content }) {
  await db
    .prepare(`
      UPDATE messages
      SET content = ?
      WHERE id = ? AND chat_id = ? AND role = 'assistant'
    `)
    .bind(content, messageId, chatId)
    .run();

  await db
    .prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`)
    .bind(nowIso(), chatId)
    .run();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id"
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const db = env.DB;
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
        const chat = await createChat(db, userId, body.title || "Новий чат");
        return json({ chat });
      }

      if (request.method === "POST" && path === "/api/chats/ensure") {
        const body = await request.json().catch(() => ({}));
        const chat = await ensureChat(db, userId, body.chatId, body.title || "Новий чат");
        return json({ chat });
      }

      if (request.method === "GET" && path.startsWith("/api/chats/")) {
        const parts = path.split("/").filter(Boolean);
        if (parts.length === 3 && parts[0] === "api" && parts[1] === "chats") {
          const chatId = parts[2];
          const chat = await db
            .prepare(`SELECT * FROM chats WHERE id = ? AND user_id = ? LIMIT 1`)
            .bind(chatId, userId)
            .first();

          if (!chat) return json({ error: "Chat not found" }, 404);

          const messages = await getChatMessages(db, chatId);
          return json({
            chat: {
              id: chat.id,
              title: chat.title,
              createdAt: new Date(chat.created_at).getTime(),
              updatedAt: new Date(chat.updated_at).getTime(),
              messages
            }
          });
        }
      }

      if (request.method === "DELETE" && path.startsWith("/api/chats/")) {
        const parts = path.split("/").filter(Boolean);
        if (parts.length === 3 && parts[0] === "api" && parts[1] === "chats") {
          const chatId = parts[2];

          const existing = await db
            .prepare(`SELECT id FROM chats WHERE id = ? AND user_id = ? LIMIT 1`)
            .bind(chatId, userId)
            .first();

          if (!existing) return json({ error: "Chat not found" }, 404);

          await db.batch([
            db.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(chatId),
            db.prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`).bind(chatId, userId)
          ]);

          return json({ ok: true });
        }
      }

      if (request.method === "POST" && path === "/api/messages") {
        const body = await request.json().catch(() => ({}));
        const text = String(body.content || "").trim();
        const imageDataUrl = body.imageDataUrl || null;

        if (!text && !imageDataUrl) {
          return json({ error: "Message content is required" }, 400);
        }

        const title = text ? text.slice(0, 40) : "Новий чат";
        const chat = await ensureChat(db, userId, body.chatId, title);

        const userMessage = await appendMessage(db, {
          chatId: chat.id,
          role: "user",
          content: text,
          imageDataUrl
        });

        return json({
          chat: {
            id: chat.id,
            title: chat.title
          },
          message: userMessage
        });
      }

      if (request.method === "POST" && path === "/api/messages/assistant") {
        const body = await request.json().catch(() => ({}));
        const chatId = body.chatId;
        const content = String(body.content || "");
        const draftId = body.messageId || uid();

        if (!chatId) return json({ error: "chatId is required" }, 400);

        const chat = await db
          .prepare(`SELECT id FROM chats WHERE id = ? AND user_id = ? LIMIT 1`)
          .bind(chatId, userId)
          .first();

        if (!chat) return json({ error: "Chat not found" }, 404);

        const existing = await db
          .prepare(`SELECT id FROM messages WHERE id = ? AND chat_id = ? LIMIT 1`)
          .bind(draftId, chatId)
          .first();

        if (!existing) {
          await db
            .prepare(`
              INSERT INTO messages (id, chat_id, role, content, image_data_url, is_error, created_at)
              VALUES (?, ?, 'assistant', ?, NULL, 0, ?)
            `)
            .bind(draftId, chatId, content, nowIso())
            .run();
        } else {
          await replaceAssistantDraft(db, {
            chatId,
            messageId: draftId,
            content
          });
        }

        await db
          .prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`)
          .bind(nowIso(), chatId)
          .run();

        return json({ ok: true, messageId: draftId });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error?.message || "Internal error" }, 500);
    }
  }
};
