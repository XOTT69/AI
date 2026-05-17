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
const sidebar = document.getElementById("sidebar");
const mobileOverlay = document.getElementById("mobileOverlay");
const hamburgerBtn = document.getElementById("hamburgerBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const currentChatTitle = document.getElementById("currentChatTitle");

const SUPABASE_URL = "https://dfvlipfcblnnuxylhzis.supabase.co";
const SUPABASE_KEY = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";
const HISTORY_API_BASE = "https://ai1.ai-beta69690.workers.dev";
const STORAGE_KEY = "ai-chat-worker-debug-v1";

const ALLOWED_MODELS = {
  auto: { system: "Ти корисний AI-помічник. Відповідай українською.", tokens: 4096, vision: true },
  "github/gpt-4o-mini": { system: "Ти корисний AI-помічник. Відповідай українською.", tokens: 4096, vision: false },
  "groq/llama-3.3-70b-versatile": { system: "Ти швидкий і точний AI-помічник. Відповідай українською.", tokens: 4096, vision: false },
  "gemini/gemini-2.5-flash": { system: "Ти мультимодальний AI-помічник Gemini. Відповідай українською.", tokens: 4096, vision: true },
  "mistral/codestral": { system: "Ти сильний AI-помічник для коду і технічних задач. Відповідай українською.", tokens: 4096, vision: false },
  "mistral/mistral-large": { system: "Ти потужний AI-помічник. Відповідай українською.", tokens: 4096, vision: false },
  "meta/llama-3.3-70b-instruct": { system: "Ти потужний AI-помічник. Відповідай українською.", tokens: 4096, vision: false },
  "google/gemma-3-27b-it": { system: "Ти мультимодальний AI-помічник. Відповідай українською.", tokens: 4096, vision: true },
  "meta/llama-3.2-90b-vision-instruct": { system: "Ти AI-помічник для аналізу зображень. Відповідай українською.", tokens: 2048, vision: true },
  "cerebras/llama-3.1-70b": { system: "Ти швидкий AI-помічник. Відповідай українською.", tokens: 4096, vision: false },
  "github/phi-4": { system: "Ти розумний AI-помічник. Відповідай українською.", tokens: 4096, vision: false }
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
  state = { activeChatId: null, chats: [], drafts: {} };
}
if (!state.drafts || typeof state.drafts !== "object") state.drafts = {};

const renderer = new marked.Renderer();
renderer.code = function (code, language) {
  const validLang = hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;
  return `<pre><code class="hljs ${validLang}">${highlighted}</code></pre>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

function formatThinking(text) {
  if (!text) return "";
  return String(text)
    .replace(/<think>/g, `<details class="thought-block"><summary>Міркування</summary><div class="thought-content">`)
    .replace(/<\/think>/g, `</div></details>`);
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(formatThinking(text || "")), {
    ADD_TAGS: ["details", "summary"]
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createLocalChat() {
  return {
    id: null,
    localId: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title: "Новий чат",
    preview: "",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function getChatKey(chatItem) {
  return chatItem?.id ? String(chatItem.id) : chatItem?.localId || null;
}

function getActiveChat() {
  return state.chats.find((c) => getChatKey(c) === state.activeChatId) || null;
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

function getActiveChatDraftKey() {
  const active = getActiveChat();
  return active ? getChatKey(active) : "global";
}

function saveDraft(value) {
  state.drafts[getActiveChatDraftKey()] = value;
  saveState();
}

function loadDraft() {
  const key = getActiveChatDraftKey();
  const value = state.drafts[key] || "";
  if (promptInput && document.activeElement !== promptInput) {
    promptInput.value = value;
    autoResize();
  }
}

function clearDraft() {
  const key = getActiveChatDraftKey();
  delete state.drafts[key];
  saveState();
  promptInput.value = "";
  autoResize();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function updateCurrentChatTitle() {
  const active = getActiveChat();
  currentChatTitle.textContent = active?.title || "Новий чат";
}

function renderAuthState() {
  if (!currentUser) {
    authLoggedOut?.classList.remove("hidden");
    authLoggedIn?.classList.add("hidden");
    return;
  }

  authLoggedOut?.classList.add("hidden");
  authLoggedIn?.classList.remove("hidden");

  const meta = currentUser.user_metadata || {};
  if (userName) userName.textContent = meta.full_name || meta.name || currentUser.email || "User";
  if (userEmail) userEmail.textContent = currentUser.email || "";
  if (userAvatar) userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/80x80/png";
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
        <div class="chat-item-subtitle">${escapeHtml(String(subtitle).slice(0, 100))}</div>
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
        const next = createLocalChat();
        state.chats = [next];
        state.activeChatId = getChatKey(next);
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachmentCard(att) {
  if (!att || att.kind !== "image" || !att.url) return "";
  return `
    <div class="attachment-card">
      <img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.file_name || "Image attachment")}" loading="lazy" decoding="async">
      <div class="attachment-meta">
        <span>${escapeHtml(att.file_name || "image")}</span>
        <span>${escapeHtml(formatBytes(att.file_size || 0))}</span>
      </div>
    </div>
  `;
}

function renderMessages() {
  chat.innerHTML = `<div class="chat-inner"></div>`;
  const inner = chat.querySelector(".chat-inner");
  const active = getActiveChat();

  if (!active || !active.messages?.length) {
    inner.innerHTML = `<div class="chat-empty">Що хочеш дізнатись?</div>`;
    queueMicrotask(scrollChatToBottom);
    return;
  }

  const fragment = document.createDocumentFragment();

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

    if (Array.isArray(msg.attachments) && msg.attachments.length) {
      const attachWrap = document.createElement("div");
      attachWrap.className = "message-attachments";
      attachWrap.innerHTML = msg.attachments.map(renderAttachmentCard).join("");
      content.appendChild(attachWrap);
    }

    wrapper.appendChild(content);
    fragment.appendChild(wrapper);
  }

  inner.appendChild(fragment);
  requestAnimationFrame(scrollChatToBottom);
}

function renderAll() {
  renderAuthState();
  renderChatList();
  renderMessages();
  updateCurrentChatTitle();

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
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 220) + "px";
}

function scrollChatToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function updateSelectedImageUI() {
  if (!selectedImage) {
    selectedImageBar?.classList.add("hidden");
    selectedImagePreview?.removeAttribute("src");
    selectedImageName.textContent = "";
    return;
  }

  selectedImageBar?.classList.remove("hidden");
  selectedImagePreview.src = selectedImage.dataUrl;
  selectedImageName.textContent = selectedImage.name || "image";
}

function clearSelectedImage() {
  selectedImage = null;
  imageInput.value = "";
  updateSelectedImageUI();
}

function setBusy(isBusy, text = "") {
  requestInFlight = isBusy;
  statusText.textContent = text || "";
  statusText.classList.toggle("hidden", !text);
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

async function safeFetchJson(url, options = {}, label = "request") {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${label}: network error / CORS / endpoint недоступний`);
  }

  const rawText = await response.text().catch(() => "");
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }

  if (!response.ok) {
    const msg =
      data?.error ||
      data?.message ||
      data?.details ||
      `${label}: HTTP ${response.status}`;
    throw new Error(msg);
  }

  return data;
}

