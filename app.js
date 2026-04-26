alert("app.js стартував");

document.addEventListener("DOMContentLoaded", () => {
  alert("DOM готовий");

  const sendBtn = document.getElementById("sendBtn");
  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const newChatBtn = document.getElementById("newChatBtn");
  const promptInput = document.getElementById("prompt");
  const chat = document.getElementById("chat");

  if (newChatBtn) {
    newChatBtn.onclick = () => {
      alert("Кнопка Новий чат працює");
    };
  }

  if (googleLoginBtn) {
    googleLoginBtn.onclick = () => {
      alert("Кнопка Google працює");
    };
  }

  if (sendBtn) {
    sendBtn.onclick = (e) => {
      e.preventDefault();

      const text = promptInput?.value?.trim() || "";

      const div = document.createElement("div");
      div.style.color = "white";
      div.style.padding = "12px";
      div.style.margin = "12px";
      div.style.border = "1px solid rgba(255,255,255,0.15)";
      div.style.borderRadius = "12px";
      div.textContent = text || "Порожній текст";

      chat.appendChild(div);

      alert("Кнопка Надіслати працює");
    };
  }
});
