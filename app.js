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

let supaUrl = "https://dfvlipfcblnnuxylhzis.supabase.co";
let supaKey = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";

// --- ТУТ ДОДАНА НОВА МОДЕЛЬ VISION ВІД META (LLAMA 3.2 90B VISION) ---
const ALLOWED_MODELS = {
  "meta/llama-3.3-70b-instruct": { system: "Ти швидкий і точний AI-помічник.", tokens: 8192, vision: false },
  "qwen/qwen3.5-122b-a10b": { system: "Ти сильний AI-помічник для складних запитів.", tokens: 8192, vision: false },
  "meta/llama-3.2-90b-vision-instruct": { system: "Ти крутий AI-помічник, що розпізнає зображення.", tokens: 4000, vision: true },
  "google/gemma-3-27b-it": { system: "Ти мультимодальний AI-помічник.", tokens: 8192, vision: true },
  "abacusai/dracarys-llama-3.1-70b-instruct": { system: "Ти AI-помічник для програмування.", tokens: 8192, vision: false }
};

let sb = null;
if (supaUrl && supaKey && window.supabase) {
  sb = window.supabase.createClient(supaUrl, supaKey);
}

const STORAGE_KEY = "ai-chat-sync-v32"; // Оновив ключ кешу
let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;
let hasSyncedOnLoad = false;

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem("ai-chat-sync-v31") || "null");
if (!state || !Array.isArray(state.chats)) state = { activeChatId: null, chats: [], theme: "dark" };
if (!state.theme) state.theme = "dark";

// --- Markdown: Підсвітка та Завантаження ---
const renderer = new marked.Renderer();
renderer.code = function(code, language) {
  const validLang = hljs.getLanguage(language) ? language : 'plaintext';
  const highlighted = hljs.highlight(code, { language: validLang }).value;
  return `<div class="code-block">
            <div class="code-header">
              <span>${validLang}</span>
              <div style="display:flex; gap:12px;">
                <button class="copy-btn" onclick="copyCodeBtn(this)">📋 Копіювати</button>
                <button class="copy-btn" onclick="downloadCodeBtn(this, '${validLang}')">💾 Файл</button>
              </div>
            </div>
            <pre><code class="hljs ${validLang}">${highlighted}</code></pre>
          </div>`;
};
marked.setOptions({ renderer: renderer, breaks: true, gfm: true });

window.copyCodeBtn = function(btn) {
  const pre = btn.parentElement.parentElement.nextElementSibling;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.innerHTML = '✅'; setTimeout(() => btn.innerHTML = '📋 Копіювати', 2000);
  });
};

window.downloadCodeBtn = function(btn, ext) {
  const pre = btn.parentElement.parentElement.nextElementSibling;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([pre.innerText], { type: 'text/plain' }));
  a.download = 'code.' + (ext !== 'plaintext' ? ext : 'txt'); a.click();
};

window.downloadFullText = function(msgId) {
  const msg = getActiveChat()?.messages.find(m => m.id === msgId);
  if (!msg) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([msg.content], { type: 'text/plain;charset=utf-8' }));
  a.download = 'AI_Response.txt'; a.click();
};

function formatThinking(text) {
  if (!text) return "";
  let processed = text.replace(/<think>/g, '<details class="thought-block"><summary>Думка</summary><div class="thought-content">');
  return processed.replace(/<\/think>/g, '</div></details>');
}
function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(formatThinking(text)), { ADD_TAGS: ['details', 'summary'] });
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// --- МИТТЄВЕ ЗБЕРЕЖЕННЯ ---
let syncTimeout = null;
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); 
  } catch(e) {
    if(state.chats.length > 20) { state.chats = state.chats.slice(0, 20); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  }
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(syncCurrentChatToCloud, 2000);
}

function getActiveChat() { return state.chats.find(c => c.id === state.activeChatId) || null; }

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  if (themeToggleBtn) themeToggleBtn.textContent = state.theme === "light" ? "🌙" : "☀️";
}
themeToggleBtn?.addEventListener("click", () => { state.theme = state.theme === "light" ? "dark" : "light"; saveState(); applyTheme(); });
hamburgerBtn?.addEventListener("click", () => { sidebar.classList.add("open"); mobileOverlay.classList.add("show"); });
mobileOverlay?.addEventListener("click", () => { sidebar.classList.remove("open"); mobileOverlay.classList.remove("show"); });

function ensureChat() {
  let active = getActiveChat();
  if (!active) {
    active = { id: uid(), title: "Новий чат", messages: [], createdAt: Date.now() };
    state.chats.unshift(active); state.activeChatId = active.id; saveState();
  }
  return active;
}

