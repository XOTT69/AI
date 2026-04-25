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

const STORAGE_KEY = "nvidia-ai-chat-v4-ui";
let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

if (!state || !Array.isArray(state.chats) || !state.chats.length) {
  state = {
    activeChatId: null,
    chats: [],
    mode: "fast"
  };
}

if (!state.mode) {
  state.mode = "fast";
}

let currentController = null;
let requestInFlight = false;

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
  return marked.parse(text || "");
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
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1200);
      } catch {
        btn.textContent = "Error";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1200);
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

function renderUserMessage(content) {
  const el = document.createElement("div");
  el.className = "message user";
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function renderAssistantMessage(content) {
  const el = document.createElement("div");
  el.className = "message assistant";

  const inner = document.createElement("div");
  inner.className = "message-content";
  inner.innerHTML = renderMarkdown(content || "");

  el.appendChild(inner);
  chat.appendChild(el);
  enhanceCodeBlocks(el);
  chat.scrollTop = chat.scrollHeight;

  return el;
}

function setAssistantHTML(el, content, typing = false) {
  el.className = `message assistant${typing ? " typing" : ""}`;

  let inner = el.querySelector(".message-content");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "message-content";
    el.innerHTML = "";
    el.appendChild(inner);
  }

  inner.innerHTML = renderMarkdown(content || "");
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
    empty.textContent = "Почни новий чат. Режим “Швидко” дає коротші відповіді, “Розумно” — довші і сильніші.";
    chat.appendChild(empty);
    return;
  }

  for (const msg of active.messages) {
    if (msg.role === "assistant") {
      renderAssistantMessage(msg.content);
    } else {
      renderUserMessage(msg.content);
    }
  }
}

function renderAll() {
  renderChatList();
  renderMessages();
  applyModeButtons();
}

function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 220) + "px";
}

function trimMessages(messages, maxItems = 12) {
  return messages.slice(-maxItems);
}

function getModelTimeout(model) {
  if (model === "deepseek-ai/deepseek-v4-flash") return 90000;
  if (model === "mistralai/devstral-2-123b-instruct-2512") return 120000;
  if (model === "bytedance/seed-oss-36b-instruct") return 140000;
  if (model === "z-ai/glm5-1") return 140000;
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

async function* parseSSEStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";

      for (const message of messages) {
        const lines = message.split("\n");
        let dataLines = [];

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          dataLines.push(line.slice(5).trim());
        }

        const data = dataLines.join("");
        if (!data) continue;

        if (data === "[DONE]") {
          yield { type: "__done__" };
          continue;
        }

        try {
          yield JSON.parse(data);
        } catch {
        }
      }
    }

    if (buffer.trim()) {
      const lines = buffer.split("\n");
      let dataLines = [];

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        dataLines.push(line.slice(5).trim());
      }

      const data = dataLines.join("");
      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data);
        } catch {
        }
      }
    }
  } finally {
    reader.releaseLock();
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

  const assistantEl = document.createElement("div");
  assistantEl.className = "message assistant typing";

  const inner = document.createElement("div");
  inner.className = "message-content";
  inner.innerHTML = "<p>Думаю...</p>";
  assistantEl.appendChild(inner);

  chat.appendChild(assistantEl);
  chat.scrollTop = chat.scrollHeight;

  setBusy(true);

  let timeoutId = null;

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
        ...getModePayload()
      }),
      signal: currentController.signal
    });

    if (!response.ok || !response.body) {
      const raw = await response.text();
      throw new Error(raw || `HTTP ${response.status}`);
    }

    let finalText = "";
    let label = "";
    let finishReason = null;
    let gotAnyContent = false;

    for await (const event of parseSSEStream(response.body)) {
      if (event.type === "__done__") {
        assistantEl.classList.remove("typing");
        continue;
      }

      if (event.type === "meta" && event.label) {
        label = `[${event.label}]\n\n`;
        setAssistantHTML(assistantEl, label + finalText, true);
        continue;
      }

      if (event.type === "content") {
        gotAnyContent = true;
        finalText += event.content || "";
        setAssistantHTML(assistantEl, label + finalText, true);
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
      finalText += "\n\n_Відповідь обрізана через ліміт довжини. Напиши: `продовжуй`._";
      setAssistantHTML(assistantEl, label + finalText, false);
    }

    if (!gotAnyContent || !finalText.trim()) {
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
      setAssistantHTML(assistantEl, "Зупинено.");
    } else {
      setAssistantHTML(assistantEl, "Помилка: " + (error.message || "невідома помилка"));
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    setBusy(false);
    currentController = null;
  }
});

ensureChat();
renderAll();
autoResize();
