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

const STORAGE_KEY = "ai-chat-worker-v1";

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
    theme: "dark"
  };
}
if (!state.theme) state.theme = "dark";

const renderer = new marked.Renderer();
renderer.code = function (code, language) {
  const validLang = hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;
  return `
    <div class="code-block">
      <div class="code-header">
        <span>${validLang}</span>
        <div style="display:flex;gap:12px;">
          <button class="copy-btn" onclick="copyCodeBtn(this)">Copy</button>
        </div>
      </div>
      <pre><code class="hljs ${validLang}">${highlighted}</code></pre>
    </div>
  `;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true
});

window.copyCodeBtn = function (btn) {
  const pre = btn.parentElement.parentElement.nextElementSibling;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.innerHTML = "Copied";
    setTimeout(() => {
      btn.innerHTML = "Copy";
    }, 2000);
  });
};

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
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveChat() {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}

function ensureLocalChatStub() {
  let active = getActiveChat();
  if (!active) {
    active = {
      id: null,
      localId: uid(),
      title: "Новий чат",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.chats.unshift(active);
    state.activeChatId = active.localId;
    saveState();
  }
  return active;
}

function getChatKey(chatItem) {
  return chatItem.id || chatItem.localId;
}

function setActiveChatByAnyId(id) {
  const found = state.chats.find((c) => c.id === id || c.localId === id);
  if (found) state.activeChatId = getChatKey(found);
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
  if (userName) userName.textContent = meta.full_name || meta.name || currentUser.email || "User";
  if (userEmail) userEmail.textContent = currentUser.email || "";
  if (userAvatar) userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/40x40/png";
}

function renderChatList() {
  if (!chatList) return;
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
        <div class="chat-item-title">${item.title || "Новий чат"}</div>
        <div class="chat-item-subtitle">${String(subtitle).slice(0, 90)}</div>
      </div>
      <button class="chat-item-delete" title="Видалити">✕</button>
    `;

    div.querySelector(".chat-item-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Видалити цей чат?")) return;

      if (item.id && currentUser) {
        await historyApi(`/api/chats/${item.id}`, {
          method: "DELETE"
        }).catch(console.error);
      }

      state.chats = state.chats.filter((c) => getChatKey(c) !== getChatKey(item));
      state.activeChatId = getChatKey(state.chats[0] || {}) || null;
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

      sidebar?.classList.remove("open");
      mobileOverlay?.classList.remove("show");
      document.body.classList.remove("no-scroll");
    };

    chatList.appendChild(div);
  }
}

function renderMessages() {
  const active = getActiveChat();
  if (!chat) return;

  chat.innerHTML = "";
  if (!active || !active.messages?.length) {
    chat.innerHTML = `<div class="chat-empty">Що хочеш дізнатись?</div>`;
    return;
  }

  for (const msg of active.messages) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.role}`;

    const inner = document.createElement("div");
    inner.className = "message-content";

    if (msg.isError) {
      inner.innerHTML = `
        <div class="error-card">
          <strong>Помилка</strong><br>
          ${msg.content}
          <div class="error-actions">
            <button class="secondary-btn" onclick="retryMessage()">Спробувати ще раз</button>
          </div>
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
  if (selectedImageName) selectedImageName.textContent = selectedImage.name;
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
    statusText.textContent = text || (isBusy ? "Думаю..." : "");
    statusText.classList.toggle("hidden", !text && !isBusy);
  }
  renderAll();
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
    state.chats = (data.chats || []).map((chatItem) => ({
      id: chatItem.id,
      localId: chatItem.id,
      title: chatItem.title || "Новий чат",
      preview: chatItem.preview || "",
      messages: [],
      createdAt: chatItem.created_at ? new Date(chatItem.created_at).getTime() : Date.now(),
      updatedAt: chatItem.updated_at ? new Date(chatItem.updated_at).getTime() : Date.now()
    }));

    if (!state.activeChatId || !state.chats.find((c) => getChatKey(c) === state.activeChatId)) {
      state.activeChatId = getChatKey(state.chats[0] || {}) || null;
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

  const existing = state.chats.find((c) => c.id === chatId);
  if (!existing) return;

  existing.title = fullChat.title || existing.title;
  existing.messages = Array.isArray(fullChat.messages) ? fullChat.messages : [];
  existing.createdAt = fullChat.createdAt || existing.createdAt;
  existing.updatedAt = fullChat.updatedAt || existing.updatedAt;

  state.activeChatId = getChatKey(existing);
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

      if (m.image?.dataUrl && modelConf.vision) {
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

async function sendChatMessage(text, isRetry = false) {
  if (requestInFlight) return;

  text = (text || "").trim();
  if (!text && !selectedImage) return;

  if (!currentUser) {
    alert("Спочатку увійди через Google, щоб зберігати історію.");
    return;
  }

  let active = getActiveChat() || ensureLocalChatStub();
  const modelId = modelSelect?.value || "groq/llama-3.3-70b-versatile";
  const modelConf = ALLOWED_MODELS[modelId] || ALLOWED_MODELS["groq/llama-3.3-70b-versatile"];

  if (!isRetry) {
    if (selectedImage && !modelConf.vision) {
      active.messages.push({
        id: uid(),
        role: "assistant",
        isError: true,
        content: "Ця модель не підтримує зображення. Обери Gemini Flash, Gemma 3 або Llama 3.2 Vision.",
        createdAt: Date.now()
      });
      saveState();
      renderAll();
      return;
    }

    const localUserMessage = {
      id: uid(),
      role: "user",
      content: text,
      image: selectedImage,
      createdAt: Date.now()
    };

    active.messages.push(localUserMessage);

    if (!active.title || active.title === "Новий чат") {
      active.title = text ? text.slice(0, 40) : "Новий чат";
    }

    active.updatedAt = Date.now();
    saveState();
    renderAll();

    const saved = await historyApi("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        chatId: active.id || null,
        content: text,
        imageDataUrl: selectedImage?.dataUrl || null
      })
    });

    if (!active.id) {
      active.id = saved.chat.id;
      active.localId = saved.chat.id;
      active.title = saved.chat.title || active.title;
      state.activeChatId = active.id;
    }

    localUserMessage.id = saved.message.id;
    active.updatedAt = saved.message.createdAt || Date.now();

    if (promptInput) {
      promptInput.value = "";
      autoResize();
    }

    saveState();
  }

  active = getActiveChat();
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
  setBusy(true, "Думаю...");

  const safeMessages = buildMessagesForAPI(active, assistantMsg.id, modelConf);
  const controller = new AbortController();
  currentController = controller;

  try {
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
        if (parsed?.details) message = parsed.details;
        else if (parsed?.error?.message) message = parsed.error.message;
        else if (parsed?.error) message = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
        else if (raw) message = raw;
      } catch {
        if (raw) message = raw;
      }

      throw new Error(message);
    }

    if (!response.body) throw new Error("Порожня відповідь сервера");

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
      buffer = parts.pop();

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

              if (targetEl) {
                targetEl.innerHTML = renderMarkdown(assistantMsg.content);
                chat.scrollTop = chat.scrollHeight;
              }
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
        content: assistantMsg.content
      })
    });

    if (savedAssistant?.messageId) {
      assistantMsg.id = savedAssistant.messageId;
    }

    active.updatedAt = Date.now();
    saveState();
    clearSelectedImage();
  } catch (e) {
    if (e?.name === "AbortError") {
      active.updatedAt = Date.now();
      saveState();
      renderAll();
    } else {
      active.messages.pop();
      const errorMsg = {
        id: uid(),
        role: "assistant",
        isError: true,
        content: e.message || "Невідома помилка",
        createdAt: Date.now()
      };
      active.messages.push(errorMsg);
      active.updatedAt = Date.now();
      saveState();
      renderAll();

      if (active.id) {
        await historyApi("/api/messages/assistant", {
          method: "POST",
          body: JSON.stringify({
            chatId: active.id,
            messageId: errorMsg.id,
            content: errorMsg.content
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

stopBtn?.addEventListener("click", () => {
  currentController?.abort();
});

clearBtn?.addEventListener("click", async () => {
  const active = getActiveChat();
  if (!active) return;
  if (!confirm("Очистити поточний чат?")) return;

  active.messages = [];
  active.title = "Новий чат";
  active.updatedAt = Date.now();
  saveState();
  renderAll();
});

newChatBtn?.addEventListener("click", () => {
  const newLocalChat = {
    id: null,
    localId: uid(),
    title: "Новий чат",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.chats.unshift(newLocalChat);
  state.activeChatId = newLocalChat.localId;
  saveState();
  renderAll();

  sidebar?.classList.remove("open");
  mobileOverlay?.classList.remove("show");
  document.body.classList.remove("no-scroll");
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

removeImageBtn?.addEventListener("click", () => {
  clearSelectedImage();
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
    }
  })
  .catch(() => {});

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
  renderAuthState();
});

applyTheme();
renderAll();
autoResize();
updateSelectedImageUI();
