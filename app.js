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

const STORAGE_KEY = "nvidia-ai-chat-v3-stream";
let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

if (!state || !Array.isArray(state.chats) || !state.chats.length) {
  state = {
    activeChatId: null,
    chats: []
  };
}

let currentController = null;
let requestInFlight = false;

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultTitle(text = "Новий чат") {
  return text.trim().slice(0, 36) || "Новий чат";
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
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
    chatObj.title = defaultTitle(firstUser.content);
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

function renderMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function renderMessages() {
  const active = ensureChat();
  chat.innerHTML = "";
  chatTitle.textContent = active.title || "Новий чат";

  if (!active.messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Почни новий чат. Для швидкості краще використовувати DeepSeek V4 Flash без Thinking.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    renderMessage(msg.role === "assistant" ? "assistant" : "user", msg.content);
  }
}

function renderAll() {
  renderChatList();
  renderMessages();
}

function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 220) + "px";
}

function trimMessages(messages, maxItems = 10) {
  return messages.slice(-maxItems);
}

function getModelTimeout(model) {
  if (model === "deepseek-ai/deepseek-v4-flash") return 60000;
  if (model === "mistralai/devstral-2-123b-instruct-2512") return 90000;
  if (model === "bytedance/seed-oss-36b-instruct") return 120000;
  if (model === "z-ai/glm4-7") return 120000;
  if (model === "mistralai/mistral-large-3-675b-instruct-2512") return 180000;
  if (model === "deepseek-ai/deepseek-v4-pro") return 180000;
  if (model === "deepseek-ai/deepseek-v3-2") return 180000;
  return 120000;
}

function setBusy(isBusy) {
  requestInFlight = isBusy;
  sendBtn.disabled = isBusy;
  stopBtn.disabled = !isBusy;
  sendBtn.textContent = isBusy ? "Генерується..." : "Надіслати";
}

newChatBtn.addEventListener("click", () => {
  if (requestInFlight) return;
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
  if (currentController) {
    currentController.abort();
  }
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
  if (requestInFlight) return;

  const text = promptInput.value.trim();
  if (!text) return;

  const active = ensureChat();
  const userMessage = { role: "user", content: text };

  active.messages.push(userMessage);
  updateChatTitle(active);
  active.updatedAt = Date.now();
  saveState();
  renderAll();

  promptInput.value = "";
  autoResize();

  const assistantEl = renderMessage("assistant", "");
  assistantEl.classList.add("typing");
  setBusy(true);

  try {
    currentController = new AbortController();
    const timeoutId = setTimeout(() => currentController.abort(), getModelTimeout(modelSelect.value));

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelSelect.value,
        thinking: thinkingCheckbox.checked,
        messages: trimMessages(active.messages, 10),
        stream: true
      }),
      signal: currentController.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok || !response.body) {
      const raw = await response.text();
      throw new Error(raw || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalText = "";
    let label = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();

        if (data === "[DONE]") {
          assistantEl.classList.remove("typing");
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed.type === "meta" && parsed.label) {
          label = `[${parsed.label}]\n\n`;
          assistantEl.textContent = label + finalText;
          continue;
        }

        if (parsed.type === "content" && parsed.content) {
          finalText += parsed.content;
          assistantEl.textContent = label + finalText;
          chat.scrollTop = chat.scrollHeight;
        }

        if (parsed.type === "error") {
          throw new Error(parsed.message || "Streaming error");
        }
      }
    }

    assistantEl.classList.remove("typing");

    if (!finalText.trim()) {
      throw new Error("Модель повернула порожню відповідь");
    }

    const stored = label + finalText;
    active.messages.push({ role: "assistant", content: stored });
    active.updatedAt = Date.now();
    saveState();
    renderAll();
  } catch (error) {
    assistantEl.classList.remove("typing");
    if (error.name === "AbortError") {
      assistantEl.textContent = "Зупинено.";
    } else {
      assistantEl.textContent = "Помилка: " + (error.message || "невідома помилка");
    }
  } finally {
    setBusy(false);
    currentController = null;
  }
});

ensureChat();
renderAll();
autoResize();
