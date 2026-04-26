const SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Supabase config missing in config.js");
}

const supabaseLib = window.supabase || window.supabaseJs || null;

if (!supabaseLib || typeof supabaseLib.createClient !== "function") {
  throw new Error("Supabase CDN not loaded correctly");
}

const supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

document.title = "AI Chat BY Антон";

const STORAGE_KEY = "ai-chat-by-anton-v2-supabase";
let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

if (!state || !Array.isArray(state.chats)) {
  state = {
    activeChatId: null,
    chats: [],
    mode: "fast"
  };
}

if (!state.mode) state.mode = "fast";

let currentController = null;
let requestInFlight = false;
let selectedImage = null;
let currentUser = null;

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
  statusText.textContent = text;
}

function getURL() {
  let url = window.location.origin || "http://localhost:3000";
  return url.endsWith("/") ? url : `${url}/`;
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

function buildTitleFromText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Новий чат";
  if (clean.length <= 42) return clean;
  return clean.slice(0, 42) + "...";
}

function createLocalChat(initialTitle = "Новий чат", forcedId = null) {
  const chatObj = {
    id: forcedId || uid(),
    title: initialTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    serverId: null
  };

  state.chats.unshift(chatObj);
  state.activeChatId = chatObj.id;
  saveState();
  renderAll();
  return chatObj;
}

function ensureChat() {
  let active = getActiveChat();
  if (!active) active = createLocalChat("Новий чат");
  return active;
}

function updateChatTitle(chatObj) {
  const firstUser = chatObj.messages.find(m => m.role === "user");
  if (firstUser) {
    chatObj.title = buildTitleFromText(firstUser.content);
  }
}

function switchChat(chatId) {
  if (requestInFlight) return;
  state.activeChatId = chatId;
  saveState();
  renderAll();
}

async function deleteLocalAndServerChat(chatId) {
  const item = state.chats.find(c => c.id === chatId);
  state.chats = state.chats.filter(c => c.id !== chatId);

  if (state.activeChatId === chatId) {
    state.activeChatId = state.chats[0]?.id || null;
  }

  saveState();
  renderAll();

  if (currentUser && item?.serverId) {
    await supabase
      .from("chats")
      .delete()
      .eq("id", item.serverId)
      .eq("user_id", currentUser.id);
  }

  if (!state.chats.length) {
    createLocalChat("Новий чат");
  }
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderMarkdown(text) {
  const raw = marked.parse(text || "");
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true }
  });
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre code").forEach((block) => {
    if (!block.dataset.hljsDone) {
      try {
        hljs.highlightElement(block);
      } catch {}
      block.dataset.hljsDone = "1";
    }

    const pre = block.parentElement;
    if (!pre || pre.querySelector(".copy-btn")) return;

    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";

    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block.innerText);
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy", 1200);
      } catch {
        btn.textContent = "Error";
        setTimeout(() => btn.textContent = "Copy", 1200);
      }
    });

    pre.appendChild(btn);
  });
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
    meta.textContent = `${item.messages.length} повідомл. • ${formatDate(item.updatedAt)}`;

    const actions = document.createElement("div");
    actions.className = "chat-item-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "ghost-btn small-btn";
    openBtn.type = "button";
    openBtn.textContent = "Відкрити";
    openBtn.onclick = (e) => {
      e.stopPropagation();
      switchChat(item.id);
    };

    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost-btn small-btn danger-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "Видалити";
    removeBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm("Видалити цей чат?")) {
        await deleteLocalAndServerChat(item.id);
      }
    };

    actions.append(openBtn, removeBtn);
    div.append(title, meta, actions);
    div.onclick = () => switchChat(item.id);
    chatList.appendChild(div);
  }
}

