const $ = (id) => document.getElementById(id);

const chat = $("chat");
const form = $("chatForm");
const promptInput = $("prompt");
const modelSelect = $("model");
const thinkingCheckbox = $("thinking");
const clearBtn = $("clearBtn");
const stopBtn = $("stopBtn");
const newChatBtn = $("newChatBtn");
const chatList = $("chatList");
const chatTitle = $("chatTitle");
const sendBtn = $("sendBtn");
const fastModeBtn = $("fastModeBtn");
const smartModeBtn = $("smartModeBtn");
const imageBtn = $("imageBtn");
const imageInput = $("imageInput");
const generateImageBtn = $("generateImageBtn");
const selectedImageBar = $("selectedImageBar");
const selectedImageName = $("selectedImageName");
const selectedImageHint = $("selectedImageHint");
const selectedImagePreview = $("selectedImagePreview");
const removeImageBtn = $("removeImageBtn");
const exportJsonBtn = $("exportJsonBtn");
const exportMdBtn = $("exportMdBtn");
const statusText = $("statusText");
const googleLoginBtn = $("googleLoginBtn");
const logoutBtn = $("logoutBtn");
const syncBtn = $("syncBtn");
const authLoggedOut = $("authLoggedOut");
const authLoggedIn = $("authLoggedIn");
const userAvatar = $("userAvatar");
const userName = $("userName");
const userEmail = $("userEmail");

const STORAGE_KEY = "ai-chat-debug-v1";
const SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase = null;
let currentUser = null;
let requestInFlight = false;
let currentController = null;
let selectedImage = null;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
if (!state || !Array.isArray(state.chats)) {
  state = {
    activeChatId: null,
    chats: [],
    mode: "fast"
  };
}

marked.setOptions({
  breaks: true,
  gfm: true
});

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function updateStatus(text) {
  statusText.textContent = text;
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

function createChat() {
  const chatObj = {
    id: uid(),
    title: "Новий чат",
    messages: [],
    updatedAt: Date.now()
  };
  state.chats.unshift(chatObj);
  state.activeChatId = chatObj.id;
  saveState();
  renderAll();
  return chatObj;
}

function ensureChat() {
  return getActiveChat() || createChat();
}

function renderChatList() {
  chatList.innerHTML = "";
  for (const c of state.chats) {
    const item = document.createElement("div");
    item.className = `chat-item ${c.id === state.activeChatId ? "active" : ""}`;

    const title = document.createElement("div");
    title.className = "chat-item-title";
    title.textContent = c.title || "Новий чат";

    const meta = document.createElement("div");
    meta.className = "chat-item-meta";
    meta.textContent = `${c.messages.length} повідомлень`;

    item.append(title, meta);
    item.addEventListener("click", () => {
      state.activeChatId = c.id;
      saveState();
      renderAll();
    });

    chatList.appendChild(item);
  }
}

function renderMarkdown(text) {
  try {
    return DOMPurify.sanitize(marked.parse(text || ""));
  } catch {
    return String(text || "");
  }
}

function renderMessages() {
  const active = ensureChat();
  chat.innerHTML = "";
  chatTitle.textContent = active.title || "Новий чат";

  if (!active.messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Інтерфейс працює. Можна тестити кнопки, submit і Google login.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    const el = document.createElement("div");
    el.className = `message ${msg.role}`;
    const inner = document.createElement("div");
    inner.className = "message-content";

    if (msg.role === "assistant") {
      inner.innerHTML = renderMarkdown(msg.content);
    } else {
      inner.textContent = msg.content;
    }

    if (msg.image?.dataUrl) {
      const img = document.createElement("img");
      img.src = msg.image.dataUrl;
      img.className = "inline-preview-image";
      inner.appendChild(img);
    }

    el.appendChild(inner);
    chat.appendChild(el);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAuthState() {
  if (!currentUser) {
    authLoggedOut.classList.remove("hidden");
    authLoggedIn.classList.add("hidden");
    return;
  }

  authLoggedOut.classList.add("hidden");
  authLoggedIn.classList.remove("hidden");

  const meta = currentUser.user_metadata || {};
  userName.textContent = meta.full_name || meta.name || "Користувач";
  userEmail.textContent = currentUser.email || "Без email";
  userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/80x80/png";
}

function renderAll() {
  renderChatList();
  renderMessages();
  fastModeBtn.classList.toggle("active", state.mode === "fast");
  smartModeBtn.classList.toggle("active", state.mode === "smart");
}

function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 240) + "px";
}

function updateSelectedImageUI() {
  if (!selectedImage) {
    selectedImageBar.classList.add("hidden");
    selectedImagePreview.removeAttribute("src");
    selectedImageName.textContent = "Фото не вибрано";
    selectedImageHint.textContent = "Фото буде відправлено разом із наступним повідомленням.";
    return;
  }

  selectedImageBar.classList.remove("hidden");
  selectedImageName.textContent = selectedImage.name;
  selectedImageHint.textContent = "Фото вибрано.";
  selectedImagePreview.src = selectedImage.dataUrl;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

async function initSupabase() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      updateStatus("Нема config");
      return;
    }

    const lib = window.supabase || window.supabaseJs;
    if (!lib || typeof lib.createClient !== "function") {
      updateStatus("Supabase CDN error");
      console.error("Supabase lib missing", window.supabase, window.supabaseJs);
      return;
    }

    supabase = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error(error);
      updateStatus("Session error");
      return;
    }

    currentUser = data?.session?.user || null;
    renderAuthState();

    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      renderAuthState();
    });

    updateStatus("Готово");
  } catch (e) {
    console.error(e);
    updateStatus("JS error");
    alert("Помилка init: " + (e.message || e));
  }
}

