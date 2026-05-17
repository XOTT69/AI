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
const hamburgerCloseBtn = document.getElementById("hamburgerCloseBtn");
const chatSearch = document.getElementById("chatSearch");
const chatTitle = document.getElementById("chatTitle");
const settingsBtn = document.getElementById("settingsBtn");

const SUPABASE_URL = "https://dfvlipfcblnnuxylhzis.supabase.co";
const SUPABASE_KEY = "sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF";
const STORAGE_KEY = "ai-workspace-v1";

const MODELS = {
  "groq/llama-3.3-70b-versatile": {
    label: "Llama 3.3 70B · Groq",
    system: "Ти швидкий, точний і корисний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "gemini/gemini-2.5-flash": {
    label: "Gemini 2.5 Flash",
    system: "Ти мультимодальний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: true
  },
  "cerebras/llama-3.3-70b": {
    label: "Llama 3.3 70B · Cerebras",
    system: "Ти дуже швидкий AI-помічник для щоденних задач. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "meta/llama-3.3-70b-instruct": {
    label: "Llama 3.3 70B",
    system: "Ти потужний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "mistral/mistral-large-latest": {
    label: "Mistral Large",
    system: "Ти розумний AI-помічник для точних і детальних відповідей. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "github/gpt-4o-mini": {
    label: "GPT-4o mini · GitHub",
    system: "Ти універсальний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "qwen/qwen3.5-122b-a10b": {
    label: "Qwen 3.5 122B",
    system: "Ти сильний AI-помічник для складних задач. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "github/phi-4": {
    label: "Phi-4 · GitHub",
    system: "Ти AI-помічник для логічних та технічних запитів. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "mistral/codestral-latest": {
    label: "Codestral",
    system: "Ти AI-помічник для програмування, рев'ю коду та архітектури. Відповідай українською.",
    tokens: 4096,
    vision: false
  },
  "google/gemma-3-27b-it": {
    label: "Gemma 3 27B",
    system: "Ти мультимодальний AI-помічник. Відповідай українською.",
    tokens: 4096,
    vision: true
  },
  "meta/llama-3.2-90b-vision-instruct": {
    label: "Llama 3.2 90B Vision",
    system: "Ти AI-помічник для аналізу зображень. Відповідай українською.",
    tokens: 2048,
    vision: true
  }
};

let sb = null;
if (window.supabase && SUPABASE_URL && SUPABASE_KEY) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

let currentUser = null;
let selectedImage = null;
let requestInFlight = false;
let currentController = null;
let syncTimeout = null;
let hasSyncedOnLoad = false;
let searchQuery = "";

let state = loadState();

const renderer = new marked.Renderer();
renderer.code = function (code, language) {
  const validLang = hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;
  return `
    <div class="code-block">
      <div class="code-header">
        <span>${validLang}</span>
        <button class="copy-btn" onclick="copyCodeBtn(this)">Копіювати</button>
      </div>
      <pre><code class="hljs ${validLang}">${highlighted}</code></pre>
    </div>
  `;
};

marked.setOptions({ renderer, breaks: true, gfm: true });

window.copyCodeBtn = function (btn) {
  const pre = btn.closest(".code-block")?.querySelector("pre");
  if (!pre) return;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    const original = btn.textContent;
    btn.textContent = "Скопійовано";
    setTimeout(() => {
      btn.textContent = original;
    }, 1600);
  });
};

window.retryMessage = function () {
  const active = getActiveChat();
  if (!active) return;
  const lastError = active.messages[active.messages.length - 1];
  if (lastError?.isError) active.messages.pop();
  const lastUserMsg = [...active.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return;
  selectedImage = lastUserMsg.image || null;
  updateSelectedImageUI();
  sendChatMessage(lastUserMsg.content || "", true);
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.chats)) {
      return {
        activeChatId: parsed.activeChatId || null,
        chats: parsed.chats || [],
        theme: parsed.theme || "dark"
      };
    }
  } catch {}
  return { activeChatId: null, chats: [], theme: "dark" };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    state.chats = state.chats.slice(0, 30);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncCurrentChatToCloud();
  }, 1200);
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getActiveChat() {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}