function createMessageShell(role, extraClass = "") {
  const el = document.createElement("div");
  el.className = `message ${role}${extraClass ? ` ${extraClass}` : ""}`;
  const inner = document.createElement("div");
  inner.className = "message-content";
  el.appendChild(inner);
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function renderUserMessage(message) {
  const el = createMessageShell("user");
  const inner = el.querySelector(".message-content");
  inner.textContent = message.content || "";

  if (message.image?.dataUrl) {
    const img = document.createElement("img");
    img.src = message.image.dataUrl;
    img.alt = "uploaded image";
    img.className = "inline-preview-image";
    inner.appendChild(img);
  }

  return el;
}

function renderAssistantMessage(message) {
  const extraClass = message.kind === "image" ? "image-message" : "";
  const el = createMessageShell("assistant", extraClass);
  const inner = el.querySelector(".message-content");
  inner.innerHTML = renderMarkdown(message.content || "");

  if (message.kind === "image" && message.imageUrl) {
    const wrap = document.createElement("div");
    wrap.className = "generated-image-wrap";

    const img = document.createElement("img");
    img.src = message.imageUrl;
    img.alt = "generated image";
    img.className = "generated-image";

    const actions = document.createElement("div");
    actions.className = "generated-image-actions";

    const openBtn = document.createElement("a");
    openBtn.href = message.imageUrl;
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    openBtn.className = "ghost-btn small-btn";
    openBtn.textContent = "Відкрити";

    const downloadBtn = document.createElement("a");
    downloadBtn.href = message.imageUrl;
    downloadBtn.download = "generated-image.png";
    downloadBtn.className = "primary-btn small-btn";
    downloadBtn.textContent = "Завантажити";

    actions.append(openBtn, downloadBtn);
    wrap.append(img, actions);
    inner.appendChild(wrap);
  }

  enhanceCodeBlocks(el);
  return el;
}

function setAssistantStreamingText(el, labelText, contentText, typing = false) {
  el.className = `message assistant${typing ? " typing" : ""}`;
  const inner = el.querySelector(".message-content");
  inner.textContent = `${labelText || ""}${contentText || ""}`;
  chat.scrollTop = chat.scrollHeight;
}

function finalizeAssistantMarkdown(el, labelText, contentText, typing = false) {
  el.className = `message assistant${typing ? " typing" : ""}`;
  const inner = el.querySelector(".message-content");
  inner.innerHTML = renderMarkdown(`${labelText || ""}${contentText || ""}`);
  enhanceCodeBlocks(el);
  chat.scrollTop = chat.scrollHeight;
}

function renderMessages() {
  const active = ensureChat();
  chat.innerHTML = "";
  chatTitle.textContent = active.title || "Новий чат";

  if (!active.messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = currentUser
      ? "Ти увійшов через Google. Історія синхронізується через Supabase."
      : "Увійди через Google, щоб історія зберігалась на сервері і синхронізувалась між пристроями.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    if (msg.role === "assistant") renderAssistantMessage(msg);
    else renderUserMessage(msg);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderChatList();
  renderMessages();
  applyModeButtons();
}

function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 240) + "px";
}

function trimMessages(messages, maxItems = 10) {
  return messages.slice(-maxItems).map((m) => ({
    role: m.role,
    content: m.content
  }));
}

function getModelTimeout(model) {
  if (model === "deepseek-ai/deepseek-v4-flash") return 90000;
  if (model === "z-ai/glm5.1") return 180000;
  if (model === "meta/llama-3.2-11b-vision-instruct") return 180000;
  if (model === "deepseek-ai/deepseek-v4-pro") return 180000;
  return 120000;
}

function setBusy(isBusy, status = "Готово") {
  requestInFlight = isBusy;
  sendBtn.disabled = isBusy;
  stopBtn.disabled = !isBusy;
  generateImageBtn.disabled = isBusy;
  imageBtn.disabled = isBusy;
  sendBtn.textContent = isBusy ? "Генерується..." : "Надіслати";
  updateStatus(status);
}

function applyModeButtons() {
  const mode = state.mode || "fast";
  fastModeBtn.classList.toggle("active", mode === "fast");
  smartModeBtn.classList.toggle("active", mode === "smart");
}

function getModePayload() {
  return {
    responseMode: state.mode === "smart" ? "smart" : "fast"
  };
}

