const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const modelSelect = document.getElementById("model");
const clearBtn = document.getElementById("clearBtn");
const stopBtn = document.getElementById("stopBtn");
const newChatBtn = document.getElementById("newChatBtn");
const chatList = document.getElementById("chatList");
const sendBtn = document.getElementById("sendBtn");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const selectedImageBar = document.getElementById("selectedImageBar");
const selectedImageName = document.getElementById("selectedImageName");
const selectedImagePreview = document.getElementById("selectedImagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const statusText = document.getElementById("statusText");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const sidebar = document.getElementById("sidebar");
const mobileOverlay = document.getElementById("mobileOverlay");
const hamburgerBtn = document.getElementById("hamburgerBtn");

let supaUrl = window.NEXT_PUBLIC_SUPABASE_URL || "https://dfvlipfcblnnuxylhzis.supabase.co";
let supaKey = window.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";
const WORKER_BASE = "https://ai1.ai-beta69690.workers.dev";

const ALLOWED_MODELS = {
  "groq/llama-3.3-70b-versatile": {
    system: "Ти швидкий і точний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "gemini/gemini-2.5-flash": {
    system: "Ти мультимодальний AI-помічник Gemini. Відповідай українською.",
    tokens: 4096,
    vision: true
  },
  "meta/llama-3.3-70b-instruct": {
    system: "Ти потужний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "qwen/qwen3.5-122b-a10b": {
    system: "Ти сильний AI-помічник для складних запитів. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "google/gemma-3-27b-it": {
    system: "Ти мультимодальний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: true
  },
  "meta/llama-3.2-90b-vision-instruct": {
    system: "Ти AI-помічник для аналізу зображень. Відповідай українською.",
    tokens: 2048,
    vision: true
  }
};

let sb = null;
if (supaUrl && supaKey && window.supabase) {
  sb = window.supabase.createClient(supaUrl, supaKey);
}

const STORAGE_KEY = "ai-chat-sync-v60";
let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;
let cloudLoaded = false;

let state = JSON.parse(
  localStorage.getItem(STORAGE_KEY) ||
  localStorage.getItem("ai-chat-sync-v50") ||
  localStorage.getItem("ai-chat-sync-v49") ||
  localStorage.getItem("ai-chat-sync-v48") ||
  "null"
);

if (!state || !Array.isArray(state.chats)) {
  state = { activeChatId: null, chats: [], theme: "dark" };
}
if (!state.theme) state.theme = "dark";

const renderer = new marked.Renderer();
renderer.code = function(code, language) {
  const validLang = hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;
  return `<div class="code-block">
    <div class="code-header">
      <span>${validLang}</span>
      <div style="display:flex;gap:12px;">
        <button class="copy-btn" onclick="copyCodeBtn(this)">📋 Копіювати</button>
      </div>
    </div>
    <pre><code class="hljs ${validLang}">${highlighted}</code></pre>
  </div>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

window.copyCodeBtn = function(btn) {
  const pre = btn.parentElement.parentElement.nextElementSibling;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.innerHTML = "✅";
    setTimeout(() => {
      btn.innerHTML = "📋 Копіювати";
    }, 2000);
  });
};

function formatThinking(text) {
  if (!text) return "";
  let processed = text.replace(/<think>/g, '<details class="thought-block"><summary>Думка</summary><div class="thought-content">');
  processed = processed.replace(/<\/think>/g, "</div></details>");
  return processed;
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(formatThinking(text || "")), {
    ADD_TAGS: ["details", "summary"]
  });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getD1UserId() {
  const meta = currentUser?.user_metadata || {};
  const raw = meta.d1_user_id ?? meta.user_id ?? meta.db_user_id ?? 1;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : 1;
}

function buildWorkerUrl(path) {
  const d1UserId = getD1UserId();
  const url = new URL(path, WORKER_BASE);
  if (d1UserId) {
    url.searchParams.set("user_id", String(d1UserId));
  }
  return url.toString();
}

function getWorkerHeaders(extra = {}) {
  const headers = { ...extra };
  const d1UserId = getD1UserId();
  if (d1UserId) {
    headers["X-User-Id"] = String(d1UserId);
  }
  return headers;
}

async function workerFetch(path, options = {}) {
  const finalOptions = { ...options };
  finalOptions.headers = getWorkerHeaders(options.headers || {});
  return fetch(buildWorkerUrl(path), finalOptions);
}

function getActiveChat() {
  return state.chats.find(c => String(c.id) === String(state.activeChatId)) || null;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureLocalChat() {
  let active = getActiveChat();
  if (!active) {
    active = {
      id: uid(),
      title: "Новий чат",
      messages: [],
      createdAt: Date.now(),
      localOnly: true
    };
    state.chats.unshift(active);
    state.activeChatId = active.id;
    saveState();
  }
  return active;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = state.theme === "light" ? "🌙" : "☀️";
  }
}

function renderAuthState() {
  if (!authLoggedOut || !authLoggedIn) return;

  if (!currentUser) {
    authLoggedOut.classList.remove("hidden");
    authLoggedIn.classList.add("hidden");
    return;
  }

  authLoggedOut.classList.add("hidden");
  authLoggedIn.classList.remove("hidden");

  const meta = currentUser.user_metadata || {};
  if (userName) userName.textContent = meta.full_name || meta.name || "Користувач";
  if (userEmail) userEmail.textContent = currentUser.email || "";
  if (userAvatar) userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/40x40/png";
}

function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";

  for (const item of state.chats) {
    const div = document.createElement("div");
    div.className = `chat-item ${String(item.id) === String(state.activeChatId) ? "active" : ""}`;
    div.innerHTML = `
      <div class="chat-item-title">${escapeHtml(item.title || "Новий чат")}</div>
      <button class="chat-item-delete">✕</button>
    `;

    div.querySelector(".chat-item-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Видалити чат?")) return;

      try {
        if (!item.localOnly && !String(item.id).startsWith("local-")) {
          await deleteCloudChat(item.id);
        }
      } catch (err) {
        console.error(err);
      }

      state.chats = state.chats.filter(c => String(c.id) !== String(item.id));
      if (String(state.activeChatId) === String(item.id)) {
        state.activeChatId = state.chats[0]?.id || null;
      }
      saveState();
      renderAll();
    };

    div.onclick = async () => {
      if (requestInFlight) return;
      state.activeChatId = item.id;
      saveState();

      if (!item.localOnly && !item.messagesLoaded) {
        try {
          const data = await fetchCloudChat(item.id);
          mergeCloudChatIntoState(data.chat);
        } catch (err) {
          console.error(err);
        }
      }

      renderAll();
      sidebar?.classList.remove("open");
      mobileOverlay?.classList.remove("show");
      document.body.classList.remove("no-scroll");
    };

    chatList.appendChild(div);
  }
}

function renderMessages() {
  const active = getActiveChat() || ensureLocalChat();
  if (!chat) return;

  chat.innerHTML = "";

  if (!active.messages.length) {
    chat.innerHTML = `<div class="chat-empty">Чим можу допомогти?</div>`;
    return;
  }

  for (const msg of active.messages) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.role}`;

    const inner = document.createElement("div");
    inner.className = "message-content";

    if (msg.isError) {
      inner.innerHTML = `
        <div style="background:var(--danger-bg);color:var(--danger-text);padding:12px;border-radius:12px;border:1px solid var(--danger-text);">
          <strong>Помилка:</strong> ${escapeHtml(msg.content || "Невідома помилка")}
          <br>
          <button class="btn" style="margin-top:10px;width:auto;border-color:var(--danger-text);color:var(--danger-text);" onclick="retryMessage()">🔄 Повторити</button>
        </div>
      `;
    } else if (msg.role === "assistant") {
      inner.innerHTML = renderMarkdown(msg.content || "");
    } else {
      inner.textContent = msg.content || "";
    }

    if (msg.image?.dataUrl) {
      const img = document.createElement("img");
      img.src = msg.image.dataUrl;
      img.className = "inline-preview-image";
      inner.appendChild(img);
    }

    if (Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        if (att.type && att.type.startsWith("image/") && att.url) {
          const img = document.createElement("img");
          img.src = att.url;
          img.className = "inline-preview-image";
          inner.appendChild(img);
        }
      }
    }

    wrapper.appendChild(inner);
    chat.appendChild(wrapper);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuthState();
  renderChatList();
  renderMessages();

  if (stopBtn && sendBtn) {
    if (requestInFlight) {
      stopBtn.classList.remove("hidden");
      sendBtn.classList.add("hidden");
    } else {
      stopBtn.classList.add("hidden");
      sendBtn.classList.remove("hidden");
    }
  }
}

