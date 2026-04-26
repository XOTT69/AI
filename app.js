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
const sidebar = document.getElementById("sidebar");
const mobileOverlay = document.getElementById("mobileOverlay");
const quickActionsSection = document.getElementById("quickActionsSection");
const quickActionsToggleIcon = document.getElementById("quickActionsToggleIcon");

const SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_KEY = "ai-chat-sync-v6";

let currentUser = null;
let selectedImage = null;
let currentController = null;
let requestInFlight = false;
let currentTimeoutId = null;
let currentAssistantBubble = null;

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

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateStatus(text) {
  if (statusText) statusText.textContent = text;
}

function closeMobileSidebar() {
  if (!sidebar || !mobileOverlay) return;
  if (window.innerWidth > 960) return;
  sidebar.classList.remove("open");
  mobileOverlay.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

function closeAllChatMenus() {
  document.querySelectorAll(".chat-menu.show").forEach((el) => el.classList.remove("show"));
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

function ensureChat() {
  let active = getActiveChat();
  if (!active) active = createLocalChat("Новий чат");
  return active;
}

function createLocalChat(initialTitle = "Новий чат", forcedId = null) {
  const chatObj = {
    id: forcedId || uid(),
    serverId: null,
    title: initialTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };

  state.chats.unshift(chatObj);
  state.activeChatId = chatObj.id;
  saveState();
  renderAll();
  closeMobileSidebar();
  return chatObj;
}

function updateChatTitle(chatObj) {
  const firstUser = chatObj.messages.find(m => m.role === "user");
  if (!firstUser) return;
  const text = String(firstUser.content || "").trim();
  chatObj.title = text ? text.slice(0, 40) : "Новий чат";
}

function switchChat(chatId) {
  if (requestInFlight) return;
  state.activeChatId = chatId;
  saveState();
  renderAll();
  closeMobileSidebar();
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text || ""));
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
    menuBtn.type = "button";
    menuBtn.className = "chat-menu-btn";
    menuBtn.textContent = "⋯";

    const menu = document.createElement("div");
    menu.className = "chat-menu";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Відкрити";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.remove("show");
      switchChat(item.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Видалити";
    deleteBtn.className = "danger";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.classList.remove("show");
      await deleteChat(item.id);
    });

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".chat-menu.show").forEach((el) => {
        if (el !== menu) el.classList.remove("show");
      });
      menu.classList.toggle("show");
    });

    menu.append(openBtn, deleteBtn);
    menuWrap.append(menuBtn, menu);

    div.append(title, meta, menuWrap);
    div.addEventListener("click", () => switchChat(item.id));
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
    empty.textContent = currentUser
      ? "Ти увійшов. Напиши повідомлення, і ШІ відповість."
      : "Локальний чат працює. Увійди через Google для sync.";
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
}

function autoResize() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 240) + "px";
}

function updateSelectedImageUI() {
  if (!selectedImageBar || !selectedImageName || !selectedImageHint || !selectedImagePreview) return;

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
  const text = active.messages.map(m => `## ${m.role}\n\n${m.content || ""}`).join("\n\n");
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chat.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function ensureProfile(user) {
  if (!user) return;

  const meta = user.user_metadata || {};
  await sb.from("profiles").upsert({
    id: user.id,
    email: user.email || null,
    full_name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || meta.picture || null,
    provider: user.app_metadata?.provider || "google",
    updated_at: new Date().toISOString()
  });
}

async function signInWithGoogle() {
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
}

async function signOut() {
  const { error } = await sb.auth.signOut();

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
    const { data, error } = await sb.auth.getSession();

    if (error) {
      console.error(error);
      updateStatus("Помилка сесії");
      return;
    }

    currentUser = data?.session?.user || null;
    renderAuthState();

    if (currentUser) {
      await ensureProfile(currentUser);
    }

    updateStatus("Готово");
  } catch (e) {
    console.error(e);
    updateStatus("Auth init error");
  }
}