async function signInWithGoogle() {
  try {
    if (!supabase) {
      alert("Supabase не ініціалізувався");
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/"
      }
    });
  } catch (e) {
    console.error(e);
    alert("Google login error: " + (e.message || e));
  }
}

async function signOut() {
  try {
    if (!supabase) return;
    await supabase.auth.signOut();
    currentUser = null;
    renderAuthState();
  } catch (e) {
    console.error(e);
    alert("Logout error: " + (e.message || e));
  }
}

async function sendChatMessage(text) {
  const active = ensureChat();

  const userMessage = {
    role: "user",
    content: text
  };

  if (selectedImage?.dataUrl) {
    userMessage.image = selectedImage;
  }

  active.messages.push(userMessage);
  active.updatedAt = Date.now();

  if (active.title === "Новий чат") {
    active.title = text.slice(0, 40) || "Новий чат";
  }

  saveState();
  renderAll();

  promptInput.value = "";
  autoResize();
  selectedImage = null;
  updateSelectedImageUI();

  const assistantMessage = {
    role: "assistant",
    content: "Тестовий режим працює. Кнопки та submit вже живі."
  };

  active.messages.push(assistantMessage);
  active.updatedAt = Date.now();
  saveState();
  renderAll();
}

window.addEventListener("error", (e) => {
  console.error("window error:", e.error || e.message);
});

newChatBtn.addEventListener("click", () => {
  createChat();
});

clearBtn.addEventListener("click", () => {
  const active = ensureChat();
  active.messages = [];
  active.title = "Новий чат";
  active.updatedAt = Date.now();
  saveState();
  renderAll();
});

fastModeBtn.addEventListener("click", () => {
  state.mode = "fast";
  saveState();
  renderAll();
});

smartModeBtn.addEventListener("click", () => {
  state.mode = "smart";
  saveState();
  renderAll();
});

googleLoginBtn.addEventListener("click", signInWithGoogle);
logoutBtn.addEventListener("click", signOut);

syncBtn.addEventListener("click", () => {
  alert("Sync test button працює");
});

exportJsonBtn.addEventListener("click", () => {
  const active = ensureChat();
  const blob = new Blob([JSON.stringify(active, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

exportMdBtn.addEventListener("click", () => {
  const active = ensureChat();
  const text = active.messages.map(m => `## ${m.role}\n\n${m.content}`).join("\n\n");
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

imageBtn.addEventListener("click", () => {
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  try {
    const dataUrl = await fileToDataUrl(file);
    selectedImage = {
      name: file.name,
      type: file.type,
      dataUrl
    };
    updateSelectedImageUI();
  } catch (e) {
    console.error(e);
    alert("Помилка фото: " + (e.message || e));
  }
});

removeImageBtn.addEventListener("click", () => {
  selectedImage = null;
  imageInput.value = "";
  updateSelectedImageUI();
});

generateImageBtn.addEventListener("click", () => {
  alert("Кнопка генерації працює. Image API поки не тестимо.");
});

stopBtn.addEventListener("click", () => {
  if (currentController) currentController.abort();
  alert("Стоп натиснуто");
});

promptInput.addEventListener("input", autoResize);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  await sendChatMessage(text);
});

renderAll();
autoResize();
updateSelectedImageUI();
updateStatus("Старт...");
initSupabase();
