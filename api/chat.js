const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const promptInput = document.getElementById("prompt");
const modelSelect = document.getElementById("model");
const thinkingCheckbox = document.getElementById("thinking");
const clearBtn = document.getElementById("clearBtn");
const sendBtn = document.getElementById("sendBtn");

const STORAGE_KEY = "nvidia-ai-chat-history";

let messages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

function saveMessages() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function renderMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function renderHistory() {
  chat.innerHTML = "";
  if (!messages.length) {
    renderMessage("system", "Готово до чату. Напиши перше повідомлення.");
    return;
  }
  for (const msg of messages) {
    renderMessage(msg.role === "assistant" ? "assistant" : "user", msg.content);
  }
}

function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 220) + "px";
}

promptInput.addEventListener("input", autoResize);

clearBtn.addEventListener("click", () => {
  messages = [];
  saveMessages();
  renderHistory();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = promptInput.value.trim();
  if (!text) return;

  const userMessage = { role: "user", content: text };
  messages.push(userMessage);
  saveMessages();
  renderHistory();

  promptInput.value = "";
  autoResize();
  sendBtn.disabled = true;
  sendBtn.textContent = "Генерується...";

  const assistantEl = renderMessage("assistant", "");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelSelect.value,
        thinking: thinkingCheckbox.checked,
        messages
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(raw || "Помилка запиту");
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("Сервер повернув не JSON: " + raw);
    }

    const answer = data.content || "Порожня відповідь.";
    assistantEl.textContent = answer;

    messages.push({ role: "assistant", content: answer });
    saveMessages();
  } catch (error) {
    assistantEl.textContent = "Помилка: " + error.message;
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "Надіслати";
  }
});

renderHistory();
autoResize();
