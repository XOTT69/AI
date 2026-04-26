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

// Ключі Supabase (безпечно тримати на фронтенді)
let supaUrl = "https://dfvlipfcblnnuxylhzis.supabase.co"; 
let supaKey = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";

const ALLOWED_MODELS = {
  "meta/llama-3.3-70b-instruct": { system: "Ти швидкий AI-помічник. Відповідай українською.", fastTokens: 1500, smartTokens: 3000 },
  "google/gemma-2-27b-it": { system: "Ти швидкий AI-помічник. Відповідай українською.", fastTokens: 1500, smartTokens: 3000 },
  "google/gemma-3-27b-it": { system: "Ти мультимодальний AI-помічник. Описуй фото українською.", fastTokens: 1500, smartTokens: 3000 },
  "abacusai/dracarys-llama-3.1-70b-instruct": { system: "Ти програміст-експерт. Відповідай українською.", fastTokens: 2000, smartTokens: 4000 }
};

let sb = null;
if (supaUrl && supaKey && window.supabase) {
  sb = window.supabase.createClient(supaUrl, supaKey);
} else {
  sb = { auth: { getSession: async () => ({}), onAuthStateChange: () => {} } };
}

const STORAGE_KEY = "ai-chat-sync-v20";
let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
if (!state || !Array.isArray(state.chats)) state = { activeChatId: null, chats: [], mode: "fast" };

marked.setOptions({ breaks: true, gfm: true });

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function updateStatus(text) { if (statusText) statusText.textContent = text; }
function getActiveChat() { return state.chats.find(c => c.id === state.activeChatId) || null; }

function ensureChat() {
  let active = getActiveChat();
  if (!active) {
    active = { id: uid(), title: "Новий чат", messages: [] };
    state.chats.unshift(active);
    state.activeChatId = active.id;
    saveState();
    renderAll();
  }
  return active;
}

function renderMarkdown(text) { return DOMPurify.sanitize(marked.parse(text || "")); }

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
    
    div.append(title, meta);
    div.onclick = () => { if(!requestInFlight) { state.activeChatId = item.id; saveState(); renderAll(); }};
    chatList.appendChild(div);
  }
}

function renderMessages() {
  const active = ensureChat();
  if (!chat) return;
  chat.innerHTML = "";
  if (chatTitle) chatTitle.textContent = active.title || "Новий чат";

  for (const msg of active.messages) {
    const wrap = document.createElement("div");
    wrap.className = `message ${msg.role}`;
    const inner = document.createElement("div");
    inner.className = "message-content";

    inner.innerHTML = msg.role === "assistant" ? renderMarkdown(msg.content || "") : (msg.content || "");
    
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
  if (!selectedImageBar) return;
  if (!selectedImage) {
    selectedImageBar.classList.add("hidden");
    return;
  }
  selectedImageBar.classList.remove("hidden");
  if(selectedImageName) selectedImageName.textContent = selectedImage.name || "Зображення";
  if(selectedImagePreview) selectedImagePreview.src = selectedImage.dataUrl;
}

function clearSelectedImage() {
  selectedImage = null;
  if (imageInput) imageInput.value = "";
  updateSelectedImageUI();
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function setBusy(isBusy, status = "Готово") {
  requestInFlight = isBusy;
  if (sendBtn) sendBtn.disabled = isBusy;
  if (stopBtn) stopBtn.disabled = !isBusy;
  updateStatus(status);
}

// Запит на наш безпечний проксі `/api/proxy`, де схований ключ NVIDIA
async function sendChatMessage(text) {
  if (requestInFlight) return;
  
  const active = ensureChat();
  active.messages.push({ id: uid(), role: "user", content: text, image: selectedImage });
  if (active.messages.length === 1) active.title = text.slice(0, 40);
  
  promptInput.value = "";
  autoResize();
  
  const assistantMsg = { id: uid(), role: "assistant", content: "" };
  active.messages.push(assistantMsg);
  renderAll();
  
  setBusy(true, "Генерація...");
  const modelId = modelSelect?.value || "meta/llama-3.3-70b-instruct";
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
    recent.forEach(m => safeMessages.push({ role: m.role, content: m.content }));
  }

  clearSelectedImage();
  const controller = new AbortController();
  currentController = controller;

  try {
    // ЗВЕРТАЄМОСЯ ДО НАШОГО ПРОКСІ НА VERCEL (не до /api/chat)
    const response = await fetch("/api/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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
              const delta = parsed?.choices?.[0]?.delta?.content || "";
              if (delta) {
                assistantMsg.content += delta;
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
    assistantMsg.content += e.name === "AbortError" ? "\n\n*[Зупинено]*" : `\n\nПомилка: ${e.message}`;
    const msgEls = chat.querySelectorAll('.message.assistant .message-content');
    if(msgEls.length > 0) msgEls[msgEls.length - 1].innerHTML = renderMarkdown(assistantMsg.content);
  } finally {
    currentController = null;
    saveState();
    renderAll();
    setBusy(false, "Готово");
  }
}

form?.addEventListener("submit", (e) => { e.preventDefault(); const text = promptInput?.value.trim(); if (text) sendChatMessage(text); });
promptInput?.addEventListener("input", autoResize);
promptInput?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form?.requestSubmit(); } });
stopBtn?.addEventListener("click", () => currentController?.abort());
clearBtn?.addEventListener("click", () => { ensureChat().messages = []; saveState(); renderAll(); });
newChatBtn?.addEventListener("click", () => { state.activeChatId = null; ensureChat(); renderAll(); });
fastModeBtn?.addEventListener("click", () => { state.mode = "fast"; saveState(); renderAll(); });
smartModeBtn?.addEventListener("click", () => { state.mode = "smart"; saveState(); renderAll(); });

imageBtn?.addEventListener("click", () => imageInput?.click());
imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  selectedImage = { name: file.name, dataUrl: await fileToDataUrl(file) };
  updateSelectedImageUI();
});
removeImageBtn?.addEventListener("click", clearSelectedImage);

renderAll();
autoResize();
