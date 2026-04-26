const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const removeImageBtn = document.getElementById("removeImageBtn");
const selectedImageBar = document.getElementById("selectedImageBar");
const selectedImageName = document.getElementById("selectedImageName");
const selectedImageHint = document.getElementById("selectedImageHint");
const selectedImagePreview = document.getElementById("selectedImagePreview");
const statusText = document.getElementById("statusText");

const SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let selectedImage = null;
let currentUser = null;

function updateStatus(text) {
  if (statusText) statusText.textContent = text;
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

function addMessage(text) {
  const userEl = document.createElement("div");
  userEl.className = "message user";

  const userInner = document.createElement("div");
  userInner.className = "message-content";
  userInner.textContent = text;

  if (selectedImage?.dataUrl) {
    const img = document.createElement("img");
    img.src = selectedImage.dataUrl;
    img.className = "inline-preview-image";
    userInner.appendChild(img);
  }

  userEl.appendChild(userInner);
  chat.appendChild(userEl);

  const botEl = document.createElement("div");
  botEl.className = "message assistant";

  const botInner = document.createElement("div");
  botInner.className = "message-content";
  botInner.textContent = currentUser
    ? "Успішно. Ти залогінений, і базовий чат працює."
    : "Повідомлення додано. Тепер протестуй Google login.";

  botEl.appendChild(botInner);
  chat.appendChild(botEl);

  chat.scrollTop = chat.scrollHeight;
}

async function initAuth() {
  try {
    const { data, error } = await sb.auth.getSession();

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

    const { error } = await sb.auth.signInWithOAuth({
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
    const { error } = await sb.auth.signOut();

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
  }
}

googleLoginBtn.addEventListener("click", signInWithGoogle);
logoutBtn.addEventListener("click", signOut);

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

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();
});

updateSelectedImageUI();
updateStatus("Старт...");
initAuth();
