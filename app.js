const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const modelSelect = document.getElementById("model");
const thinkingCheckbox = document.getElementById("thinking");
const clearBtn = document.getElementById("clearBtn");
const stopBtn = document.getElementById("stopBtn");
const newChatBtn = document.getElementById("newChatBtn");
const chatList = document.getElementById("chatList");
const chatTitle = document.getElementById("chatTitle");
const sendBtn = document.getElementById("sendBtn");
const fastModeBtn = document.getElementById("fastModeBtn");
const smartModeBtn = document.getElementById("smartModeBtn");
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
const closeSidebarBtn = document.getElementById("closeSidebarBtn");

let supaUrl = "https://dfvlipfcblnnuxylhzis.supabase.co";
let supaKey = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";

const ALLOWED_MODELS = {
  "meta/llama-3.3-70b-instruct": {
    system: "Ти швидкий і точний AI-помічник. Відповідай українською мовою.",
    fastTokens: 1500, smartTokens: 3000
  },
  "qwen/qwen3.5-122b-a10b": {
    system: "Ти сильний AI-помічник для складних запитів. Відповідай українською мовою.",
    fastTokens: 1800, smartTokens: 3500
  },
  "google/gemma-3-27b-it": {
    system: "Ти мультимодальний AI-помічник. Аналізуй зображення і текст на них. Відповідай українською мовою.",
    fastTokens: 1500, smartTokens: 3000
  },
  "abacusai/dracarys-llama-3.1-70b-instruct": {
    system: "Ти AI-помічник для програмування. Відповідай українською мовою.",
    fastTokens: 2000, smartTokens: 4000
  }
};

let sb = null;
if (supaUrl && supaKey && window.supabase) {
  sb = window.supabase.createClient(supaUrl, supaKey);
} else {
  sb = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ error: new Error("Supabase not configured") }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => {}
    }
  };
}

const STORAGE_KEY = "ai-chat-sync-v27";
let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
if (!state || !Array.isArray(state.chats)) {
  state = { activeChatId: null, chats: [], mode: "fast", theme: "dark" };
}
if (!state.theme) state.theme = "dark"; // Захист для старих збережень

marked.setOptions({ breaks: true, gfm: true });

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function updateStatus(text) { if (statusText) statusText.textContent = text; }
function getActiveChat() { return state.chats.find(c => c.id === state.activeChatId) || null; }

// --- ТЕМА ---
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = state.theme === "light" ? "🌙" : "☀️";
  }
}

themeToggleBtn?.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  saveState();
  applyTheme();
});

// --- МЕНЮ ---
function openSidebar() {
  sidebar.classList.add("open");
  mobileOverlay.classList.add("show");
  if (window.innerWidth <= 768) {
    closeSidebarBtn.style.display = "block";
  }
}

function closeSidebar() {
  sidebar.classList.remove("open");
  mobileOverlay.classList.remove("show");
}

hamburgerBtn?.addEventListener("click", openSidebar);
closeSidebarBtn?.addEventListener("click", closeSidebar);
mobileOverlay?.addEventListener("click", closeSidebar);

// --- ЧАТ ---
function ensureChat() {
  let active = getActiveChat();
  if (!active) {
    active = { id: uid(), title: "Новий чат", messages: [], createdAt: Date.now() };
    state.chats.unshift(active);
    state.activeChatId = active.id;
    saveState();
  }
  return active;
}

function renderMarkdown(text) { return DOMPurify.sanitize(marked.parse(text || "")); }

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
    div.className = `chat-item ${item.id === state.activeChatId ? "active" : ""}`;
    
    const infoDiv = document.createElement("div");
    infoDiv.className = "chat-item-info";
    
    const title = document.createElement("div");
    title.className = "chat-item-title";
    title.textContent = item.title || "Новий чат";
    
    const meta = document.createElement("div");
    meta.className = "chat-item-meta";
    meta.textContent = `${item.messages.length} повідомлень`;
    
    infoDiv.append(title, meta);
    
    const delBtn = document.createElement("button");
    delBtn.className = "chat-item-delete";
    delBtn.innerHTML = "✕";
    delBtn.title = "Видалити чат";
    
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm("Ви дійсно хочете видалити цей чат?")) {
        state.chats = state.chats.filter(c => c.id !== item.id);
        if (state.activeChatId === item.id) {
          state.activeChatId = state.chats.length > 0 ? state.chats[0].id : null;
        }
        saveState();
        renderAll();
      }
    };
    
    div.append(infoDiv, delBtn);
    
    div.onclick = () => {
      if (requestInFlight) return;
      state.activeChatId = item.id;
      saveState();
      renderAll();
      if (window.innerWidth <= 768) closeSidebar();
    };
    
    chatList.appendChild(div);
  }
}

