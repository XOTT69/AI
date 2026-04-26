const SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const clearBtn = document.getElementById("clearBtn");
const newChatBtn = document.getElementById("newChatBtn");
const chatList = document.getElementById("chatList");
const chatTitle = document.getElementById("chatTitle");
const sendBtn = document.getElementById("sendBtn");
const fastModeBtn = document.getElementById("fastModeBtn");
const smartModeBtn = document.getElementById("smartModeBtn");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const generateImageBtn = document.getElementById("generateImageBtn");
const selectedImageBar = document.getElementById("selectedImageBar");
const selectedImageName = document.getElementById("selectedImageName");
const selectedImageHint = document.getElementById("selectedImageHint");
const selectedImagePreview = document.getElementById("selectedImagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportMdBtn = document.getElementById("exportMdBtn");
const statusText = document.getElementById("statusText");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const syncBtn = document.getElementById("syncBtn");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");

marked.setOptions({
  breaks: true,
  gfm: true
});

const STORAGE_KEY = "ai-chat-min-v1";
let selectedImage = null;
let currentUser = null;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
if (!state || !Array.isArray(state.chats)) {
  state = {
    activeChatId: null,
    chats: [],
    mode: "fast"
  };
}

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
    updatedAt: Date.now(),
    messages: []
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

function updateChatTitle(chatObj) {
  const firstUser = chatObj.messages.find(m => m.role === "user");
  if (!firstUser) return;

  const text = String(firstUser.content || "").trim();
  chatObj.title = text ? text.slice(0, 40) : "Новий чат";
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text || ""));
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

function renderChatList() {
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

    div.append(title, meta);
    div.addEventListener("click", () => {
      state.activeChatId = item.id;
      saveState();
      renderAll();
    });

    chatList.appendChild(div);
  }
}

function renderMessages() {
  const active = ensureChat();
  chat.innerHTML = "";
  chatTitle.textContent = active.title || "Новий чат";

  if (!active.messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = currentUser
      ? "Увійшов через Google. Локальний чат уже працює."
      : "Локальний чат працює. Можна писати повідомлення і тестити Google login.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    const el = document.createElement("div");
    el.className = `message ${msg.role}`;

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
      img.alt = "selected image";
      img.className = "inline-preview-image";
      inner.appendChild(img);
    }

    el.appendChild(inner);
    chat.appendChild(el);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuthState();
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
    selectedImageName.textContent = "Фото не вибрано";
    selectedImageHint.textContent = "Фото буде відправлено разом із наступним повідомленням.";
    selectedImagePreview.removeAttribute("src");
    return;
  }

  selectedImageBar.classList.remove("hidden");
  selectedImageName.textContent = selectedImage.name || "selected-image";
  selectedImageHint.textContent = "Фото прикріплене до наступного повідомлення.";
  selectedImagePreview.src = selectedImage.dataUrl;
}

function clearSelectedImage() {
  selectedImage = null;
  imageInput.value = "";
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

async function signInWithGoogle() {
  updateStatus("Перехід у Google...");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/"
    }
  });

  if (error) {
    console.error(error);
    alert("Google login error: " + (error.message || "невідома помилка"));
    updateStatus("Помилка логіну");
  }
}

async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error(error);
    alert("Logout error: " + (error.message || "невідома помилка"));
    return;
  }

  currentUser = null;
  renderAuthState();
  updateStatus("Вийшов");
}

async function initAuth() {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error(error);
      updateStatus("Session error");
      return;
    }

    currentUser = data?.session?.user || null;
    renderAuthState();
    updateStatus("Готово");
  } catch (e) {
    console.error(e);
    updateStatus("Auth init error");
  }
}

function addUserMessage(text) {
  const active = ensureChat();

  const msg = {
    role: "user",
    content: text
  };

  if (selectedImage?.dataUrl) {
    msg.image = selectedImage;
  }

  active.messages.push(msg);
  active.updatedAt = Date.now();
  updateChatTitle(active);
  saveState();
  renderAll();
}

function addAssistantMessage(text) {
  const active = ensureChat();

  active.messages.push({
    role: "assistant",
    content: text
  });

  active.updatedAt = Date.now();
  saveState();
  renderAll();
}

async function sendChatMessage(text) {
  addUserMessage(text);
  promptInput.value = "";
  autoResize();
  clearSelectedImage();

  addAssistantMessage("Повідомлення додано. Базовий чат працює. Далі підключимо повний серверний режим.");
}

function exportJson() {
  const active = ensureChat();
  const blob = new Blob([JSON.stringify(active, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMd() {
  const active = ensureChat();
  const text = active.messages.map(m => `## ${m.role}\n\n${m.content}`).join("\n\n");
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  alert("Sync підключимо наступним кроком. Зараз тестимо стабільний login + чат.");
});

exportJsonBtn.addEventListener("click", exportJson);
exportMdBtn.addEventListener("click", exportMd);

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
    alert("Помилка фото: " + (e.message || "невідома помилка"));
  }
});

removeImageBtn.addEventListener("click", clearSelectedImage);

generateImageBtn.addEventListener("click", () => {
  alert("Генерацію фото підключимо окремо після стабілізації логіну.");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  await sendChatMessage(text);
});

promptInput.addEventListener("input", autoResize);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();
});

renderAll();
autoResize();
updateSelectedImageUI();
updateStatus("Старт...");
initAuth();