function addUserMessage(text) {
  const active = ensureChat();

  const msg = {
    id: uid(),
    role: "user",
    content: text,
    createdAt: Date.now()
  };

  if (selectedImage?.dataUrl) {
    msg.image = {
      name: selectedImage.name,
      type: selectedImage.type,
      dataUrl: selectedImage.dataUrl
    };
  }

  active.messages.push(msg);
  active.updatedAt = Date.now();
  updateChatTitle(active);
  saveState();
  renderAll();

  return msg;
}

function addAssistantMessage(text) {
  const active = ensureChat();

  const msg = {
    id: uid(),
    role: "assistant",
    content: text,
    createdAt: Date.now()
  };

  active.messages.push(msg);
  active.updatedAt = Date.now();
  saveState();
  renderAll();

  return msg;
}

function createAssistantStreamingBubble() {
  const wrap = document.createElement("div");
  wrap.className = "message assistant typing";

  const inner = document.createElement("div");
  inner.className = "message-content";
  inner.textContent = "Думаю...";

  wrap.appendChild(inner);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;

  currentAssistantBubble = { wrap, inner };
  return currentAssistantBubble;
}

function removeAssistantStreamingBubble() {
  if (!currentAssistantBubble) return;
  currentAssistantBubble.wrap.remove();
  currentAssistantBubble = null;
}

function setBusy(isBusy, status = "Готово") {
  requestInFlight = isBusy;
  if (sendBtn) sendBtn.disabled = isBusy;
  if (stopBtn) stopBtn.disabled = !isBusy;

  if (isBusy) {
    const model = modelSelect?.value || "";
    if (model.includes("glm")) {
      updateStatus("GLM думає довше...");
      return;
    }
    if (model.includes("pro") || state.mode === "smart") {
      updateStatus("Розумний режим може відповідати довше...");
      return;
    }
  }

  updateStatus(status);
}

function trimMessages(messages, maxItems = 12) {
  return messages.slice(-maxItems).map((m) => ({
    role: m.role,
    content: m.content
  }));
}

function getModePayload() {
  let effectiveModel = modelSelect?.value || "deepseek-ai/deepseek-v4-flash";

  if (state.mode === "fast" && effectiveModel.includes("pro")) {
    effectiveModel = "deepseek-ai/deepseek-v4-flash";
  }

  return {
    model: effectiveModel,
    responseMode: state.mode === "smart" ? "smart" : "fast"
  };
}

