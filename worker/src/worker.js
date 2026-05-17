function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-User-Email, X-User-Name, X-User-Avatar",
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

function toMillis(value) {
  return value ? new Date(value).getTime() : Date.now();
}

async function getOrCreateUser(db, externalUserId, email = "", name = "", avatarUrl = "") {
  if (!externalUserId) {
    throw new Error("Missing external user id");
  }

  let user = await db
    .prepare(`
      SELECT id, telegram_id, email, name, avatar_url, google_sub, created_at
      FROM users
      WHERE google_sub = ?
      LIMIT 1
    `)
    .bind(externalUserId)
    .first();

  if (user) return user;

  await db
    .prepare(`
      INSERT INTO users (telegram_id, email, name, avatar_url, google_sub, created_at)
      VALUES (NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(email || null, name || null, avatarUrl || null, externalUserId)
    .run();

  user = await db
    .prepare(`
      SELECT id, telegram_id, email, name, avatar_url, google_sub, created_at
      FROM users
      WHERE google_sub = ?
      LIMIT 1
    `)
    .bind(externalUserId)
    .first();

  if (!user) {
    throw new Error("Failed to create user");
  }

  return user;
}

async function getChatById(db, userId, chatId) {
  return db
    .prepare(`
      SELECT id, user_id, title, model, system_prompt, created_at, updated_at
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
      SELECT id, role, content, provider, model, prompt_tokens, completion_tokens, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY id ASC
    `)
    .bind(chatId)
    .all();

  return (result.results || []).map((row) => ({
    id: String(row.id),
    role: row.role,
    content: row.content || "",
    createdAt: toMillis(row.created_at),
    provider: row.provider || null,
    model: row.model || null,
    promptTokens: row.prompt_tokens || 0,
    completionTokens: row.completion_tokens || 0
  }));
}

async function getChatsWithPreview(db, userId) {
  const result = await db
    .prepare(`
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
    `)
    .bind(userId)
    .all();

  return (result.results || []).map((row) => ({
    id: String(row.id),
    title: row.title || "Новий чат",
    model: row.model || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    preview: row.preview || ""
  }));
}

async function createChat(db, userId, title = "Новий чат", model = null, systemPrompt = null) {
  await db
    .prepare(`
      INSERT INTO chats (user_id, title, model, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(userId, title, model, systemPrompt)
    .run();

  const created = await db
    .prepare(`
      SELECT id, user_id, title, model, system_prompt, created_at, updated_at
      FROM chats
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(userId)
    .first();

  return created;
}

async function appendMessage(db, { chatId, role, content = "", provider = null, model = null, promptTokens = 0, completionTokens = 0 }) {
  await db
    .prepare(`
      INSERT INTO messages (chat_id, role, content, provider, model, prompt_tokens, completion_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(chatId, role, content, provider, model, promptTokens, completionTokens)
    .run();

  await db
    .prepare(`
      UPDATE chats
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(chatId)
    .run();

  const inserted = await db
    .prepare(`
      SELECT id, role, content, provider, model, prompt_tokens, completion_tokens, created_at
      FROM messages
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(chatId)
    .first();

  return {
    id: String(inserted.id),
    chatId: String(chatId),
    role: inserted.role,
    content: inserted.content || "",
    createdAt: toMillis(inserted.created_at),
    provider: inserted.provider || null,
    model: inserted.model || null,
    promptTokens: inserted.prompt_tokens || 0,
    completionTokens: inserted.completion_tokens || 0
  };
}

async function updateAssistantMessage(db, { userId, chatId, messageId, content, provider = null, model = null }) {
  const chat = await getChatById(db, userId, Number(chatId));
  if (!chat) throw new Error("Chat not found");

  const existing = await db
    .prepare(`
      SELECT id
      FROM messages
      WHERE id = ? AND chat_id = ? AND role = 'assistant'
      LIMIT 1
    `)
    .bind(Number(messageId), Number(chatId))
    .first();

  if (existing) {
    await db
      .prepare(`
        UPDATE messages
        SET content = ?, provider = COALESCE(?, provider), model = COALESCE(?, model)
        WHERE id = ? AND chat_id = ? AND role = 'assistant'
      `)
      .bind(content, provider, model, Number(messageId), Number(chatId))
      .run();

    await db
      .prepare(`
        UPDATE chats
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(Number(chatId))
      .run();

    return { ok: true, messageId: String(messageId) };
  }

  const inserted = await appendMessage(db, {
    chatId: Number(chatId),
    role: "assistant",
    content,
    provider,
    model
  });

  return { ok: true, messageId: String(inserted.id) };
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

    const externalUserId = request.headers.get("X-User-Id");
    const userEmail = request.headers.get("X-User-Email") || "";
    const userName = request.headers.get("X-User-Name") || "";
    const userAvatar = request.headers.get("X-User-Avatar") || "";

    if (!externalUserId) {
      return json({ error: "Missing X-User-Id" }, 401);
    }

    try {
      const user = await getOrCreateUser(db, externalUserId, userEmail, userName, userAvatar);
      const internalUserId = Number(user.id);

      if (request.method === "GET" && path === "/api/chats") {
        const chats = await getChatsWithPreview(db, internalUserId);
        return json({ chats });
      }

      if (request.method === "POST" && path === "/api/chats") {
        const body = await request.json().catch(() => ({}));
        const title = String(body.title || "Новий чат").trim() || "Новий чат";
        const model = body.model ? String(body.model) : null;
        const systemPrompt = body.systemPrompt ? String(body.systemPrompt) : null;

        const chat = await createChat(db, internalUserId, title, model, systemPrompt);

        return json({
          chat: {
            id: String(chat.id),
            title: chat.title || "Новий чат",
            model: chat.model || null,
            created_at: chat.created_at,
            updated_at: chat.updated_at
          }
        });
      }

      if (request.method === "GET" && path.startsWith("/api/chats/")) {
        const parts = path.split("/").filter(Boolean);

        if (parts.length === 3 && parts[0] === "api" && parts[1] === "chats") {
          const chatId = Number(parts[2]);
          const chat = await getChatById(db, internalUserId, chatId);

          if (!chat) {
            return json({ error: "Chat not found" }, 404);
          }

          const messages = await getChatMessages(db, chatId);

          return json({
            chat: {
              id: String(chat.id),
              title: chat.title || "Новий чат",
              model: chat.model || null,
              systemPrompt: chat.system_prompt || null,
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
          const chatId = Number(parts[2]);
          const chat = await getChatById(db, internalUserId, chatId);

          if (!chat) {
            return json({ error: "Chat not found" }, 404);
          }

          await db.batch([
            db.prepare(`DELETE FROM messages WHERE chat_id = ?`).bind(chatId),
            db.prepare(`DELETE FROM chats WHERE id = ? AND user_id = ?`).bind(chatId, internalUserId)
          ]);

          return json({ ok: true });
        }
      }

      if (request.method === "POST" && path === "/api/messages") {
        const body = await request.json().catch(() => ({}));
        const chatId = Number(body.chatId);
        const content = String(body.content || "").trim();

        if (!chatId) {
          return json({ error: "chatId is required" }, 400);
        }

        const chat = await getChatById(db, internalUserId, chatId);
        if (!chat) {
          return json({ error: "Chat not found" }, 404);
        }

        if (!content) {
          return json({ error: "Message content is required" }, 400);
        }

        if (!chat.title || chat.title === "Новий чат" || chat.title === "New chat") {
          await db
            .prepare(`
              UPDATE chats
              SET title = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND user_id = ?
            `)
            .bind(content.slice(0, 48), chatId, internalUserId)
            .run();
        }

        const userMessage = await appendMessage(db, {
          chatId,
          role: "user",
          content
        });

        const updatedChat = await getChatById(db, internalUserId, chatId);

        return json({
          chat: {
            id: String(updatedChat.id),
            title: updatedChat.title || "Новий чат"
          },
          message: userMessage
        });
      }

      if (request.method === "POST" && path === "/api/messages/assistant") {
        const body = await request.json().catch(() => ({}));
        const chatId = Number(body.chatId);
        const messageId = body.messageId ? Number(body.messageId) : null;
        const content = String(body.content || "");
        const provider = body.provider ? String(body.provider) : null;
        const model = body.model ? String(body.model) : null;

        if (!chatId) {
          return json({ error: "chatId is required" }, 400);
        }

        if (messageId) {
          const result = await updateAssistantMessage(db, {
            userId: internalUserId,
            chatId,
            messageId,
            content,
            provider,
            model
          });

          return json(result);
        }

        const inserted = await appendMessage(db, {
          chatId,
          role: "assistant",
          content,
          provider,
          model
        });

        return json({
          ok: true,
          messageId: inserted.id
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error?.message || "Internal error" }, 500);
    }
  }
};
