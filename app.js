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
  assistantEl.classList.add("typing");

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

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Помилка запиту");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      assistantEl.textContent = fullText;
      chat.scrollTop = chat.scrollHeight;
    }

    assistantEl.classList.remove("typing");

    messages.push({ role: "assistant", content: fullText || "Порожня відповідь." });
    saveMessages();
  } catch (error) {
    assistantEl.classList.remove("typing");
    assistantEl.textContent = "Помилка: " + error.message;
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "Надіслати";
  }
});

renderHistory();
autoResize();