function autoResize() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px";
}

function updateSelectedImageUI() {
  if (!selectedImageBar || !selectedImagePreview) return;

  if (!selectedImage) {
    selectedImageBar.classList.add("hidden");
    selectedImagePreview.removeAttribute("src");
    return;
  }

  selectedImageBar.classList.remove("hidden");
  if (selectedImageName) selectedImageName.textContent = selectedImage.name || "Зображення";
  selectedImagePreview.src = selectedImage.dataUrl;
}

function clearSelectedImage() {
  selectedImage = null;
  if (imageInput) imageInput.value = "";
  updateSelectedImageUI();
}

function setBusy(isBusy, text = "") {
  requestInFlight = isBusy;
  if (statusText) {
    statusText.textContent = text || (isBusy ? "Генерація..." : "Готово");
    statusText.classList.remove("hidden");
  }
  renderAll();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCloudMessage(row) {
  return {
    id: String(row.id),
    role: row.role,
    content: row.content || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    provider: row.provider || null,
    model: row.model || null,
    prompt_tokens: row.prompt_tokens || 0,
    completion_tokens: row.completion_tokens || 0,
    attachments: Array.isArray(row.attachments) ? row.attachments : []
  };
}

function mergeCloudChatIntoState(chatData) {
  const existingIndex = state.chats.findIndex(c => String(c.id) === String(chatData.id));
  const merged = {
    id: chatData.id,
    title: chatData.title || "Новий чат",
    model: chatData.model || "",
    system_prompt: chatData.system_prompt || "",
    createdAt: chatData.created_at ? new Date(chatData.created_at).getTime() : Date.now(),
    updatedAt: chatData.updated_at ? new Date(chatData.updated_at).getTime() : Date.now(),
    localOnly: false,
    messagesLoaded: true,
    messages: Array.isArray(chatData.messages) ? chatData.messages.map(normalizeCloudMessage) : []
  };

  if (existingIndex >= 0) {
    state.chats[existingIndex] = {
      ...state.chats[existingIndex],
      ...merged
    };
  } else {
    state.chats.unshift(merged);
  }

  if (!state.activeChatId) {
    state.activeChatId = merged.id;
  }

  saveState();
}

async function fetchCloudChats() {
  const res = await workerFetch("/api/chats", { method: "GET" });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function createCloudChat(title = "New chat", model = "auto") {
  const res = await workerFetch("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, model })
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function fetchCloudChat(chatId) {
  const res = await workerFetch(`/api/chats/${chatId}`, { method: "GET" });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function deleteCloudChat(chatId) {
  const res = await workerFetch(`/api/chats/${chatId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function createCloudMessage(chatId, payload) {
  const res = await workerFetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function uploadCloudAttachment(chatId, file, messageId = null) {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  if (messageId) formData.append("message_id", String(messageId));
  formData.append("file", file);

  const res = await workerFetch("/api/attachments/upload", {
    method: "POST",
    body: formData
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function loadCloudChats() {
  if (cloudLoaded) return;

  try {
    const data = await fetchCloudChats();
    const chats = Array.isArray(data.chats) ? data.chats : [];

    state.chats = chats.map(item => ({
      id: item.id,
      title: item.title || "Новий чат",
      preview: item.preview || "",
      model: item.model || "",
      createdAt: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
      updatedAt: item.updated_at ? new Date(item.updated_at).getTime() : Date.now(),
      messages: [],
      localOnly: false,
      messagesLoaded: false
    }));

    if (state.chats.length) {
      state.activeChatId = state.chats[0].id;
      const full = await fetchCloudChat(state.chats[0].id);
      mergeCloudChatIntoState(full.chat);
    } else {
      state.activeChatId = null;
    }

    saveState();
    renderAll();
    cloudLoaded = true;
  } catch (err) {
    console.error("loadCloudChats failed:", err);
  }
}

window.retryMessage = function() {
  const active = getActiveChat();
  if (!active) return;

  const lastError = active.messages[active.messages.length - 1];
  if (lastError?.isError) {
    active.messages.pop();
  }

  const lastUserMsg = [...active.messages].reverse().find(m => m.role === "user");
  if (lastUserMsg) {
    selectedImage = lastUserMsg.image || null;
    updateSelectedImageUI();
    sendChatMessage(lastUserMsg.content || "", true);
  }
};

function buildMessagesForAPI(active, assistantMsgId, modelConf) {
  const rawMessages = [{ role: "system", content: modelConf.system }];

  const recent = active.messages
    .slice(-12)
    .filter(m => m.id !== assistantMsgId && !m.isError);

  for (const m of recent) {
    if (m.role === "user") {
      const text = (m.content || "").trim();

      if (m.image?.dataUrl && modelConf.vision) {
        rawMessages.push({
          role: "user",
          content: [
            { type: "text", text: text || "Опиши це зображення" },
            { type: "image_url", image_url: { url: m.image.dataUrl } }
          ]
        });
      } else {
        rawMessages.push({
          role: "user",
          content: text || (m.image?.dataUrl ? "Користувач надіслав зображення." : "")
        });
      }
    } else if (m.role === "assistant") {
      rawMessages.push({
        role: "assistant",
        content: typeof m.content === "string" ? m.content : ""
      });
    }
  }

  const normalized = [];
  let systemMessage = null;

  for (const msg of rawMessages) {
    if (msg.role === "system") {
      systemMessage = msg;
      continue;
    }

    if (!normalized.length) {
      normalized.push(msg);
      continue;
    }

    const prev = normalized[normalized.length - 1];

    if (prev.role === msg.role) {
      if (typeof prev.content === "string" && typeof msg.content === "string") {
        prev.content = `${prev.content}\n\n${msg.content}`.trim();
      } else if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
        prev.content = [...prev.content, ...msg.content];
      } else if (typeof prev.content === "string" && Array.isArray(msg.content)) {
        prev.content = [{ type: "text", text: prev.content }, ...msg.content];
      } else if (Array.isArray(prev.content) && typeof msg.content === "string") {
        prev.content = [...prev.content, { type: "text", text: msg.content }];
      }
    } else {
      normalized.push(msg);
    }
  }

  return systemMessage ? [systemMessage, ...normalized] : normalized;
}

async function ensureRemoteChat(active, firstMessageText) {
  if (!active.localOnly && !String(active.id).startsWith("local-")) return active;

  const created = await createCloudChat((firstMessageText || "Новий чат").slice(0, 30) || "Новий чат", modelSelect?.value || "auto");
  const oldId = active.id;
  const newChat = {
    id: created.chat.id,
    title: created.chat.title || "Новий чат",
    model: created.chat.model || "",
    system_prompt: created.chat.system_prompt || "",
    createdAt: created.chat.created_at ? new Date(created.chat.created_at).getTime() : Date.now(),
    updatedAt: created.chat.updated_at ? new Date(created.chat.updated_at).getTime() : Date.now(),
    localOnly: false,
    messagesLoaded: true,
    messages: []
  };

  state.chats = state.chats.map(c => String(c.id) === String(oldId) ? newChat : c);
  state.activeChatId = newChat.id;
  saveState();
  return newChat;
}

async function sendChatMessage(text, isRetry = false) {
  if (requestInFlight) return;

  let active = getActiveChat() || ensureLocalChat();
  const modelId = modelSelect?.value || "groq/llama-3.3-70b-versatile";
  const modelConf = ALLOWED_MODELS[modelId] || ALLOWED_MODELS["groq/llama-3.3-70b-versatile"];

  if (!isRetry) {
    if (selectedImage && !modelConf.vision) {
      active.messages.push({
        id: uid(),
        role: "assistant",
        isError: true,
        content: "Ця модель не підтримує фото. Обери Gemini Flash, Gemma 3 або Llama 3.2 Vision."
      });
      renderAll();
      return;
    }

    active.messages.push({
      id: uid(),
      role: "user",
      content: text,
      image: selectedImage,
      createdAt: Date.now(),
      attachments: []
    });

    if (active.messages.length === 1) {
      active.title = (text || "Фото").slice(0, 30) || "Новий чат";
    }

    if (active.messages.length > 50) {
      active.messages = active.messages.slice(-50);
    }

    if (promptInput) promptInput.value = "";
    autoResize();
    saveState();
  }

  const userMessage = [...active.messages].reverse().find(m => m.role === "user");
  const assistantMsg = {
    id: uid(),
    role: "assistant",
    content: "",
    createdAt: Date.now()
  };

  active.messages.push(assistantMsg);
  renderAll();
  setBusy(true, "Генерація...");

  const controller = new AbortController();
  currentController = controller;

  try {
    active = await ensureRemoteChat(active, text);

    const reloadedActive = getActiveChat();
    if (!reloadedActive) throw new Error("Не вдалося підготувати чат");
    active = reloadedActive;

    let createdUserMessage = null;
    if (userMessage && !userMessage.cloudSaved) {
      const created = await createCloudMessage(active.id, {
        role: "user",
        content: userMessage.content || "",
        provider: "web",
        model: modelId,
        prompt_tokens: 0,
        completion_tokens: 0
      });

      userMessage.id = String(created.message.id);
      userMessage.cloudSaved = true;

      if (selectedImage && imageInput?.files?.[0]) {
        const uploaded = await uploadCloudAttachment(active.id, imageInput.files[0], created.message.id);
        userMessage.attachments = [uploaded.attachment];
      }

      createdUserMessage = created.message;
    }

    const safeMessages = buildMessagesForAPI(active, assistantMsg.id, modelConf);

    const response = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: safeMessages,
        temperature: 0.2,
        max_tokens: modelConf.tokens,
        top_p: 0.9,
        stream: true
      })
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Порожня відповідь сервера");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const msgEls = chat.querySelectorAll(".message-wrapper.assistant .message-content");
    const targetEl = msgEls[msgEls.length - 1];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || "";
            if (typeof delta === "string" && delta) {
              assistantMsg.content += delta;
              if (targetEl) {
                targetEl.innerHTML = renderMarkdown(assistantMsg.content);
                chat.scrollTop = chat.scrollHeight;
              }
            }
          } catch (_) {}
        }
      }
    }

    const createdAssistant = await createCloudMessage(active.id, {
      role: "assistant",
      content: assistantMsg.content || "",
      provider: "openrouter",
      model: modelId,
      prompt_tokens: 0,
      completion_tokens: 0
    });

    assistantMsg.id = String(createdAssistant.message.id);
    assistantMsg.cloudSaved = true;

    clearSelectedImage();
  } catch (e) {
    if (e?.name === "AbortError") {
      assistantMsg.content += "\n\n*[Зупинено]*";
      renderAll();
    } else {
      active.messages.pop();
      active.messages.push({
        id: uid(),
        role: "assistant",
        isError: true,
        content: e.message || "Невідома помилка"
      });
      renderAll();
    }
  } finally {
    currentController = null;
    saveState();
    setBusy(false, "Готово");
  }
}

themeToggleBtn?.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  saveState();
  applyTheme();
});

hamburgerBtn?.addEventListener("click", () => {
  sidebar?.classList.add("open");
  mobileOverlay?.classList.add("show");
  document.body.classList.add("no-scroll");
});

mobileOverlay?.addEventListener("click", () => {
  sidebar?.classList.remove("open");
  mobileOverlay?.classList.remove("show");
  document.body.classList.remove("no-scroll");
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = promptInput?.value.trim() || "";
  if (text || selectedImage) sendChatMessage(text);
});

promptInput?.addEventListener("input", autoResize);

promptInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form?.requestSubmit();
  }
});

stopBtn?.addEventListener("click", () => currentController?.abort());

clearBtn?.addEventListener("click", () => {
  const active = getActiveChat() || ensureLocalChat();
  if (confirm("Очистити історію?")) {
    active.messages = [];
    active.title = "Новий чат";
    saveState();
    renderAll();
  }
});

newChatBtn?.addEventListener("click", () => {
  state.activeChatId = null;
  ensureLocalChat();
  renderAll();
  sidebar?.classList.remove("open");
  mobileOverlay?.classList.remove("show");
  document.body.classList.remove("no-scroll");
});

imageBtn?.addEventListener("click", () => imageInput?.click());

imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    alert("Максимальний розмір: 5 МБ.");
    imageInput.value = "";
    return;
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    selectedImage = {
      name: file.name,
      type: file.type,
      dataUrl
    };
    updateSelectedImageUI();
  } catch (e) {
    alert("Помилка завантаження фото");
  }
});

removeImageBtn?.addEventListener("click", clearSelectedImage);

sb?.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();

  if (currentUser) {
    cloudLoaded = false;
    await loadCloudChats();
  }
});

sb?.auth.getSession()
  .then(async ({ data }) => {
    currentUser = data?.session?.user || null;
    renderAuthState();
    if (currentUser) {
      await loadCloudChats();
    }
  })
  .catch(() => {});

googleLoginBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" }
  });
});

logoutBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  cloudLoaded = false;
  renderAuthState();
});

applyTheme();
renderAll();
autoResize();
updateSelectedImageUI();