async function* parseSSEStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const lines = event.split("\n");
        const dataLines = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("data:")) {
            dataLines.push(trimmed.slice(5).trim());
          }
        }

        const data = dataLines.join("");
        if (!data) continue;

        if (data === "[DONE]") {
          yield { type: "__done__" };
          continue;
        }

        try {
          const parsed = JSON.parse(data);

          if (parsed.choices?.[0]?.delta?.content) {
            yield { type: "content", content: parsed.choices[0].delta.content };
            continue;
          }

          if (parsed.type || parsed.content || parsed.message || parsed.error) {
            yield parsed;
          }
        } catch {
          yield { type: "content", content: data };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function clearCurrentTimeout() {
  if (currentTimeoutId) {
    clearTimeout(currentTimeoutId);
    currentTimeoutId = null;
  }
}

function getTimeoutMs() {
  const model = modelSelect?.value || "";

  if (model.includes("flash")) return 30000;
  return null;
}

function getAbortMessage() {
  if (currentController?.signal?.aborted) {
    return "Запит зупинено.";
  }
  return "Запит перервано.";
}

async function sendChatMessage(text) {
  const active = ensureChat();

  addUserMessage(text);
  promptInput.value = "";
  autoResize();

  const bubble = createAssistantStreamingBubble();
  let contentText = "";

  setBusy(true, "Генерація відповіді...");

  try {
    currentController = new AbortController();

    const timeoutMs = getTimeoutMs();
    if (timeoutMs) {
      currentTimeoutId = setTimeout(() => {
        if (currentController) currentController.abort();
      }, timeoutMs);
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...getModePayload(),
        thinking: !!thinkingCheckbox?.checked,
        messages: trimMessages(active.messages, 12),
        image: selectedImage?.dataUrl ? {
          dataUrl: selectedImage.dataUrl,
          name: selectedImage.name,
          type: selectedImage.type
        } : null,
        stream: true
      }),
      signal: currentController.signal
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(raw || `HTTP ${response.status}`);
    }

    clearSelectedImage();

    if (!response.body) {
      const raw = await response.text();
      contentText = raw || "Порожня відповідь";
    } else {
      for await (const event of parseSSEStream(response.body)) {
        if (event.type === "__done__" || event.type === "done") continue;

        if (event.type === "content") {
          contentText += event.content || "";
          bubble.inner.textContent = contentText || "Думаю...";
          chat.scrollTop = chat.scrollHeight;
          continue;
        }

        if (event.type === "error") {
          throw new Error(event.message || event.error || "Streaming error");
        }

        if (event.message && String(event.message).toLowerCase().includes("terminated")) {
          throw new Error("terminated");
        }
      }
    }

    clearCurrentTimeout();
    removeAssistantStreamingBubble();
    addAssistantMessage(contentText || "Порожня відповідь");
  } catch (e) {
    clearCurrentTimeout();
    console.error(e);

    removeAssistantStreamingBubble();

    const msg = String(e?.message || "").toLowerCase();

    if (e?.name === "AbortError") {
      addAssistantMessage(getAbortMessage());
    } else if (msg.includes("terminated")) {
      addAssistantMessage("Сервер обірвав генерацію. Спробуй Flash або вимкни Thinking.");
    } else {
      addAssistantMessage("Помилка: " + (e.message || "невідома помилка"));
    }
  } finally {
    clearCurrentTimeout();
    currentController = null;
    setBusy(false, "Готово");
  }
}

function mapServerChat(row, messages = []) {
  return {
    id: `local-${row.id}`,
    serverId: row.id,
    title: row.title || "Новий чат",
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.created_at).getTime(),
      image: m.image_data_url ? {
        name: m.image_name || "image",
        type: m.image_type || "image/png",
        dataUrl: m.image_data_url
      } : null
    }))
  };
}

async function ensureServerChat(chatObj) {
  if (!currentUser) return null;
  if (chatObj.serverId) return chatObj.serverId;

  const oldId = chatObj.id;

  const { data, error } = await sb
    .from("chats")
    .insert({
      user_id: currentUser.id,
      title: chatObj.title || "Новий чат"
    })
    .select("*")
    .single();

  if (error) throw error;

  chatObj.serverId = data.id;
  chatObj.id = `local-${data.id}`;

  if (state.activeChatId === oldId) {
    state.activeChatId = chatObj.id;
  }

  saveState();
  renderAll();

  return data.id;
}

async function replaceServerMessages(chatObj) {
  if (!currentUser || !chatObj) return;

  const serverId = await ensureServerChat(chatObj);

  await sb.from("messages").delete().eq("chat_id", serverId).eq("user_id", currentUser.id);

  const rows = chatObj.messages.map((m) => ({
    chat_id: serverId,
    user_id: currentUser.id,
    role: m.role,
    content: m.content || "",
    image_name: m.image?.name || null,
    image_type: m.image?.type || null,
    image_data_url: m.image?.dataUrl || null
  }));

  if (rows.length) {
    const { error } = await sb.from("messages").insert(rows);
    if (error) throw error;
  }

  const { error: chatUpdateError } = await sb
    .from("chats")
    .update({
      title: chatObj.title || "Новий чат",
      updated_at: new Date().toISOString()
    })
    .eq("id", serverId)
    .eq("user_id", currentUser.id);

  if (chatUpdateError) throw chatUpdateError;
}

async function syncActiveChat() {
  if (!currentUser) {
    alert("Спочатку увійди через Google");
    return;
  }

  const active = ensureChat();
  updateStatus("Синхронізація...");

  try {
    await ensureProfile(currentUser);
    await replaceServerMessages(active);
    updateStatus("Синхронізовано");
  } catch (e) {
    console.error(e);
    updateStatus("Помилка sync");
    alert("Sync error: " + (e.message || "невідома помилка"));
  }
}

