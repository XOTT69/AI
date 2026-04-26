const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const newChatBtn = document.getElementById("newChatBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportMdBtn = document.getElementById("exportMdBtn");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const removeImageBtn = document.getElementById("removeImageBtn");
const selectedImageBar = document.getElementById("selectedImageBar");
const selectedImageName = document.getElementById("selectedImageName");
const selectedImageHint = document.getElementById("selectedImageHint");
const selectedImagePreview = document.getElementById("selectedImagePreview");
const statusText = document.getElementById("statusText");
const syncBtn = document.getElementById("syncBtn");

const SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let selectedImage = null;
let currentUser = null;

function updateStatus(text) {
  if (statusText) statusText.textContent = text;
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
  selectedImageHint.textContent = "Фото прикріплене.";
  selectedImagePreview.src = selectedImage.dataUrl;
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

function addMessage(text) {
  const el = document.createElement("div");
  el.className = "message user";

  const inner = document.createElement("div");
  inner.className = "message-content";
  inner.textContent = text;

  if (selectedImage?.dataUrl) {
    const img = document.createElement("img");
    img.src = selectedImage.dataUrl;
    img.className = "inline-preview-image";
    inner.appendChild(img);
  }

  el.appendChild(inner);
  chat.appendChild(el);

  const reply = document.createElement("div");
  reply.className = "message assistant";

  const replyInner = document.createElement("div");
  replyInner.className = "message-content";
  replyInner.textContent = currentUser
    ? "Ти увійшов. Локальний чат працює, Google auth теж підключений."
    : "Локальний чат працює. Тепер протестуй реальний Google login.";

  reply.appendChild(replyInner);
  chat.appendChild(reply);

  chat.scrollTop = chat.scrollHeight;
}

async function initAuth() {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error(error);
      updateStatus("Помилка сесії");
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

async function signInWithGoogle() {
  try {
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
  } catch (e) {
    console.error(e);
    alert("Google login crash: " + (e.message || "невідома помилка"));
    updateStatus("Помилка логіну");
  }
}

async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error(error);
      alert("Logout error: " + (error.message || "невідома помилка"));
      return;
    }

    currentUser = null;
    renderAuthState();
    updateStatus("Вийшов");
  } catch (e) {
    console.error(e);
    alert("Logout crash: " + (e.message || "невідома помилка"));
  }
}

googleLoginBtn.addEventListener("click", signInWithGoogle);

logoutBtn.addEventListener("click", signOut);

newChatBtn.addEventListener("click", () => {
  alert("Новий чат працює");
});

exportJsonBtn.addEventListener("click", () => {
  alert("Експорт JSON працює");
});

exportMdBtn.addEventListener("click", () => {
  alert("Експорт MD працює");
});

syncBtn.addEventListener("click", () => {
  alert("Sync підключимо наступним кроком");
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
    alert(e.message || "Помилка фото");
  }
});

removeImageBtn.addEventListener("click", () => {
  selectedImage = null;
  imageInput.value = "";
  updateSelectedImageUI();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;

  addMessage(text);
  promptInput.value = "";
  selectedImage = null;
  updateSelectedImageUI();
});

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();
});

updateSelectedImageUI();
updateStatus("Старт...");
initAuth();