function updateSelectedImageUI() {
  if (!selectedImage?.dataUrl) {
    selectedImageBar.classList.add("hidden");
    selectedImageName.textContent = "Фото не вибрано";
    selectedImageHint.textContent = "Фото буде відправлено разом із наступним повідомленням.";
    selectedImagePreview.removeAttribute("src");
    return;
  }

  selectedImageBar.classList.remove("hidden");
  selectedImageName.textContent = selectedImage.name || "selected-image";
  selectedImageHint.textContent = "Фото буде проаналізовано або враховано в наступному повідомленні.";
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

function getSuggestedPromptForImage(fileName = "") {
  const name = String(fileName).toLowerCase();
  if (
    name.includes("passport") ||
    name.includes("паспорт") ||
    name.includes("doc") ||
    name.includes("document") ||
    name.includes("id")
  ) {
    return "Зроби OCR цього документа. Перепиши весь видимий текст без вигадок і потім витягни основні поля.";
  }
  return "Опиши, що на цьому зображенні. Якщо є текст — перепиши лише чітко видимий текст без вигадок.";
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
          yield JSON.parse(data);
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportActiveChatJson() {
  const active = ensureChat();
  downloadFile(`${active.title || "chat"}.json`, JSON.stringify(active, null, 2), "application/json");
}

function exportActiveChatMd() {
  const active = ensureChat();
  const lines = [`# ${active.title || "Новий чат"}`, ""];

  for (const msg of active.messages) {
    lines.push(`## ${msg.role === "user" ? "Користувач" : "Асистент"}`);
    lines.push("");
    lines.push(msg.content || "");
    lines.push("");

    if (msg.image?.dataUrl) {
      lines.push("_Повідомлення містить прикріплене фото._");
      lines.push("");
    }

    if (msg.kind === "image" && msg.imageUrl) {
      lines.push(`![generated image](${msg.imageUrl})`);
      lines.push("");
    }
  }

  downloadFile(`${active.title || "chat"}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
}

async function ensureProfile(user) {
  if (!user) return;
  const meta = user.user_metadata || {};

  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email || null,
    full_name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || meta.picture || null,
    provider: user.app_metadata?.provider || "google",
    updated_at: new Date().toISOString()
  });
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
      kind: m.kind || "text",
      imageUrl: m.image_url || null,
      image: m.image_data_url ? {
        name: m.image_name || "image",
        type: m.image_type || "image/png",
        dataUrl: m.image_data_url
      } : null,
      createdAt: new Date(m.created_at).getTime()
    }))
  };
}

async function loadServerChats() {
  if (!currentUser) return;

  updateStatus("Завантаження історії");

  const { data: chatsData, error: chatsError } = await supabase
    .from("chats")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("updated_at", { ascending: false });

  if (chatsError) {
    console.error(chatsError);
    updateStatus("Помилка sync");
    return;
  }

  const chatIds = (chatsData || []).map(c => c.id);
  let messagesData = [];

  if (chatIds.length) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .in("chat_id", chatIds)
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      updateStatus("Помилка sync");
      return;
    }

    messagesData = data || [];
  }

  const grouped = new Map();
  for (const msg of messagesData) {
    if (!grouped.has(msg.chat_id)) grouped.set(msg.chat_id, []);
    grouped.get(msg.chat_id).push(msg);
  }

  state.chats = (chatsData || []).map(chatRow =>
    mapServerChat(chatRow, grouped.get(chatRow.id) || [])
  );

  if (!state.chats.length) {
    createLocalChat("Новий чат");
  } else {
    state.activeChatId = state.chats[0].id;
    saveState();
    renderAll();
  }

  updateStatus("Готово");
}

async function ensureServerChat(chatObj) {
  if (!currentUser) return null;
  if (chatObj.serverId) return chatObj.serverId;

  const oldId = chatObj.id;

  const { data, error } = await supabase
    .from("chats")
    .insert({
      user_id: currentUser.id,
      title: chatObj.title || "Новий чат"
    })
    .select("*")
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  chatObj.serverId = data.id;
  chatObj.id = `local-${data.id}`;

  if (state.activeChatId === oldId) {
    state.activeChatId = chatObj.id;
  }

  saveState();
  renderAll();
  return data.id;
}

async function appendMessageToServer(chatObj, message) {
  if (!currentUser || !chatObj) return;

  const serverId = await ensureServerChat(chatObj);
  if (!serverId) return;

  await supabase.from("messages").insert({
    chat_id: serverId,
    user_id: currentUser.id,
    role: message.role,
    content: message.content || "",
    kind: message.kind || "text",
    image_url: message.imageUrl || null,
    image_name: message.image?.name || null,
    image_type: message.image?.type || null,
    image_data_url: message.image?.dataUrl || null
  });

  await supabase
    .from("chats")
    .update({
      title: chatObj.title || "Новий чат",
      updated_at: new Date().toISOString()
    })
    .eq("id", serverId)
    .eq("user_id", currentUser.id);
}

async function signInWithGoogle() {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getURL()
    }
  });
}

async function signOut() {
  await supabase.auth.signOut();
  currentUser = null;
  renderAuthState();
  updateStatus("Вийшов");
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

async function initAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error(error);

  currentUser = data?.session?.user || null;
  renderAuthState();

  if (currentUser) {
    await ensureProfile(currentUser);
    await loadServerChats();
  }
}

async function sendChatMessage(text) {
  const active = ensureChat();

  const userMessage = {
    role: "user",
    content: text
  };

  if (selectedImage?.dataUrl) {
    userMessage.image = {
      name: selectedImage.name,
      type: selectedImage.type,
      dataUrl: selectedImage.dataUrl
    };
  }

  active.messages.push(userMessage);
  updateChatTitle(active);
  active.updatedAt = Date.now();
  saveState();
  renderAll();

  if (currentUser) {
    try {
      await appendMessageToServer(active, userMessage);
    } catch (e) {
      console.error(e);
    }
  }

  promptInput.value = "";
  autoResize();

  const assistantEl = createMessageShell("assistant");
  assistantEl.classList.add("typing");
  assistantEl.querySelector(".message-content").textContent = "Думаю...";

  setBusy(true, "Генерується відповідь");

  let timeoutId = null;
  let contentText = "";
  let labelText = "";
  let finishReason = null;
  let gotAnyContent = false;

  try {
    currentController = new AbortController();
    timeoutId = setTimeout(() => {
      if (currentController) currentController.abort();
    }, getModelTimeout(modelSelect.value));

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelSelect.value,
        thinking: thinkingCheckbox.checked,
        messages: trimMessages(active.messages, 10),
        stream: true,
        image: selectedImage?.dataUrl ? {
          dataUrl: selectedImage.dataUrl,
          name: selectedImage.name,
          type: selectedImage.type
        } : null,
        ...getModePayload()
      }),
      signal: currentController.signal
    });

    if (!response.ok || !response.body) {
      const raw = await response.text();
      throw new Error(raw || `HTTP ${response.status}`);
    }

    for await (const event of parseSSEStream(response.body)) {
      if (event.type === "__done__" || event.type === "done") {
        assistantEl.classList.remove("typing");
        continue;
      }

      if (event.type === "meta" && event.label) {
        labelText = `[${event.label}]\n\n`;
        setAssistantStreamingText(assistantEl, labelText, contentText, true);
        continue;
      }

      if (event.type === "content") {
        gotAnyContent = true;
        contentText += event.content || "";
        setAssistantStreamingText(assistantEl, labelText, contentText, true);
        continue;
      }

      if (event.type === "finish") {
        finishReason = event.finish_reason || null;
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.message || "Streaming error");
      }
    }

    assistantEl.classList.remove("typing");

    if (finishReason === "length") {
      contentText += "\n\n_Відповідь обрізана через ліміт довжини. Напиши: `продовжуй`._";
    }

    if (!gotAnyContent || !contentText.trim()) {
      throw new Error("Модель повернула порожню відповідь");
    }

    finalizeAssistantMarkdown(assistantEl, labelText, contentText, false);

    const assistantMessage = {
      role: "assistant",
      content: `${labelText}${contentText}`
    };

    active.messages.push(assistantMessage);
    active.updatedAt = Date.now();
    saveState();
    renderAll();

    if (currentUser) {
      try {
        await appendMessageToServer(active, assistantMessage);
      } catch (e) {
        console.error(e);
      }
    }

    clearSelectedImage();
  } catch (error) {
    assistantEl.classList.remove("typing");
    assistantEl.querySelector(".message-content").textContent =
      "Помилка: " + (error.message || "невідома помилка");
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    setBusy(false, "Готово");
    currentController = null;
  }
}

async function generateImageFromPrompt(prompt) {
  const active = ensureChat();

  const userMessage = {
    role: "user",
    content: `[ГЕНЕРАЦІЯ ЗОБРАЖЕННЯ]\n${prompt}`
  };

  active.messages.push(userMessage);
  updateChatTitle(active);
  active.updatedAt = Date.now();
  saveState();
  renderAll();

  if (currentUser) {
    try {
      await appendMessageToServer(active, userMessage);
    } catch (e) {
      console.error(e);
    }
  }

  promptInput.value = "";
  autoResize();

  const assistantEl = createMessageShell("assistant", "image-message");
  assistantEl.classList.add("typing");
  assistantEl.querySelector(".message-content").textContent = "Генерую зображення...";

  setBusy(true, "Генерується зображення");

  try {
    currentController = new AbortController();

    const response = await fetch("/api/image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt }),
      signal: currentController.signal
    });

    const raw = await response.text();
    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { details: raw };
    }

    if (!response.ok) {
      throw new Error(data?.details || data?.error || `HTTP ${response.status}`);
    }

    const imageUrl = data?.url;
    if (!imageUrl) {
      throw new Error("Сервер не повернув URL зображення");
    }

    assistantEl.classList.remove("typing");
    assistantEl.querySelector(".message-content").innerHTML =
      renderMarkdown(`Ось згенероване зображення.\n\nМодель: \`${data?.model || "unknown"}\``);

    const wrap = document.createElement("div");
    wrap.className = "generated-image-wrap";

    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "generated image";
    img.className = "generated-image";

    const actions = document.createElement("div");
    actions.className = "generated-image-actions";

    const openBtn = document.createElement("a");
    openBtn.href = imageUrl;
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    openBtn.className = "ghost-btn small-btn";
    openBtn.textContent = "Відкрити";

    const downloadBtn = document.createElement("a");
    downloadBtn.href = imageUrl;
    downloadBtn.download = "generated-image.png";
    downloadBtn.className = "primary-btn small-btn";
    downloadBtn.textContent = "Завантажити";

    actions.append(openBtn, downloadBtn);
    wrap.append(img, actions);
    assistantEl.querySelector(".message-content").appendChild(wrap);

    const assistantMessage = {
      role: "assistant",
      content: `Ось згенероване зображення.\n\nМодель: \`${data?.model || "unknown"}\``,
      kind: "image",
      imageUrl
    };

    active.messages.push(assistantMessage);
    active.updatedAt = Date.now();
    saveState();
    renderAll();

    if (currentUser) {
      try {
        await appendMessageToServer(active, assistantMessage);
      } catch (e) {
        console.error(e);
      }
    }
  } catch (error) {
    assistantEl.classList.remove("typing");
    assistantEl.querySelector(".message-content").textContent =
      "Помилка генерації зображення: " + (error.message || "невідома помилка");
  } finally {
    setBusy(false, "Готово");
    currentController = null;
  }
}

fastModeBtn.addEventListener("click", () => {
  state.mode = "fast";
  saveState();
  applyModeButtons();
});

smartModeBtn.addEventListener("click", () => {
  state.mode = "smart";
  saveState();
  applyModeButtons();
});

newChatBtn.addEventListener("click", () => {
  if (requestInFlight) return;
  clearSelectedImage();
  createLocalChat("Новий чат");
});

clearBtn.addEventListener("click", async () => {
  if (requestInFlight) return;
  const active = ensureChat();
  active.messages = [];
  active.title = "Новий чат";
  active.updatedAt = Date.now();
  saveState();
  renderAll();

  if (currentUser && active.serverId) {
    await supabase.from("messages").delete().eq("chat_id", active.serverId).eq("user_id", currentUser.id);
    await supabase
      .from("chats")
      .update({
        title: "Новий чат",
        updated_at: new Date().toISOString()
      })
      .eq("id", active.serverId)
      .eq("user_id", currentUser.id);
  }
});

stopBtn.addEventListener("click", () => {
  if (currentController) currentController.abort();
});

imageBtn.addEventListener("click", () => {
  if (requestInFlight) return;
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

    if (modelSelect.value !== "meta/llama-3.2-11b-vision-instruct") {
      modelSelect.value = "meta/llama-3.2-11b-vision-instruct";
    }

    if (!promptInput.value.trim()) {
      promptInput.value = getSuggestedPromptForImage(file.name);
      autoResize();
    }

    updateSelectedImageUI();
  } catch (error) {
    alert(error.message || "Не вдалося прочитати фото");
    clearSelectedImage();
  }
});

removeImageBtn.addEventListener("click", clearSelectedImage);
exportJsonBtn.addEventListener("click", exportActiveChatJson);
exportMdBtn.addEventListener("click", exportActiveChatMd);
googleLoginBtn.addEventListener("click", signInWithGoogle);
logoutBtn.addEventListener("click", signOut);
syncBtn.addEventListener("click", loadServerChats);

generateImageBtn.addEventListener("click", async () => {
  if (requestInFlight) return;
  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert("Спочатку введи опис для генерації зображення.");
    return;
  }
  await generateImageFromPrompt(prompt);
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
  if (!text || requestInFlight) return;
  await sendChatMessage(text);
});

supabase.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user || null;
  renderAuthState();

  if (event === "SIGNED_IN" && currentUser) {
    await ensureProfile(currentUser);
    await loadServerChats();
  }

  if (event === "SIGNED_OUT") {
    updateStatus("Вийшов");
  }
});

renderAll();
autoResize();
updateSelectedImageUI();
updateStatus("Готово");
initAuth();