function renderMessages() {
  const active = ensureChat();
  if (!chat) return;
  chat.innerHTML = "";
  if (chatTitle) chatTitle.textContent = active.title || "Новий чат";

  if (!active.messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Напишіть повідомлення для початку.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    const wrap = document.createElement("div");
    wrap.className = `message ${msg.role}`;
    const inner = document.createElement("div");
    inner.className = "message-content";

    if (msg.role === "assistant") {
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

    wrap.appendChild(inner);
    chat.appendChild(wrap);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuthState();
  renderChatList();
  renderMessages();
  fastModeBtn?.classList.toggle("active", state.mode === "fast");
  smartModeBtn?.classList.toggle("active", state.mode === "smart");
  
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
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
}

function updateSelectedImageUI() {
  if (!selectedImageBar || !selectedImagePreview) return;
  if (!selectedImage) {
    selectedImageBar.classList.add("hidden");
    selectedImagePreview.removeAttribute("src");
    return;
  }
  selectedImageBar.classList.remove("hidden");
  if(selectedImageName) selectedImageName.textContent = selectedImage.name || "Зображення";
  selectedImagePreview.src = selectedImage.dataUrl;
}

function clearSelectedImage() {
  selectedImage = null;
  if (imageInput) imageInput.value = "";
  updateSelectedImageUI();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

function setBusy(isBusy, status = "Готово") {
  requestInFlight = isBusy;
  updateStatus(status);
  renderAll(); 
}

async function sendChatMessage(text) {
  if (requestInFlight) return;

  const active = ensureChat();
  active.messages.push({ id: uid(), role: "user", content: text, image: selectedImage, createdAt: Date.now() });

  if (active.messages.length === 1) {
    active.title = text.slice(0, 30) || "Новий чат";
  }

  promptInput.value = "";
  autoResize();

  const assistantMsg = { id: uid(), role: "assistant", content: "", createdAt: Date.now() };
  active.messages.push(assistantMsg);
  renderAll();

  setBusy(true, "Генерація...");

  const modelId = ALLOWED_MODELS[modelSelect?.value] ? modelSelect.value : "meta/llama-3.3-70b-instruct";
  const modelConf = ALLOWED_MODELS[modelId];
  let safeMessages = [{ role: "system", content: modelConf.system }];
  const recent = active.messages.slice(-10).filter(m => m.id !== assistantMsg.id);

  if (selectedImage?.dataUrl && modelId.includes("gemma-3")) {
    safeMessages.push({
      role: "user",
      content: [
        { type: "text", text: text || "Що на фото?" },
        { type: "image_url", image_url: { url: selectedImage.dataUrl } }
      ]
    });
  } else {
    recent.forEach(m => { safeMessages.push({ role: m.role, content: m.content }); });
  }

  clearSelectedImage();

  const controller = new AbortController();
  currentController = controller;

  try {
    const response = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: safeMessages,
        temperature: state.mode === "smart" ? 0.4 : 0.2,
        max_tokens: state.mode === "smart" ? modelConf.smartTokens : modelConf.fastTokens,
        top_p: 0.9,
        stream: true
      })
    });

    if (!response.ok) throw new Error(`Помилка: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const msgEls = chat.querySelectorAll(".message.assistant .message-content");
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
          if (dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed?.choices?.[0]?.delta?.content || "";
            if (delta) {
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
  } catch (e) {
    if (e?.name === "AbortError") {
      assistantMsg.content += "\n\n*[Зупинено]*";
    } else {
      assistantMsg.content += `\n\nПомилка: ${e.message}`;
    }
    const msgEls = chat.querySelectorAll(".message.assistant .message-content");
    if (msgEls.length > 0) msgEls[msgEls.length - 1].innerHTML = renderMarkdown(assistantMsg.content);
  } finally {
    currentController = null;
    saveState();
    setBusy(false, "Готово");
  }
}

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = promptInput?.value.trim();
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
  const active = ensureChat();
  if (confirm("Очистити історію поточного чату?")) {
    active.messages = [];
    active.title = "Новий чат";
    saveState();
    renderAll();
  }
});

newChatBtn?.addEventListener("click", () => {
  state.activeChatId = null;
  ensureChat();
  renderAll();
  if (window.innerWidth <= 768) closeSidebar();
});

fastModeBtn?.addEventListener("click", () => { state.mode = "fast"; saveState(); renderAll(); });
smartModeBtn?.addEventListener("click", () => { state.mode = "smart"; saveState(); renderAll(); });

imageBtn?.addEventListener("click", () => imageInput?.click());
imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    selectedImage = { name: file.name, type: file.type, dataUrl };
    updateSelectedImageUI();
  } catch (e) { alert("Помилка фото"); }
});
removeImageBtn?.addEventListener("click", clearSelectedImage);

sb.auth.onAuthStateChange?.((_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();
});

sb.auth.getSession?.().then(({ data }) => {
  currentUser = data?.session?.user || null;
  renderAuthState();
}).catch(() => {});

googleLoginBtn?.addEventListener("click", async () => {
  if (!sb?.auth?.signInWithOAuth) { alert("Supabase не підключено"); return; }
  await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });
});

logoutBtn?.addEventListener("click", async () => {
  if (!sb?.auth?.signOut) return;
  await sb.auth.signOut();
  currentUser = null;
  renderAuthState();
});

applyTheme();
renderAll();
autoResize();
updateSelectedImageUI();