function renderAuthState() {
  if (!authLoggedOut || !authLoggedIn) return;
  if (!currentUser) { authLoggedOut.classList.remove("hidden"); authLoggedIn.classList.add("hidden"); return; }
  authLoggedOut.classList.add("hidden"); authLoggedIn.classList.remove("hidden");
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
    div.innerHTML = `<div class="chat-item-title">${item.title || "Новий чат"}</div><button class="chat-item-delete">✕</button>`;
    div.querySelector('.chat-item-delete').onclick = async (e) => {
      e.stopPropagation();
      if (confirm("Видалити чат?")) {
        state.chats = state.chats.filter(c => c.id !== item.id);
        if (state.activeChatId === item.id) state.activeChatId = state.chats[0]?.id || null;
        saveState(); renderAll();
        if(currentUser && sb) await sb.from('chats').delete().eq('id', item.id);
      }
    };
    div.onclick = () => {
      if (requestInFlight) return;
      state.activeChatId = item.id; saveState(); renderAll();
      sidebar.classList.remove("open"); mobileOverlay.classList.remove("show");
    };
    chatList.appendChild(div);
  }
}

async function syncCurrentChatToCloud() {
  if (!currentUser || !sb) return;
  const active = getActiveChat(); if (!active) return;
  try { await sb.from('chats').upsert({ id: active.id, user_id: currentUser.id, title: active.title, messages: active.messages, updated_at: new Date().toISOString() }); } catch(e) {}
}

async function loadAllChatsFromCloud() {
  if (!currentUser || !sb || hasSyncedOnLoad) return;
  try {
    const { data, error } = await sb.from('chats').select('*').eq('user_id', currentUser.id).order('updated_at', { ascending: false });
    if (!error && data && data.length > 0) {
      state.chats = data.map(d => ({ id: d.id, title: d.title, messages: d.messages || [], createdAt: new Date(d.created_at || d.updated_at).getTime() }));
      if (!state.chats.find(c => c.id === state.activeChatId)) state.activeChatId = state.chats[0].id;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); renderAll();
    }
    hasSyncedOnLoad = true;
  } catch(e) {}
}

window.retryMessage = function() {
  const active = getActiveChat(); if (!active) return;
  active.messages.pop(); const lastUserMsg = active.messages[active.messages.length - 1];
  if (lastUserMsg) sendChatMessage(lastUserMsg.content, true);
};