async function loadServerChats() {
  if (!currentUser) {
    alert("Спочатку увійди через Google");
    return;
  }

  updateStatus("Завантаження...");

  try {
    const { data: chatsData, error: chatsError } = await sb
      .from("chats")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });

    if (chatsError) throw chatsError;

    const ids = (chatsData || []).map(c => c.id);
    let messagesData = [];

    if (ids.length) {
      const { data, error } = await sb
        .from("messages")
        .select("*")
        .in("chat_id", ids)
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      messagesData = data || [];
    }

    const grouped = new Map();
    for (const m of messagesData) {
      if (!grouped.has(m.chat_id)) grouped.set(m.chat_id, []);
      grouped.get(m.chat_id).push(m);
    }

    state.chats = (chatsData || []).map(row =>
      mapServerChat(row, grouped.get(row.id) || [])
    );

    if (!state.chats.length) {
      createLocalChat("Новий чат");
    } else {
      state.activeChatId = state.chats[0].id;
      saveState();
      renderAll();
    }

    updateStatus("Історія завантажена");
    closeMobileSidebar();
  } catch (e) {
    console.error(e);
    updateStatus("Помилка завантаження");
    alert("Load error: " + (e.message || "невідома помилка"));
  }
}

async function deleteChat(chatId) {
  const item = state.chats.find(c => c.id === chatId);
  if (!item) return;

  if (!confirm("Видалити цей чат?")) return;

  state.chats = state.chats.filter(c => c.id !== chatId);

  if (state.activeChatId === chatId) {
    state.activeChatId = state.chats[0]?.id || null;
  }

  saveState();
  renderAll();

  if (currentUser && item.serverId) {
    await sb.from("chats").delete().eq("id", item.serverId).eq("user_id", currentUser.id);
  }

  if (!state.chats.length) {
    createLocalChat("Новий чат");
  }
}

googleLoginBtn?.addEventListener("click", signInWithGoogle);
logoutBtn?.addEventListener("click", signOut);
syncBtn?.addEventListener("click", syncActiveChat);

newChatBtn?.addEventListener("click", () => {
  createLocalChat("Новий чат");
});

clearBtn?.addEventListener("click", () => {
  const active = ensureChat();
  active.messages = [];
  active.title = "Новий чат";
  active.updatedAt = Date.now();
  saveState();
  renderAll();
});

exportJsonBtn?.addEventListener("click", exportJson);
exportMdBtn?.addEventListener("click", exportMd);

fastModeBtn?.addEventListener("click", () => {
  state.mode = "fast";
  saveState();
  renderAll();
});

smartModeBtn?.addEventListener("click", () => {
  state.mode = "smart";
  saveState();
  renderAll();
});

imageBtn?.addEventListener("click", () => {
  imageInput?.click();
});

imageInput?.addEventListener("change", async () => {
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

removeImageBtn?.addEventListener("click", clearSelectedImage);

generateImageBtn?.addEventListener("click", () => {
  const prompt = promptInput?.value.trim();
  if (!prompt) {
    alert("Спочатку введи опис для генерації зображення.");
    return;
  }

  alert("Після чату підключимо і генерацію фото.");
});

stopBtn?.addEventListener("click", () => {
  if (currentController) currentController.abort();
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput?.value.trim();
  if (!text || requestInFlight) return;
  await sendChatMessage(text);
});

promptInput?.addEventListener("input", autoResize);

promptInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form?.requestSubmit();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".chat-menu-wrap")) {
    closeAllChatMenus();
  }
});

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  renderAuthState();

  if (currentUser) {
    await ensureProfile(currentUser);
  }
});

if (quickActionsSection && quickActionsToggleIcon) {
  quickActionsSection.classList.add("hidden");
  quickActionsToggleIcon.textContent = "+";
}

window.loadServerChats = loadServerChats;

renderAll();
autoResize();
updateSelectedImageUI();
updateStatus("Старт...");
initAuth();
