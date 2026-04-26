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
const selectedImageHint = document.getElementById("selectedImageHint");
const selectedImagePreview = document.getElementById("selectedImagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const statusText = document.getElementById("statusText");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const syncBtn = document.getElementById("syncBtn");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const sidebar = document.getElementById("sidebar");
const mobileOverlay = document.getElementById("mobileOverlay");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportMdBtn = document.getElementById("exportMdBtn");
let supaUrl = "https://dfvlipfcblnnuxylhzis.supabase.co"; 
let supaKey = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";

// Vercel автоматично підставляє значення NEXT_PUBLIC_ змінних, якщо проєкт збирається через Next.js/Vite.
// Якщо це звичайний статичний HTML деплой на Vercel, то змінні не інжектуються у .js файли напряму.
// Тому ми залишаємо fallback на об'єкт window (якщо ти колись повернешся до конфігу).
// Але оскільки ти все додав у Vercel, ми спробуємо зчитати їх:
let supaUrl = "";
let supaKey = "";

// Якщо ти використовуєш Next.js або Vite (збірка Vercel), вони будуть доступні тут:
if (typeof process !== "undefined" && process.env) {
  supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  supaKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
}

// Fallback, якщо Vercel не зміг інжектувати змінні в статичний файл (що часто буває у Vanilla JS)
if (!supaUrl || !supaKey) {
  console.warn("⚠️ Ключі Supabase не знайдені в ENV. Supabase не підключено.");
}

let sb = null;

if (supaUrl && supaUrl.startsWith("http") && supaKey && window.supabase) {
  sb = window.supabase.createClient(supaUrl, supaKey);
} else {
  sb = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => { alert("Supabase не налаштовано"); return { error: new Error("Missing config") }; },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => {}
    },
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ data: { id: "mock" }, error: null }),
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }), single: async () => ({ data: { id: "mock" }, error: null }), in: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) })
    })
  };
}

const STORAGE_KEY = "ai-chat-sync-v17";
let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
if (!state || !Array.isArray(state.chats)) {
  state = { activeChatId: null, chats: [], mode: "fast" };
}

marked.setOptions({ breaks: true, gfm: true });

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function updateStatus(text) { if (statusText) statusText.textContent = text; }

function closeAllChatMenus() {
  document.querySelectorAll(".chat-menu.show").forEach(el => el.classList.remove("show"));
}

function closeMobileSidebar() {
  if (!sidebar || !mobileOverlay) return;
  if (window.innerWidth > 960) return;
  sidebar.classList.remove("open");
  mobileOverlay.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

function getActiveChat() { return state.chats.find(c => c.id === state.activeChatId) || null; }

function ensureChat() {
  let active = getActiveChat();
  if (!active) {
    active = { id: uid(), serverId: null, title: "Новий чат", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.chats.unshift(active);
    state.activeChatId = active.id;
    saveState();
    renderAll();
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
  if (userEmail) userEmail.textContent = currentUser.email || "Без email";
  if (userAvatar) userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/80x80/png";
}

function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";
  for (const item of state.chats) {
    const div = document.createElement("div");
    div.className = `chat-item ${item.id === state.activeChatId ? "active" : ""}`;
    const title = document.createElement("div");
    title.className = "chat-item-title";
    title.textContent = item.title || "Новий чат";
    const meta = document.createElement("div");
    meta.className = "chat-item-meta";
    meta.textContent = `${item.messages.length} повідомлень`;
    const menuWrap = document.createElement("div");
    menuWrap.className = "chat-menu-wrap";
    const menuBtn = document.createElement("button");
    menuBtn.className = "chat-menu-btn";
    menuBtn.textContent = "⋯";
    const menu = document.createElement("div");
    menu.className = "chat-menu";
    
    const openBtn = document.createElement("button");
    openBtn.textContent = "Відкрити";
    openBtn.onclick = (e) => { e.stopPropagation(); state.activeChatId = item.id; saveState(); renderAll(); closeAllChatMenus(); closeMobileSidebar(); };
    
    const delBtn = document.createElement("button");
    delBtn.textContent = "Видалити";
    delBtn.className = "danger";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if(confirm("Видалити чат?")) {
        state.chats = state.chats.filter(c => c.id !== item.id);
        if(state.activeChatId === item.id) state.activeChatId = state.chats[0]?.id || null;
        saveState(); renderAll();
      }
    };

    menuBtn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".chat-menu.show").forEach(el => { if(el !== menu) el.classList.remove("show"); });
      menu.classList.toggle("show");
    };

    menu.append(openBtn, delBtn);
    menuWrap.append(menuBtn, menu);
    div.append(title, meta, menuWrap);
    div.onclick = () => { if(!requestInFlight) { state.activeChatId = item.id; saveState(); renderAll(); closeMobileSidebar(); }};
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
    empty.textContent = "Напиши повідомлення, і ШІ відповість.";
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
  if (stopBtn) stopBtn.disabled = !requestInFlight;
}