function ensureChat() {
  let active = getActiveChat();
  if (!active) {
    active = {
      id: uid(),
      title: "Новий чат",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.chats.unshift(active);
    state.activeChatId = active.id;
    saveState();
  }
  return active;
}

function setBusy(isBusy, text = "") {
  requestInFlight = isBusy;
  if (statusText) {
    statusText.textContent = text || (isBusy ? "Генерація…" : "Готово");
    statusText.classList.toggle("hidden", false);
  }
  stopBtn?.classList.toggle("hidden", !isBusy);
  sendBtn?.classList.toggle("hidden", isBusy);
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = state.theme === "light" ? "🌙" : "☀️";
  }
}

function openSidebar() {
  sidebar?.classList.add("open");
  mobileOverlay?.classList.add("show");
  document.body.classList.add("no-scroll");
}

function closeSidebar() {
  sidebar?.classList.remove("open");
  mobileOverlay?.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

function autoResize() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + "px";
}

function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatThinking(text) {
  if (!text) return "";
  return text
    .replace(/<think>/g, '<details class="thought-block"><summary>Думки моделі</summary><div class="thought-content">')
    .replace(/<\/think>/g, "</div></details>");
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(formatThinking(text || "")), {
    ADD_TAGS: ["details", "summary"]
  });
}

function updateSelectedImageUI() {
  if (!selectedImage) {
    selectedImageBar?.classList.add("hidden");
    selectedImagePreview?.removeAttribute("src");
    return;
  }

  selectedImageBar?.classList.remove("hidden");
  if (selectedImageName) selectedImageName.textContent = selectedImage.name || "image";
  if (selectedImagePreview) selectedImagePreview.src = selectedImage.dataUrl;
}

function clearSelectedImage() {
  selectedImage = null;
  if (imageInput) imageInput.value = "";
  updateSelectedImageUI();
}

function getFilteredChats() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return state.chats;

  return state.chats.filter((chatItem) => {
    const haystack = [
      chatItem.title || "",
      ...(chatItem.messages || []).map((m) => m.content || "")
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

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
  if (userAvatar) {
    userAvatar.src = meta.avatar_url || meta.picture || "https://placehold.co/40x40/png";
  }
}

function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";

  const chats = getFilteredChats();

  if (!chats.length) {
    chatList.innerHTML = `<div class="chat-list-empty">Нічого не знайдено</div>`;
    return;
  }

  for (const item of chats) {
    const div = document.createElement("button");
    div.type = "button";
    div.className = `chat-item ${item.id === state.activeChatId ? "active" : ""}`;

    const lastMessage = [...(item.messages || [])].reverse().find((m) => m.role === "user" || m.role === "assistant");
    const subtitle = lastMessage?.content?.slice(0, 80) || "Порожній чат";

    div.innerHTML = `
      <div class="chat-item-main">
        <div class="chat-item-title">${escapeHtml(item.title || "Новий чат")}</div>
        <div class="chat-item-subtitle">${escapeHtml(subtitle)}</div>
      </div>
      <button class="chat-item-delete" type="button" aria-label="Видалити чат">✕</button>
    `;

    const deleteBtn = div.querySelector(".chat-item-delete");
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Видалити чат?")) return;

      state.chats = state.chats.filter((c) => c.id !== item.id);
      if (state.activeChatId === item.id) {
        state.activeChatId = state.chats[0]?.id || null;
      }

      saveState();
      renderAll();

      if (currentUser && sb) {
        await sb.from("chats").delete().eq("id", item.id);
      }
    };

    div.onclick = () => {
      if (requestInFlight) return;
      state.activeChatId = item.id;
      saveState();
      renderAll();
      closeSidebar();
    };

    chatList.appendChild(div);
  }
}