async function historyApi(path, options = {}) {
  if (!currentUser?.id) {
    throw new Error("Спочатку увійди через Google");
  }

  return safeFetchJson(
    `${HISTORY_API_BASE}${path}`,
    {
      ...options,
      headers: {
        "X-User-Id": String(currentUser.id),
        ...(options.headers || {})
      }
    },
    `Worker ${path}`
  );
}

async function historyJson(path, method = "GET", body = null) {
  return historyApi(path, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function pingWorker() {
  return safeFetchJson(`${HISTORY_API_BASE}/api/health`, {}, "Worker health");
}

async function uploadAttachment(chatId, file) {
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("file", file);

  return safeFetchJson(
    `${HISTORY_API_BASE}/api/attachments/upload`,
    {
      method: "POST",
      headers: {
        "X-User-Id": String(currentUser.id)
      },
      body: fd
    },
    "Worker upload"
  ).then((data) => data.attachment);
}

async function loadChatsFromWorker() {
  if (!currentUser || hasLoadedChats) return;

  try {
    await pingWorker();

    const data = await historyApi("/api/chats");
    const serverChats = (data.chats || []).map((chatItem) => ({
      id: String(chatItem.id),
      localId: String(chatItem.id),
      title: chatItem.title || "Новий чат",
      preview: chatItem.preview || "",
      messages: [],
      createdAt: chatItem.created_at ? new Date(chatItem.created_at).getTime() : Date.now(),
      updatedAt: chatItem.updated_at ? new Date(chatItem.updated_at).getTime() : Date.now()
    }));

    const localUnsaved = state.chats.filter((c) => !c.id);
    state.chats = [...localUnsaved, ...serverChats];

    if (!state.chats.length) {
      const item = createLocalChat();
      state.chats = [item];
      state.activeChatId = getChatKey(item);
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
    console.error("loadChatsFromWorker:", e);
    setBusy(false, e.message || "Не вдалося завантажити чати");
  }
}

async function loadChatDetails(chatId) {
  const data = await historyApi(`/api/chats/${chatId}`);
  const fullChat = data.chat;

  let existing = state.chats.find((c) => String(c.id) === String(chatId));
  if (!existing) {
    existing = {
      id: String(chatId),
      localId: String(chatId),
      title: fullChat.title || "Новий чат",
      preview: "",
      messages: [],
      createdAt: fullChat.createdAt || Date.now(),
      updatedAt: fullChat.updatedAt || Date.now()
    };
    state.chats.unshift(existing);
  }

  existing.id = String(chatId);
  existing.localId = String(chatId);
  existing.title = fullChat.title || existing.title;
  existing.messages = Array.isArray(fullChat.messages) ? fullChat.messages : [];
  existing.preview = existing.messages.find((m) => m.role === "user")?.content || "";
  existing.createdAt = fullChat.createdAt || existing.createdAt;
  existing.updatedAt = fullChat.updatedAt || existing.updatedAt;

  state.activeChatId = String(chatId);
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

  sendChatMessage(lastUserMsg.content, true);
};

function buildMessagesForAPI(active, assistantMsgId, modelConf, imageUrl = null) {
  const rawMessages = [{ role: "system", content: modelConf.system }];
  const recent = active.messages
    .slice(-12)
    .filter((m) => String(m.id) !== String(assistantMsgId) && !m.isError);

  for (const m of recent) {
    if (m.role === "user") {
      if (imageUrl && modelConf.vision && m === recent[recent.length - 1]) {
        rawMessages.push({
          role: "user",
          content: [
            { type: "text", text: (m.content || "").trim() },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        });
      } else {
        rawMessages.push({
          role: "user",
          content: (m.content || "").trim()
        });
      }
    } else if (m.role === "assistant") {
      rawMessages.push({
        role: "assistant",
        content: typeof m.content === "string" ? m.content : ""
      });
    }
  }

  return rawMessages;
}

async function ensureServerChatForActive(firstMessageText = "Новий чат") {
  let active = ensureLocalChatStub();
  if (active.id) return active;

  const created = await historyJson("/api/chats", "POST", {
    title: (firstMessageText || "Новий чат").slice(0, 48),
    model: modelSelect?.value || "auto"
  });

  active.id = String(created.chat.id);
  active.localId = String(created.chat.id);
  active.title = created.chat.title || active.title;
  state.activeChatId = String(created.chat.id);
  saveState();

  return active;
}

async function saveMessageOnServer(chatId, role, content, model = "", attachments = []) {
  return historyJson(`/api/chats/${chatId}/messages`, "POST", {
    role,
    content,
    model,
    attachments
  });
}

async function sendChatMessage(text, isRetry = false) {
  if (requestInFlight) return;

  text = (text || "").trim();
  if (!text) return;

  if (!currentUser) {
    alert("Спочатку увійди через Google, щоб зберігати історію.");
    return;
  }

  let active = ensureLocalChatStub();
  const modelId = modelSelect?.value || "auto";
  const modelConf = ALLOWED_MODELS[modelId] || ALLOWED_MODELS.auto;

  setBusy(true, "Перевіряю backend...");

  try {
    await pingWorker();
    active = await ensureServerChatForActive(text);

    let uploadedAttachment = null;
    if (selectedImage?.file) {
      setBusy(true, "Завантажую фото...");
      uploadedAttachment = await uploadAttachment(active.id, selectedImage.file);
    }

    let userMessage = null;
    if (!isRetry) {
      userMessage = {
        id: `tmp_user_${Date.now()}`,
        role: "user",
        content: text,
        createdAt: Date.now(),
        attachments: uploadedAttachment
          ? [{
              kind: "image",
              url: uploadedAttachment.url,
              file_name: uploadedAttachment.file_name,
              file_size: uploadedAttachment.file_size
            }]
          : []
      };

      active.messages.push(userMessage);

      if (!active.title || active.title === "Новий чат") {
        active.title = text.slice(0, 48);
      }

      active.preview = text;
      active.updatedAt = Date.now();
      saveState();
      renderAll();
      clearDraft();
      clearSelectedImage();

      const savedUser = await saveMessageOnServer(
        active.id,
        "user",
        text,
        modelId,
        uploadedAttachment ? [uploadedAttachment.id] : []
      );

      userMessage.id = String(savedUser.message.id || userMessage.id);
    }

    const assistantMessage = {
      id: `tmp_assistant_${Date.now()}`,
      role: "assistant",
      content: ""
    };

    active.messages.push(assistantMessage);
    saveState();
    renderAll();

    const messages = buildMessagesForAPI(active, assistantMessage.id, modelConf, uploadedAttachment?.url || null);
    currentController = new AbortController();

    setBusy(true, "Викликаю Vercel proxy...");

    const data = await safeFetchJson(
      "/api/proxy",
      {
        method: "POST",
        signal: currentController.signal,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: modelConf.tokens
        })
      },
      "Vercel /api/proxy"
    );

    assistantMessage.content = data?.text || "Порожня відповідь";
    saveState();
    renderAll();

    const savedAssistant = await saveMessageOnServer(active.id, "assistant", assistantMessage.content, modelId, []);
    assistantMessage.id = String(savedAssistant.message.id || assistantMessage.id);

    active.updatedAt = Date.now();
    state.chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    saveState();
    renderAll();
  } catch (e) {
    console.error("sendChatMessage:", e);
    const activeChat = getActiveChat();
    if (activeChat) {
      const last = activeChat.messages[activeChat.messages.length - 1];
      if (last?.role === "assistant" && !last.content) {
        activeChat.messages.pop();
      }

      activeChat.messages.push({
        id: `err_${Date.now()}`,
        role: "assistant",
        content: e.message || "Помилка",
        isError: true
      });

      saveState();
      renderAll();
    }
    setBusy(false, e.message || "Помилка запиту");
  } finally {
    currentController = null;
    setBusy(false, "");
  }
}

async function initAuth() {
  if (!sb) return;

  const { data: { session } = {} } = await sb.auth.getSession();
  currentUser = session?.user || null;
  renderAll();

  if (currentUser) {
    await loadChatsFromWorker();
  }

  sb.auth.onAuthStateChange(async (_event, sessionData) => {
    currentUser = sessionData?.user || null;
    hasLoadedChats = false;
    renderAll();

    if (currentUser) {
      await loadChatsFromWorker();
    }
  });
}

googleLoginBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin }
  });
});

logoutBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  hasLoadedChats = false;
  renderAll();
});

promptInput?.addEventListener("input", () => {
  autoResize();
  saveDraft(promptInput.value);
});

promptInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  await sendChatMessage(text);
});

newChatBtn?.addEventListener("click", () => {
  const fresh = createLocalChat();
  state.chats.unshift(fresh);
  state.activeChatId = getChatKey(fresh);
  saveState();
  renderAll();
  closeSidebar();
  promptInput.focus();
});

clearBtn?.addEventListener("click", () => {
  const active = getActiveChat();
  if (!active) return;
  if (!confirm("Очистити повідомлення цього чату локально?")) return;
  active.messages = [];
  active.preview = "";
  active.title = active.id ? active.title : "Новий чат";
  saveState();
  renderAll();
});

stopBtn?.addEventListener("click", () => {
  if (currentController) currentController.abort();
});

imageBtn?.addEventListener("click", () => imageInput.click());

imageInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Потрібен файл зображення.");
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    alert("Фото занадто велике. До 8 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    selectedImage = {
      file,
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result
    };
    updateSelectedImageUI();
  };
  reader.readAsDataURL(file);
});

removeImageBtn?.addEventListener("click", clearSelectedImage);
hamburgerBtn?.addEventListener("click", openSidebar);
closeSidebarBtn?.addEventListener("click", closeSidebar);
mobileOverlay?.addEventListener("click", closeSidebar);

window.addEventListener("resize", () => {
  autoResize();
  if (window.innerWidth > 1024) closeSidebar();
});

window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    autoResize();
    scrollChatToBottom();
  }, 120);
});

(function boot() {
  if (!state.chats.length) {
    const initial = createLocalChat();
    state.chats = [initial];
    state.activeChatId = getChatKey(initial);
    saveState();
  }

  renderAll();
  autoResize();
  initAuth();
})();
