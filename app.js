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

document.title = "AI Chat BY Антон";

const STORAGE_KEY = "ai-chat-by-anton-v3";
let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

if (!state || !Array.isArray(state.chats) || !state.chats.length) {
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

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

function buildTitleFromText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Новий чат";
  if (clean.length <= 42) return clean;
  return clean.slice(0, 42) + "...";
}

function createChat(initialTitle = "Новий чат") {
  const chatObj = {
    id: uid(),
    title: initialTitle,
    createdAt: Date.now(),
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
  let active = getActiveChat();
  if (!active) active = createChat("Новий чат");
  return active;
}

function updateChatTitle(chatObj) {
  const firstUser = chatObj.messages.find(m => m.role === "user");
  if (firstUser) {
    chatObj.title = buildTitleFromText(firstUser.content);
  }
}

function deleteChat(chatId) {
  state.chats = state.chats.filter(c => c.id !== chatId);

  if (state.activeChatId === chatId) {
    state.activeChatId = state.chats[0]?.id || null;
  }

  if (!state.chats.length) {
    createChat("Новий чат");
    return;
  }

  saveState();
  renderAll();
}

function switchChat(chatId) {
  if (requestInFlight) return;
  state.activeChatId = chatId;
  saveState();
  renderAll();
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
      hljs.highlightElement(block);
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

function updateStatus(text) {
  statusText.textContent = text;
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
    openBtn.textContent = "Відкрити";
    openBtn.onclick = (e) => {
      e.stopPropagation();
      switchChat(item.id);
    };

    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost-btn small-btn danger-btn";
    removeBtn.textContent = "Видалити";
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm("Видалити цей чат?")) {
        deleteChat(item.id);
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
  const merged = `${labelText || ""}${contentText || ""}`;
  inner.innerHTML = renderMarkdown(merged);
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
    empty.textContent = "AI Chat BY Антон готовий. Додано фото, генерацію зображень, експорт і кращий стрімінг.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    if (msg.role === "assistant") {
      renderAssistantMessage(msg);
    } else {
      renderUserMessage(msg);
    }
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

function trimMessages(messages, maxItems = 12) {
  return messages.slice(-maxItems);
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
          yield parsed;
        } catch {}
      }
    }

    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const data = tail.slice(5).trim();
      if (data === "[DONE]") {
        yield { type: "__done__" };
      } else {
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
  downloadFile(
    `${active.title || "chat"}.json`,
    JSON.stringify(active, null, 2),
    "application/json"
  );
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

  downloadFile(
    `${active.title || "chat"}.md`,
    lines.join("\n"),
    "text/markdown;charset=utf-8"
  );
}

function appendAssistantMessageToState(content, extra = {}) {
  const active = ensureChat();
  active.messages.push({
    role: "assistant",
    content,
    ...extra
  });
  active.updatedAt = Date.now();
  saveState();
  renderAll();
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
        messages: trimMessages(active.messages, 12),
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

      if (event.type === "reasoning") continue;

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
    appendAssistantMessageToState(`${labelText}${contentText}`);
    clearSelectedImage();
  } catch (error) {
    assistantEl.classList.remove("typing");
    const msg = String(error?.message || "").toLowerCase();

    if (error.name === "AbortError") {
      if (contentText.trim()) {
        contentText += "\n\n_Зупинено._";
        finalizeAssistantMarkdown(assistantEl, labelText, contentText, false);
        appendAssistantMessageToState(`${labelText}${contentText}`);
      } else {
        assistantEl.querySelector(".message-content").textContent = "Зупинено.";
      }
    } else if (msg.includes("terminated") || msg.includes("stream")) {
      if (contentText.trim()) {
        contentText += "\n\n_Потік обірвався. Напиши: `продовжуй`._";
        finalizeAssistantMarkdown(assistantEl, labelText, contentText, false);
        appendAssistantMessageToState(`${labelText}${contentText}`);
      } else {
        assistantEl.querySelector(".message-content").textContent =
          "Потік відповіді обірвався. Спробуй ще раз.";
      }
    } else {
      assistantEl.querySelector(".message-content").textContent =
        "Помилка: " + (error.message || "невідома помилка");
    }
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.details || data?.error || `HTTP ${response.status}`);
    }

    const imageUrl = data?.url;
    if (!imageUrl) {
      throw new Error("Сервер не повернув URL зображення");
    }

    assistantEl.classList.remove("typing");
    assistantEl.querySelector(".message-content").innerHTML = renderMarkdown("Ось згенероване зображення:");

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

    appendAssistantMessageToState("Ось згенероване зображення:", {
      kind: "image",
      imageUrl
    });
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
  createChat("Новий чат");
});

clearBtn.addEventListener("click", () => {
  if (requestInFlight) return;
  const active = ensureChat();
  active.messages = [];
  active.title = "Новий чат";
  active.updatedAt = Date.now();
  saveState();
  renderAll();
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

    updateSelectedImageUI();
  } catch (error) {
    alert(error.message || "Не вдалося прочитати фото");
    clearSelectedImage();
  }
});

removeImageBtn.addEventListener("click", clearSelectedImage);

generateImageBtn.addEventListener("click", async () => {
  if (requestInFlight) return;

  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert("Спочатку введи опис для генерації зображення.");
    return;
  }

  await generateImageFromPrompt(prompt);
});

exportJsonBtn.addEventListener("click", exportActiveChatJson);
exportMdBtn.addEventListener("click", exportActiveChatMd);

promptInput.addEventListener("input", autoResize);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (requestInFlight) return;

  const text = promptInput.value.trim();
  if (!text) return;

  await sendChatMessage(text);
});

ensureChat();
renderAll();
autoResize();
updateSelectedImageUI();
updateStatus("Готово");