function renderMessages() {
  const active = ensureChat(); if (!chat) return;
  chat.innerHTML = "";
  if (!active.messages.length) { chat.innerHTML = `<div class="chat-empty">Чим можу допомогти?</div>`; return; }

  for (const msg of active.messages) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.role}`;
    const inner = document.createElement("div");
    inner.className = "message-content";
    
    if (msg.isError) {
      inner.innerHTML = `<div style="background:var(--danger-bg); color:var(--danger-text); padding:12px; border-radius:12px; border:1px solid var(--danger-text);">
        <strong>Помилка:</strong> ${msg.content}<br><button class="btn" style="margin-top:10px; width:auto; border-color:var(--danger-text); color:var(--danger-text);" onclick="retryMessage()">🔄 Повторити</button></div>`;
    } else if (msg.role === "assistant") {
      inner.innerHTML = renderMarkdown(msg.content || "");
      const downloadBtn = document.createElement("button"); downloadBtn.className = "btn"; downloadBtn.innerHTML = "💾 Завантажити (.txt)";
      downloadBtn.style.cssText = "margin-top: 12px; font-size: 12px; width: auto; padding: 6px 12px; background: transparent; border: 1px solid var(--border); color: var(--muted);";
      downloadBtn.onclick = () => downloadFullText(msg.id); inner.appendChild(downloadBtn);
    } else { inner.textContent = msg.content || ""; }

    if (msg.image?.dataUrl) {
      const img = document.createElement("img"); img.src = msg.image.dataUrl; img.className = "inline-preview-image"; inner.appendChild(img);
    }
    wrapper.appendChild(inner); chat.appendChild(wrapper);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuthState(); renderChatList(); renderMessages();
  if (stopBtn && sendBtn) {
    if (requestInFlight) { stopBtn.classList.remove("hidden"); sendBtn.classList.add("hidden"); } 
    else { stopBtn.classList.add("hidden"); sendBtn.classList.remove("hidden"); }
  }
}

function autoResize() { if (!promptInput) return; promptInput.style.height = "auto"; promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px"; }

function updateSelectedImageUI() {
  if (!selectedImageBar || !selectedImagePreview) return;
  if (!selectedImage) { selectedImageBar.classList.add("hidden"); selectedImagePreview.removeAttribute("src"); return; }
  selectedImageBar.classList.remove("hidden"); if(selectedImageName) selectedImageName.textContent = selectedImage.name || "Зображення";
  selectedImagePreview.src = selectedImage.dataUrl;
}

function clearSelectedImage() { selectedImage = null; if (imageInput) imageInput.value = ""; updateSelectedImageUI(); }

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл")); reader.readAsDataURL(file);
  });
}

function setBusy(isBusy) { requestInFlight = isBusy; renderAll(); }

async function sendChatMessage(text, isRetry = false) {
  if (requestInFlight) return;
  const active = ensureChat();
  
  if (!isRetry) {
    active.messages.push({ id: uid(), role: "user", content: text, image: selectedImage, createdAt: Date.now() });
    if (active.messages.length === 1) active.title = text.slice(0, 30) || "Новий чат";
    if (active.messages.length > 50) active.messages = active.messages.slice(-50); 
    promptInput.value = ""; autoResize(); clearSelectedImage();
    saveState(); 
  }

  const assistantMsg = { id: uid(), role: "assistant", content: "", createdAt: Date.now() };
  active.messages.push(assistantMsg);
  renderAll(); setBusy(true);

  let modelId = modelSelect?.value || "meta/llama-3.3-70b-instruct";
  let modelConf = ALLOWED_MODELS[modelId] || ALLOWED_MODELS["meta/llama-3.3-70b-instruct"];
  
  // ЯКЩО Є ФОТО, АЛЕ ОБРАНА МОДЕЛЬ БЕЗ VISION - ПРИМУСОВО ПЕРЕМИКАЄМО НА VISION-МОДЕЛЬ
  const lastUserMsg = active.messages[active.messages.length - 2];
  if (lastUserMsg?.image && !modelConf.vision) {
    modelId = "meta/llama-3.2-90b-vision-instruct";
    modelConf = ALLOWED_MODELS[modelId];
    if (modelSelect) modelSelect.value = modelId;
  }
  
  let safeMessages = [{ role: "system", content: modelConf.system }];
  const recent = active.messages.slice(-15).filter(m => m.id !== assistantMsg.id && !m.isError);

  // --- ІДЕАЛЬНИЙ ПАРСИНГ ФОТО ДЛЯ NVIDIA NIM ---
  recent.forEach(m => { 
    if (m.role === "user" && m.image?.dataUrl) {
      safeMessages.push({ 
        role: "user", 
        content: [
          { type: "text", text: m.content || "Опиши це зображення." }, 
          { type: "image_url", image_url: { url: m.image.dataUrl } }
        ] 
      });
    } else {
      safeMessages.push({ role: m.role, content: m.content }); 
    }
  });

  const controller = new AbortController(); currentController = controller;

  try {
    const response = await fetch("/api/proxy", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ model: modelId, messages: safeMessages, temperature: 0.3, max_tokens: modelConf.tokens, top_p: 0.9, stream: true })
    });
    if (!response.ok) throw new Error(`${response.status} - Переконайтесь, що API-ключ дійсний.`);

    const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8"); let buffer = "";
    const msgEls = chat.querySelectorAll(".message-wrapper.assistant .message-content"); const targetEl = msgEls[msgEls.length - 1];

    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const parts = buffer.split("\n\n"); buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue; const dataStr = line.slice(5).trim(); if (dataStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(dataStr); const delta = parsed?.choices?.[0]?.delta?.content || "";
            if (delta) {
              assistantMsg.content += delta;
              if (targetEl) { targetEl.innerHTML = renderMarkdown(assistantMsg.content); chat.scrollTop = chat.scrollHeight; }
            }
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") { assistantMsg.content += "\n\n*[Зупинено]*"; } 
    else { active.messages.pop(); active.messages.push({ id: uid(), role: "assistant", isError: true, content: e.message }); }
  } finally {
    currentController = null; saveState(); setBusy(false);
  }
}

form?.addEventListener("submit", (e) => { e.preventDefault(); const text = promptInput?.value.trim(); if (text || selectedImage) sendChatMessage(text); });
promptInput?.addEventListener("input", autoResize); promptInput?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form?.requestSubmit(); } });
stopBtn?.addEventListener("click", () => currentController?.abort());
clearBtn?.addEventListener("click", () => { const active = ensureChat(); if (confirm("Очистити історію?")) { active.messages = []; active.title = "Новий чат"; saveState(); renderAll(); } });
newChatBtn?.addEventListener("click", () => { state.activeChatId = null; ensureChat(); renderAll(); sidebar.classList.remove("open"); mobileOverlay.classList.remove("show"); });
imageBtn?.addEventListener("click", () => imageInput?.click());
imageInput?.addEventListener("change", async () => { const file = imageInput.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { alert("Максимальний розмір: 5 МБ."); imageInput.value = ""; return; } try { const dataUrl = await fileToDataUrl(file); selectedImage = { name: file.name, type: file.type, dataUrl }; updateSelectedImageUI(); } catch (e) {} });
removeImageBtn?.addEventListener("click", clearSelectedImage);

sb?.auth.onAuthStateChange((_event, session) => { currentUser = session?.user || null; renderAuthState(); if (currentUser) loadAllChatsFromCloud(); });
sb?.auth.getSession().then(({ data }) => { currentUser = data?.session?.user || null; renderAuthState(); if (currentUser) loadAllChatsFromCloud(); }).catch(() => {});

googleLoginBtn?.addEventListener("click", async () => { if (!sb) return; await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } }); });
logoutBtn?.addEventListener("click", async () => { if (!sb) return; await sb.auth.signOut(); currentUser = null; hasSyncedOnLoad = false; renderAuthState(); });

applyTheme(); renderAll(); autoResize(); updateSelectedImageUI();