function renderMessages() {
  const active = ensureChat();
  if (!chat) return;

  chat.innerHTML = "";

  if (chatTitle) {
    chatTitle.textContent = active.title || "AI Workspace";
  }

  if (!active.messages.length) {
    chat.innerHTML = `
      <div class="chat-empty">
        <h2>Готовий до роботи</h2>
        <p>Запитай що завгодно, додай фото або обери іншу модель.</p>
      </div>
    `;
    return;
  }

  for (const msg of active.messages) {
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${msg.role}`;

    const inner = document.createElement("div");
    inner.className = "message-content";

    if (msg.isError) {
      inner.innerHTML = `
        <div class="error-card">
          <strong>Помилка:</strong> ${escapeHtml(msg.content || "Невідома помилка")}
          <div class="error-actions">
            <button class="ghost-btn danger" type="button" onclick="retryMessage()">Повторити</button>
          </div>
        </div>
      `;
    } else if (msg.role === "assistant") {
      inner.innerHTML = renderMarkdown(msg.content || "");
    } else {
      inner.textContent = msg.content || "";
    }

    if (msg.image?.dataUrl) {
      const img = document.createElement("img");
      img.src = msg.image.dataUrl;
      img.alt = msg.image.name || "uploaded image";
      img.className = "inline-preview-image";
      inner.appendChild(img);
    }

    wrapper.appendChild(inner);
    chat.appendChild(wrapper);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuthState();
  renderChatList();
  renderMessages();
  setBusy(requestInFlight, requestInFlight ? "Генерація…" : "Готово");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

async function syncCurrentChatToCloud() {
  if (!currentUser || !sb) return;
  const active = getActiveChat();
  if (!active) return;

  try {
    await sb.from("chats").upsert({
      id: active.id,
      user_id: currentUser.id,
      title: active.title,
      messages: active.messages,
      updated_at: new Date().toISOString()
    });
  } catch {}
}

async function loadAllChatsFromCloud() {
  if (!currentUser || !sb || hasSyncedOnLoad) return;

  try {
    const { data, error } = await sb
      .from("chats")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });

    if (!error && data?.length) {
      state.chats = data.map((d) => ({
        id: d.id,
        title: d.title,
        messages: d.messages || [],
        createdAt: new Date(d.created_at || d.updated_at).getTime(),
        updatedAt: new Date(d.updated_at || d.created_at).getTime()
      }));

      if (!state.chats.find((c) => c.id === state.activeChatId)) {
        state.activeChatId = state.chats[0]?.id || null;
      }

      saveState();
      renderAll();
    }

    hasSyncedOnLoad = true;
  } catch {}
}

function buildMessagesForAPI(active, assistantMsgId, modelConf) {
  const rawMessages = [{ role: "system", content: modelConf.system }];
  const recent = active.messages.slice(-14).filter((m) => m.id !== assistantMsgId && !m.isError);

  for (const m of recent) {
    if (m.role === "user") {
      const text = (m.content || "").trim();

      if (m.image?.dataUrl && modelConf.vision) {
        rawMessages.push({
          role: "user",
          content: [
            { type: "text", text: text || "Проаналізуй це зображення" },
            { type: "image_url", image_url: { url: m.image.dataUrl } }
          ]
        });
      } else {
        rawMessages.push({
          role: "user",
          content: text || (m.image?.dataUrl ? "Користувач надіслав зображення." : "")
        });
      }
    }

    if (m.role === "assistant") {
      rawMessages.push({
        role: "assistant",
        content: typeof m.content === "string" ? m.content : ""
      });
    }
  }

  const normalized = [];
  let systemMessage = null;

  for (const msg of rawMessages) {
    if (msg.role === "system") {
      systemMessage = msg;
      continue;
    }

    if (!normalized.length) {
      normalized.push(msg);
      continue;
    }

    const prev = normalized[normalized.length - 1];

    if (prev.role === msg.role) {
      if (typeof prev.content === "string" && typeof msg.content === "string") {
        prev.content = `${prev.content}\n\n${msg.content}`.trim();
      } else if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
        prev.content = [...prev.content, ...msg.content];
      } else if (typeof prev.content === "string" && Array.isArray(msg.content)) {
        prev.content = [{ type: "text", text: prev.content }, ...msg.content];
      } else if (Array.isArray(prev.content) && typeof msg.content === "string") {
        prev.content = [...prev.content, { type: "text", text: msg.content }];
      }
    } else {
      normalized.push(msg);
    }
  }

  return systemMessage ? [systemMessage, ...normalized] : normalized;
}

async function sendChatMessage(text, isRetry = false) {
  if (requestInFlight) return;

  const active = ensureChat();
  const modelId = modelSelect?.value || "groq/llama-3.3-70b-versatile";
  const modelConf = MODELS[modelId] || MODELS["groq/llama-3.3-70b-versatile"];

  if (!isRetry) {
    if (selectedImage && !modelConf.vision) {
      active.messages.push({
        id: uid(),
        role: "assistant",
        isError: true,
        content: "Ця модель не підтримує зображення. Обери vision-модель."
      });
      renderAll();
      return;
    }

    active.messages.push({
      id: uid(),
      role: "user",
      content: text,
      image: selectedImage,
      createdAt: Date.now()
    });

    if (active.messages.length === 1) {
      active.title = (text || selectedImage?.name || "Новий чат").slice(0, 40);
    }

    if (active.messages.length > 60) {
      active.messages = active.messages.slice(-60);
    }

    active.updatedAt = Date.now();
    promptInput.value = "";
    autoResize();
    saveState();
  }

  const assistantMsg = {
    id: uid(),
    role: "assistant",
    content: "",
    createdAt: Date.now()
  };

  active.messages.push(assistantMsg);
  renderAll();
  setBusy(true, `Генерація · ${modelConf.label}`);

  const safeMessages = buildMessagesForAPI(active, assistantMsg.id, modelConf);
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
        temperature: 0.2,
        max_tokens: modelConf.tokens,
        top_p: 0.9,
        stream: true
      })
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let message = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.details) message += `: ${parsed.details}`;
        else if (parsed?.error?.message) message += `: ${parsed.error.message}`;
        else if (parsed?.error) message += `: ${typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error)}`;
        else if (raw) message += `: ${raw}`;
      } catch {
        if (raw) message += `: ${raw}`;
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Порожня відповідь сервера");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const msgEls = chat.querySelectorAll(".message-wrapper.assistant .message-content");
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
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta =
              parsed?.choices?.[0]?.delta?.content ||
              parsed?.choices?.[0]?.message?.content ||
              "";

            if (typeof delta === "string" && delta) {
              assistantMsg.content += delta;
              if (targetEl) {
                targetEl.innerHTML = renderMarkdown(assistantMsg.content);
                chat.scrollTop = chat.scrollHeight;
              }
            }
          } catch {}
        }
      }
    }

    clearSelectedImage();
  } catch (e) {
    if (e?.name === "AbortError") {
      assistantMsg.content += "\n\n*[Зупинено]*";
      renderAll();
    } else {
      active.messages.pop();
      active.messages.push({
        id: uid(),
        role: "assistant",
        isError: true,
        content: e.message || "Невідома помилка"
      });
      renderAll();
    }
  } finally {
    currentController = null;
    active.updatedAt = Date.now();
    saveState();
    setBusy(false, "Готово");
  }
}

themeToggleBtn?.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  saveState();
  applyTheme();
});

hamburgerBtn?.addEventListener("click", openSidebar);
hamburgerCloseBtn?.addEventListener("click", closeSidebar);
mobileOverlay?.addEventListener("click", closeSidebar);

chatSearch?.addEventListener("input", (e) => {
  searchQuery = e.target.value || "";
  renderChatList();
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = promptInput?.value.trim() || "";
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
  if (!confirm("Очистити поточний чат?")) return;
  active.messages = [];
  active.title = "Новий чат";
  active.updatedAt = Date.now();
  saveState();
  renderAll();
});

newChatBtn?.addEventListener("click", () => {
  state.activeChatId = null;
  ensureChat();
  renderAll();
  closeSidebar();
  promptInput?.focus();
});

imageBtn?.addEventListener("click", () => imageInput?.click());

imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    alert("Максимальний розмір файлу: 5 МБ.");
    imageInput.value = "";
    return;
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    selectedImage = {
      name: file.name,
      type: file.type,
      dataUrl
    };
    updateSelectedImageUI();
  } catch {
    alert("Помилка завантаження зображення");
  }
});

removeImageBtn?.addEventListener("click", clearSelectedImage);

googleLoginBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" }
  });
});

logoutBtn?.addEventListener("click", async () => {
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  hasSyncedOnLoad = false;
  renderAuthState();
});

settingsBtn?.addEventListener("click", () => {
  alert("Блок налаштувань можна додати наступним кроком: системний промпт, температура, назва воркспейсу, fallback-модель.");
});

sb?.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();
  if (currentUser) loadAllChatsFromCloud();
});

sb?.auth.getSession()
  .then(({ data }) => {
    currentUser = data?.session?.user || null;
    renderAuthState();
    if (currentUser) loadAllChatsFromCloud();
  })
  .catch(() => {});

applyTheme();
renderAll();
autoResize();
updateSelectedImageUI();