function autoResize() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 240) + "px";
}

function updateSelectedImageUI() {
  if (!selectedImageBar || !selectedImageName || !selectedImagePreview) return;
  if (!selectedImage) {
    selectedImageBar.classList.add("hidden");
    selectedImagePreview.removeAttribute("src");
    return;
  }
  selectedImageBar.classList.remove("hidden");
  selectedImageName.textContent = selectedImage.name || "Зображення";
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
  if (sendBtn) sendBtn.disabled = isBusy;
  if (stopBtn) stopBtn.disabled = !isBusy;
  updateStatus(status);
}

async function sendChatMessage(text) {
  if (requestInFlight) return;
  const active = ensureChat();
  
  active.messages.push({ id: uid(), role: "user", content: text, image: selectedImage, createdAt: Date.now() });
  
  if (active.messages.length === 1) active.title = text.slice(0, 40);
  
  promptInput.value = "";
  autoResize();
  
  const assistantMsg = { id: uid(), role: "assistant", content: "", createdAt: Date.now() };
  active.messages.push(assistantMsg);
  renderAll();
  
  setBusy(true, "Генерація...");
  clearSelectedImage();

  const controller = new AbortController();
  currentController = controller;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelSelect?.value || "meta/llama-3.3-70b-instruct",
        thinking: !!thinkingCheckbox?.checked,
        responseMode: state.mode,
        stream: true,
        messages: active.messages.slice(-10).filter(m => m.id !== assistantMsg.id),
        image: selectedImage?.dataUrl ? { dataUrl: selectedImage.dataUrl } : null
      })
    });

    if (!response.ok) throw new Error(`Помилка сервера: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const msgEls = chat.querySelectorAll('.message.assistant .message-content');
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
          if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === "content" && parsed.content) {
                assistantMsg.content += parsed.content;
                if (targetEl) {
                  targetEl.innerHTML = renderMarkdown(assistantMsg.content);
                  chat.scrollTop = chat.scrollHeight;
                }
              }
            } catch (e) {}
          }
        }
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      assistantMsg.content += "\n\n*[Генерацію зупинено]*";
    } else {
      assistantMsg.content = `Помилка: ${e.message}. NVIDIA сервери можуть бути перевантажені.`;
    }
    const msgEls = chat.querySelectorAll('.message.assistant .message-content');
    if(msgEls.length > 0) msgEls[msgEls.length - 1].innerHTML = renderMarkdown(assistantMsg.content);
  } finally {
    currentController = null;
    active.updatedAt = Date.now();
    saveState();
    renderAll();
    setBusy(false, "Готово");
  }
}

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = promptInput?.value.trim();
  if (text) sendChatMessage(text);
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
  active.messages = []; 
  active.title = "Новий чат";
  saveState(); 
  renderAll(); 
});

newChatBtn?.addEventListener("click", () => createLocalChat("Новий чат"));

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

document.addEventListener("click", (e) => {
  if (!e.target.closest(".chat-menu-wrap")) closeAllChatMenus();
});

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();
});

renderAll();
autoResize();
updateSelectedImageUI();
updateStatus("Готово");

sb.auth.getSession().then(({data}) => {
  currentUser = data?.session?.user || null;
  renderAuthState();
}).catch(()=>{});

googleLoginBtn?.addEventListener("click", async () => {
  await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" }});
});
logoutBtn?.addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUser = null;
  renderAuthState();
});
