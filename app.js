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

const SUPABASE_URL = "https://dfvlipfcblnnuxylhzis.supabase.co";
const SUPABASE_KEY = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";
const HISTORY_API_BASE = "https://ai1.ai-beta69690.workers.dev";
const STORAGE_KEY = "ai-chat-worker-v6";

const ALLOWED_MODELS = {
  auto: {
    system: "Ти корисний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: true
  },
  "github/gpt-4o-mini": {
    system: "Ти корисний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
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
  "mistral/codestral": {
    system: "Ти сильний AI-помічник для коду і технічних задач. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "mistral/mistral-large": {
    system: "Ти потужний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "meta/llama-3.3-70b-instruct": {
    system: "Ти потужний AI-помічник. Відповідай українською.",
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
  },
  "cerebras/llama-3.1-70b": {
    system: "Ти швидкий AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "github/phi-4": {
    system: "Ти розумний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  }
};

let sb = null;
if (window.supabase && SUPABASE_URL && SUPABASE_KEY) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;
let hasLoadedChats = false;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
if (!state || !Array.isArray(state.chats)) {
  state = {
    activeChatId: null,
    chats: [],
    drafts: {},
    theme: "dark"
  };
}
if (!state.theme) state.theme = "dark";
if (!state.drafts || typeof state.drafts !== "object") state.drafts = {};

const renderer = new marked.Renderer();
renderer.code = function (code, language) {
  const validLang = hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;
  return `<pre><code class="hljs ${validLang}">${highlighted}</code></pre>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true
});

function formatThinking(text) {
  if (!text) return "";
  let processed = text.replace(/<think>/g, `<details class="thought-block"><summary>Міркування</summary><div class="thought-content">`);
  processed = processed.replace(/<\/think>/g, `</div></details>`);
  return processed;
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(formatThinking(text)), {
    ADD_TAGS: ["details", "summary"]
  });
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getChatKey(chatItem) {
  return chatItem?.id || chatItem?.localId || null;
}

function getActiveChat() {
  return state.chats.find((c) => getChatKey(c) === state.activeChatId) || null;
}

function getActiveChatKey() {
  const active = getActiveChat();
  return active ? getChatKey(active) : "global";
}

function saveDraft(value) {
  state.drafts[getActiveChatKey()] = value;
  saveState();
}

function loadDraft() {
  const draft = state.drafts[getActiveChatKey()] || "";
  if (promptInput && document.activeElement !== promptInput) {
    promptInput.value = draft;
    autoResize();
  }
}

function clearDraftForActiveChat() {
  delete state.drafts[getActiveChatKey()];
  saveState();
  if (promptInput) {
    promptInput.value = "";
    autoResize();
  }
}

function createLocalChat() {
  return {
    id: null,
    localId: uid(),
    title: "Новий чат",
    preview: "",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function ensureLocalChatStub() {
  let active = getActiveChat();
  if (!active) {
    active = createLocalChat();
    state.chats.unshift(active);
    state.activeChatId = getChatKey(active);
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
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
  if (userName) userName.textContent = meta.full_name || meta.name || currentUser.email || "User";
  if (userEmail) userEmail.textContent = currentUser.email || "";
  if (userAvatar) userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/40x40/png";
}

function renderChatList() {
  chatList.innerHTML = "";

  for (const item of state.chats) {
    const isActive = getChatKey(item) === state.activeChatId;
    const subtitle =
      (item.messages || []).find((m) => m.role === "user")?.content ||
      item.preview ||
      "Порожній чат";

    const div = document.createElement("div");
    div.className = `chat-item ${isActive ? "active" : ""}`;
    div.innerHTML = `
      <div class="chat-item-main">
        <div class="chat-item-title">${escapeHtml(item.title || "Новий чат")}</div>
        <div class="chat-item-subtitle">${escapeHtml(String(subtitle).slice(0, 90))}</div>
      </div>
      <button class="chat-item-delete" title="Видалити">✕</button>
    `;

    div.querySelector(".chat-item-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Видалити цей чат?")) return;

      if (item.id && currentUser) {
        await historyApi(`/api/chats/${item.id}`, { method: "DELETE" }).catch(console.error);
      }

      state.chats = state.chats.filter((c) => getChatKey(c) !== getChatKey(item));
      if (!state.chats.length) {
        const newChat = createLocalChat();
        state.chats = [newChat];
        state.activeChatId = getChatKey(newChat);
      } else {
        state.activeChatId = getChatKey(state.chats[0]);
      }
      saveState();
      renderAll();
    };

    div.onclick = async () => {
      if (requestInFlight) return;
      state.activeChatId = getChatKey(item);
      saveState();

      if (item.id && currentUser) {
        await loadChatDetails(item.id);
      } else {
        renderAll();
      }

      closeSidebar();
    };

    chatList.appendChild(div);
  }
}

function renderMessages() {
  chat.innerHTML = `<div class="chat-inner"></div>`;
  const inner = chat.querySelector(".chat-inner");
  const active = getActiveChat();

  if (!active || !active.messages?.length) {
    inner.innerHTML = `<div class="chat-empty">Що хочеш дізнатись?</div>`;
    return;
  }

  for (const msg of active.messages) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.role}`;

    const content = document.createElement("div");
    content.className = "message-content";

    if (msg.isError) {
      content.innerHTML = `
        <div class="error-card">
          <strong>Помилка</strong><br>
          ${escapeHtml(msg.content || "Невідома помилка")}
          <div class="error-actions">
            <button class="secondary-btn" onclick="retryMessage()">Спробувати ще раз</button>
          </div>
        </div>
      `;
    } else if (msg.role === "assistant") {
      content.innerHTML = renderMarkdown(msg.content || "");
    } else {
      const text = document.createElement("div");
      text.textContent = msg.content || "";
      content.appendChild(text);
    }

    if (msg.image?.dataUrl) {
      const img = document.createElement("img");
      img.src = msg.image.dataUrl;
      img.alt = "uploaded image";
      img.className = "inline-preview-image";
      content.appendChild(img);
    }

    wrapper.appendChild(content);
    inner.appendChild(wrapper);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuthState();
  renderChatList();
  renderMessages();

  if (requestInFlight) {
    stopBtn?.classList.remove("hidden");
    sendBtn?.classList.add("hidden");
  } else {
    stopBtn?.classList.add("hidden");
    sendBtn?.classList.remove("hidden");
  }

  loadDraft();
}

function autoResize() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + "px";
}

function updateSelectedImageUI() {
  if (!selectedImage) {
    selectedImageBar.classList.add("hidden");
    selectedImagePreview.removeAttribute("src");
    selectedImageName.textContent = "";
    return;
  }

  selectedImageBar.classList.remove("hidden");
  selectedImagePreview.src = selectedImage.dataUrl;
  selectedImageName.textContent = selectedImage.name || "image";
}

function clearSelectedImage() {
  selectedImage = null;
  if (imageInput) imageInput.value = "";
  updateSelectedImageUI();
}

function setBusy(isBusy, text = "") {
  requestInFlight = isBusy;
  if (statusText) {
    statusText.textContent = text || "";
    statusText.classList.toggle("hidden", !text);
  }
  renderAll();
}

function closeSidebar() {
  sidebar?.classList.remove("open");
  mobileOverlay?.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

function openSidebar() {
  sidebar?.classList.add("open");
  mobileOverlay?.classList.add("show");
  document.body.classList.add("no-scroll");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

async function historyApi(path, options = {}) {
  if (!currentUser?.id) {
    throw new Error("Спочатку увійди через Google");
  }

  const response = await fetch(`${HISTORY_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": currentUser.id,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `History API error ${response.status}`);
  }

  return data;
}

async function loadChatsFromWorker() {
  if (!currentUser || hasLoadedChats) return;

  try {
    const data = await historyApi("/api/chats");
    const serverChats = (data.chats || []).map((chatItem) => ({
      id: chatItem.id,
      localId: chatItem.id,
      title: chatItem.title || "Новий чат",
      preview: chatItem.preview || "",
      messages: [],
      createdAt: chatItem.created_at ? new Date(chatItem.created_at).getTime() : Date.now(),
      updatedAt: chatItem.updated_at ? new Date(chatItem.updated_at).getTime() : Date.now()
    }));

    const localUnsaved = state.chats.filter((c) => !c.id);
    state.chats = [...localUnsaved, ...serverChats];

    if (!state.chats.length) {
      const chat = createLocalChat();
      state.chats = [chat];
      state.activeChatId = getChatKey(chat);
    } else if (!state.activeChatId || !state.chats.find((c) => getChatKey(c) === state.activeChatId)) {
      state.activeChatId = getChatKey(state.chats[0]);
    }

    saveState();
    renderAll();

    const active = getActiveChat();
    if (active?.id) {
      await loadChatDetails(active.id);
    }

    hasLoadedChats = true;
  } catch (e) {
    console.error("Не вдалося завантажити чати:", e);
  }
}

async function loadChatDetails(chatId) {
  const data = await historyApi(`/api/chats/${chatId}`);
  const fullChat = data.chat;

  let existing = state.chats.find((c) => c.id === chatId);
  if (!existing) {
    existing = {
      id: chatId,
      localId: chatId,
      title: fullChat.title || "Новий чат",
      preview: "",
      messages: [],
      createdAt: fullChat.createdAt || Date.now(),
      updatedAt: fullChat.updatedAt || Date.now()
    };
    state.chats.unshift(existing);
  }

  existing.id = chatId;
  existing.localId = chatId;
  existing.title = fullChat.title || existing.title;
  existing.messages = Array.isArray(fullChat.messages) ? fullChat.messages : [];
  existing.preview = existing.messages.find((m) => m.role === "user")?.content || "";
  existing.createdAt = fullChat.createdAt || existing.createdAt;
  existing.updatedAt = fullChat.updatedAt || existing.updatedAt;

  state.activeChatId = chatId;
  saveState();
  renderAll();
}

window.retryMessage = function () {
  const active = getActiveChat();
  if (!active) return;

  const lastError = active.messages[active.messages.length - 1];
  if (lastError?.isError) active.messages.pop();

  const lastUserMsg = [...active.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return;

  selectedImage = lastUserMsg.image || null;
  updateSelectedImageUI();
  sendChatMessage(lastUserMsg.content, true);
};

function buildMessagesForAPI(active, assistantMsgId, modelConf) {
  const rawMessages = [{ role: "system", content: modelConf.system }];

  const recent = active.messages
    .slice(-12)
    .filter((m) => m.id !== assistantMsgId && !m.isError);

  for (const m of recent) {
    if (m.role === "user") {
      const text = (m.content || "").trim();

      if (m.image?.dataUrl) {
        rawMessages.push({
          role: "user",
          content: [
            { type: "text", text },
            { type: "image_url", image_url: { url: m.image.dataUrl } }
          ]
        });
      } else {
        rawMessages.push({
          role: "user",
          content: text
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
        prev.content += `\n${msg.content.trim()}`;
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

async function ensureServerChatForActive(firstMessageText = "Новий чат") {
  let active = ensureLocalChatStub();
  if (active.id) return active;

  const created = await historyApi("/api/chats", {
    method: "POST",
    body: JSON.stringify({
      title: (firstMessageText || "Новий чат").slice(0, 48)
    })
  });

  active.id = created.chat.id;
  active.localId = created.chat.id;
  active.title = created.chat.title || active.title;
  state.activeChatId = active.id;
  saveState();
  return active;
}

async function sendChatMessage(text, isRetry = false) {
  if (requestInFlight) return;

  text = (text || "").trim();
  if (!text && !selectedImage) return;

  if (!currentUser) {
    alert("Спочатку увійди через Google, щоб зберігати історію.");
    return;
  }

  let active = ensureLocalChatStub();
  const modelId = modelSelect?.value || "auto";
  const modelConf = ALLOWED_MODELS[modelId] || ALLOWED_MODELS.auto;

  if (!isRetry && selectedImage && !modelConf.vision) {
    active.messages.push({
      id: uid(),
      role: "assistant",
      isError: true,
      content: "Ця модель не підтримує зображення. Обери Auto або vision-модель.",
      createdAt: Date.now()
    });
    saveState();
    renderAll();
    return;
  }

  setBusy(true, "Думаю...");

  try {
    active = await ensureServerChatForActive(text);

    let localUserMessage;
    if (!isRetry) {
      localUserMessage = {
        id: uid(),
        role: "user",
        content: text,
        image: selectedImage,
        createdAt: Date.now()
      };

      active.messages.push(localUserMessage);

      if (!active.title || active.title === "Новий чат") {
        active.title = text ? text.slice(0, 48) : "Новий чат";
      }

      active.preview = text || active.preview || "";
      active.updatedAt = Date.now();
      saveState();
      renderAll();

      const saved = await historyApi("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: active.id,
          content: text,
          imageDataUrl: selectedImage?.dataUrl || null
        })
      });

      localUserMessage.id = saved.message.id;
      active.id = saved.chat.id;
      active.localId = saved.chat.id;
      active.title = saved.chat.title || active.title;
      active.updatedAt = saved.message.createdAt || Date.now();
      state.activeChatId = active.id;
      saveState();
      clearDraftForActiveChat();
    }

    const assistantMsg = {
      id: uid(),
      role: "assistant",
      content: "",
      createdAt: Date.now()
    };

    active.messages.push(assistantMsg);
    active.updatedAt = Date.now();
    saveState();
    renderAll();

    const safeMessages = buildMessagesForAPI(active, assistantMsg.id, modelConf);
    const controller = new AbortController();
    currentController = controller;

    const response = await fetch("/api/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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
      let message = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.details) {
          message = typeof parsed.details === "string" ? parsed.details : JSON.stringify(parsed.details);
        } else if (parsed?.error?.message) {
          message = parsed.error.message;
        } else if (parsed?.error) {
          message = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
        } else if (raw) {
          message = raw;
        }
      } catch {
        if (raw) message = raw;
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Порожня відповідь сервера");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

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
            const delta =
              parsed?.choices?.[0]?.delta?.content ??
              parsed?.choices?.[0]?.message?.content;

            if (typeof delta === "string") {
              assistantMsg.content += delta;
              active.updatedAt = Date.now();
              renderMessages();
            }
          } catch {}
        }
      }
    }

    const savedAssistant = await historyApi("/api/messages/assistant", {
      method: "POST",
      body: JSON.stringify({
        chatId: active.id,
        messageId: assistantMsg.id,
        content: assistantMsg.content,
        isError: false
      })
    });

    if (savedAssistant?.messageId) {
      assistantMsg.id = savedAssistant.messageId;
    }

    active.updatedAt = Date.now();
    saveState();
    clearSelectedImage();
    await loadChatDetails(active.id);
  } catch (e) {
    const activeNow = getActiveChat();
    if (e?.name === "AbortError") {
      saveState();
    } else {
      if (activeNow?.messages?.length) {
        const last = activeNow.messages[activeNow.messages.length - 1];
        if (last?.role === "assistant" && !last.content) {
          activeNow.messages.pop();
        }
      }

      const errorMsg = {
        id: uid(),
        role: "assistant",
        isError: true,
        content: e.message || "Невідома помилка",
        createdAt: Date.now()
      };

      activeNow.messages.push(errorMsg);
      activeNow.updatedAt = Date.now();
      saveState();
      renderAll();

      if (activeNow?.id) {
        await historyApi("/api/messages/assistant", {
          method: "POST",
          body: JSON.stringify({
            chatId: activeNow.id,
            messageId: errorMsg.id,
            content: errorMsg.content,
            isError: true
          })
        }).catch(() => {});
      }
    }
  } finally {
    currentController = null;
    setBusy(false, "");
  }
}

themeToggleBtn?.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  saveState();
  applyTheme();
});

hamburgerBtn?.addEventListener("click", openSidebar);
mobileOverlay?.addEventListener("click", closeSidebar);

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = promptInput?.value.trim() || "";
  if (text || selectedImage) sendChatMessage(text);
});

promptInput?.addEventListener("input", () => {
  autoResize();
  saveDraft(promptInput.value);
});

promptInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form?.requestSubmit();
  }
});

stopBtn?.addEventListener("click", () => {
  currentController?.abort();
});

clearBtn?.addEventListener("click", async () => {
  const active = getActiveChat();
  if (!active) return;
  if (!confirm("Очистити поточний чат?")) return;

  if (active.id && currentUser) {
    await historyApi(`/api/chats/${active.id}`, { method: "DELETE" }).catch(console.error);
  }

  const newLocalChat = createLocalChat();
  state.chats = [newLocalChat, ...state.chats.filter((c) => getChatKey(c) !== getChatKey(active))];
  state.activeChatId = newLocalChat.localId;
  saveState();
  renderAll();
});

newChatBtn?.addEventListener("click", () => {
  const newLocalChat = createLocalChat();
  state.chats.unshift(newLocalChat);
  state.activeChatId = newLocalChat.localId;
  saveState();
  renderAll();
  closeSidebar();
});

imageBtn?.addEventListener("click", () => {
  imageInput?.click();
});

imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    alert("Файл завеликий. Максимум 5 MB.");
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
  } catch {
    alert("Не вдалося завантажити зображення");
  }
});

removeImageBtn?.addEventListener("click", clearSelectedImage);

googleLoginBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });
});

logoutBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  hasLoadedChats = false;
  state.chats = [createLocalChat()];
  state.activeChatId = getChatKey(state.chats[0]);
  saveState();
  renderAuthState();
  renderAll();
});

sb?.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  hasLoadedChats = false;
  renderAuthState();

  if (currentUser) {
    await loadChatsFromWorker();
  }
});

sb?.auth.getSession()
  .then(async ({ data }) => {
    currentUser = data?.session?.user || null;
    renderAuthState();

    if (currentUser) {
      await loadChatsFromWorker();
    } else if (!state.chats.length) {
      const chat = createLocalChat();
      state.chats = [chat];
      state.activeChatId = getChatKey(chat);
      saveState();
    }
  })
  .catch(() => {});

applyTheme();

if (!state.chats.length) {
  const chat = createLocalChat();
  state.chats = [chat];
  state.activeChatId = getChatKey(chat);
  saveState();
}

renderAll();
autoResize();
updateSelectedImageUI();
