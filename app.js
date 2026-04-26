const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const googleLoginBtn = document.getElementById("googleLoginBtn");
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

let selectedImage = null;

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
  replyInner.textContent = "Повідомлення додано. Базовий JS вже працює.";

  reply.appendChild(replyInner);
  chat.appendChild(reply);

  chat.scrollTop = chat.scrollHeight;
}

newChatBtn.addEventListener("click", () => {
  alert("Новий чат працює");
});

googleLoginBtn.addEventListener("click", () => {
  alert("Google button працює");
});

exportJsonBtn.addEventListener("click", () => {
  alert("Експорт JSON працює");
});

exportMdBtn.addEventListener("click", () => {
  alert("Експорт MD працює");
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

updateSelectedImageUI();
updateStatus("Базовий режим");
