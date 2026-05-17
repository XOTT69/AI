/* AI Chat — app.js v20 */

// ─── DOM refs ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const chat        = $('chat');
const chatEmpty   = $('chatEmpty');
const form        = $('chatForm');
const promptInput = $('prompt');
const modelSelect = $('model');
const chatList    = $('chatList');
const sendBtn     = $('sendBtn');
const stopBtn     = $('stopBtn');
const clearBtn    = $('clearBtn');
const newChatBtn  = $('newChatBtn');
const imageBtn    = $('imageBtn');
const imageInput  = $('imageInput');
const imgBar      = $('selectedImageBar');
const imgPreview  = $('selectedImagePreview');
const imgName     = $('selectedImageName');
const removeImgBtn= $('removeImageBtn');
const statusDot   = $('statusDot');
const statusText  = $('statusText');
const themeBtn    = $('themeToggleBtn');
const sidebar     = $('sidebar');
const overlay     = $('overlay');
const hamburger   = $('hamburgerBtn');
const googleLoginBtn = $('googleLoginBtn');
const logoutBtn   = $('logoutBtn');
const authOut     = $('authLoggedOut');
const authIn      = $('authLoggedIn');
const userAvatar  = $('userAvatar');
const userName    = $('userName');
const userEmail   = $('userEmail');

// ─── Supabase ────────────────────────────────────────────────────────
const SUPA_URL = 'https://dfvlipfcblnnuxylhzis.supabase.co';
const SUPA_KEY = 'sb_publishable_5tH2xD71Au-mLXJNBTrqIg_dCsSJyuF';
const sb = window.supabase ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;

// ─── Model config ────────────────────────────────────────────────────
const MODELS = {
  'groq/llama-3.3-70b-versatile':       { system: 'Ти швидкий і точний AI-помічник. Відповідай українською, якщо не попросять іншого.', tokens: 8192,  vision: false },
  'groq/llama-3.1-8b-instant':           { system: 'Ти швидкий AI-помічник. Відповідай коротко і точно, українською.', tokens: 8192, vision: false },
  'groq/llama-3.2-11b-vision-preview':   { system: 'Ти мультимодальний AI-помічник. Відповідай українською.', tokens: 4096, vision: true },
  'gemini/gemini-2.5-flash':             { system: 'Ти мультимодальний AI-помічник Gemini. Відповідай українською.', tokens: 8192, vision: true },
  'gemini/gemini-2.5-pro':               { system: 'Ти потужний AI-помічник Gemini Pro. Відповідай українською.', tokens: 8192, vision: true },
  'cerebras/llama-3.3-70b':              { system: 'Ти надшвидкий AI-помічник. Відповідай українською.', tokens: 8192, vision: false },
  'cerebras/llama-3.1-8b':               { system: 'Ти швидкий AI-помічник. Відповідай українською.', tokens: 8192, vision: false },
  'mistral/mistral-large-latest':        { system: 'Ти потужний AI-помічник Mistral. Відповідай українською.', tokens: 8192, vision: false },
  'mistral/mistral-small-latest':        { system: 'Ти AI-помічник Mistral. Відповідай українською.', tokens: 8192, vision: false },
  'mistral/codestral-latest':            { system: 'Ти спеціаліст з програмування. Пишеш чистий, ефективний код з поясненнями. Відповідай українською.', tokens: 16384, vision: false },
  'github/gpt-4o':                       { system: 'Ти потужний AI-помічник GPT-4o. Відповідай українською.', tokens: 4096, vision: true },
  'github/o4-mini':                      { system: 'Ти розумний AI-помічник. Відповідай українською.', tokens: 4096, vision: false },
  'github/phi-4':                        { system: 'Ти AI-помічник Microsoft Phi-4. Відповідай українською.', tokens: 4096, vision: false },
  'nvidia/llama-3.3-70b-instruct':       { system: 'Ти потужний AI-помічник. Відповідай українською.', tokens: 4096, vision: false },
  'nvidia/llama-3.2-90b-vision':         { system: 'Ти AI-помічник для аналізу зображень. Відповідай українською.', tokens: 2048, vision: true },
  'nvidia/gemma-3-27b':                  { system: 'Ти мультимодальний AI-помічник Gemma. Відповідай українською.', tokens: 4096, vision: true },
  'openrouter/deepseek-r1':              { system: 'Ти аналітичний AI-помічник DeepSeek. Відповідай українською.', tokens: 8192, vision: false },
  'openrouter/qwen-2.5-72b':             { system: 'Ти потужний AI-помічник. Відповідай українською.', tokens: 8192, vision: false },
};

// ─── State ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'ai-state-v1';
const LEGACY_KEYS = ['ai-chat-sync-v50', 'ai-chat-sync-v49', 'ai-chat-sync-v48'];

let state = loadState();
let currentUser = null;
let selectedImage = null;
let busy = false;
let controller = null;
let syncTimer = null;
let hasSynced = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // migrate from legacy key
    for (const k of LEGACY_KEYS) {
      const old = localStorage.getItem(k);
      if (old) {
        const parsed = JSON.parse(old);
        if (parsed && Array.isArray(parsed.chats)) return parsed;
      }
    }
  } catch(e) {}
  return { activeChatId: null, chats: [], theme: 'dark' };
}

function saveState() {
  try {
    if (state.chats.length > 40) state.chats = state.chats.slice(0, 40);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch(e) {}
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncCloud, 1800);
}

// ─── Markdown renderer ──────────────────────────────────────────────
const renderer = new marked.Renderer();
renderer.code = function(code, lang) {
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(typeof code === 'object' ? code.text : code, { language: validLang }).value;
  return `<div class="code-block">
    <div class="code-header">
      <span>${validLang}</span>
      <button class="copy-btn" onclick="copyCode(this)">📋 Копіювати</button>
    </div>
    <pre><code class="hljs ${validLang}">${highlighted}</code></pre>
  </div>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

window.copyCode = btn => {
  const code = btn.closest('.code-block').querySelector('pre').innerText;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '✅ Скопійовано';
    setTimeout(() => { btn.innerHTML = '📋 Копіювати'; }, 2000);
  });
};

function formatThinking(text) {
  return (text || '')
    .replace(/<think>/g, '<details class="thought-block"><summary>💭 Думка моделі</summary><div class="thought-content">')
    .replace(/<\/think>/g, '</div></details>');
}

function renderMd(text) {
  return DOMPurify.sanitize(marked.parse(formatThinking(text || '')), {
    ADD_TAGS: ['details', 'summary'],
  });
}

// ─── Helpers ────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function getActive() { return state.chats.find(c => c.id === state.activeChatId) || null; }

function ensureChat() {
  let c = getActive();
  if (!c) {
    c = { id: uid(), title: 'Новий чат', messages: [], createdAt: Date.now() };
    state.chats.unshift(c);
    state.activeChatId = c.id;
    saveState();
  }
  return c;
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => rej(new Error('Не вдалося прочитати файл'));
    r.readAsDataURL(file);
  });
}

// ─── Theme ──────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const moonIcon = themeBtn.querySelector('.icon-moon');
  const sunIcon  = themeBtn.querySelector('.icon-sun');
  if (state.theme === 'light') {
    moonIcon.classList.add('hidden');
    sunIcon.classList.remove('hidden');
  } else {
    moonIcon.classList.remove('hidden');
    sunIcon.classList.add('hidden');
  }
}

themeBtn.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
});

// ─── Auth UI ────────────────────────────────────────────────────────
function renderAuth() {
  if (!currentUser) {
    authOut.classList.remove('hidden');
    authIn.classList.add('hidden');
    return;
  }
  authOut.classList.add('hidden');
  authIn.classList.remove('hidden');
  const meta = currentUser.user_metadata || {};
  if (userName) userName.textContent = meta.full_name || meta.name || 'Користувач';
  if (userEmail) userEmail.textContent = currentUser.email || '';
  if (userAvatar) {
    const src = meta.avatar_url || meta.picture || '';
    userAvatar.src = src;
    userAvatar.style.display = src ? '' : 'none';
  }
}

googleLoginBtn?.addEventListener('click', async () => {
  if (!sb) return;
  await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } });
});

logoutBtn?.addEventListener('click', async () => {
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  hasSynced = false;
  renderAuth();
});

// ─── Cloud sync ─────────────────────────────────────────────────────
async function syncCloud() {
  if (!currentUser || !sb) return;
  const c = getActive();
  if (!c) return;
  try {
    await sb.from('chats').upsert({
      id: c.id, user_id: currentUser.id, title: c.title,
      messages: c.messages, updated_at: new Date().toISOString(),
    });
  } catch(_) {}
}

async function loadFromCloud() {
  if (!currentUser || !sb || hasSynced) return;
  try {
    const { data, error } = await sb.from('chats').select('*')
      .eq('user_id', currentUser.id).order('updated_at', { ascending: false }).limit(40);
    if (!error && data?.length) {
      state.chats = data.map(d => ({
        id: d.id, title: d.title, messages: d.messages || [],
        createdAt: new Date(d.created_at || d.updated_at).getTime(),
      }));
      if (!state.chats.find(c => c.id === state.activeChatId)) {
        state.activeChatId = state.chats[0].id;
      }
      saveState();
      renderAll();
    }
    hasSynced = true;
  } catch(_) {}
}

// ─── Chat list ──────────────────────────────────────────────────────
function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = '';

  if (!state.chats.length) {
    chatList.innerHTML = '<div class="chat-list-empty">Немає чатів</div>';
    return;
  }

  for (const item of state.chats) {
    const div = document.createElement('div');
    div.className = 'chat-item' + (item.id === state.activeChatId ? ' active' : '');

    const title = document.createElement('div');
    title.className = 'chat-item-title';
    title.textContent = item.title || 'Новий чат';

    const del = document.createElement('button');
    del.className = 'chat-item-del icon-btn small';
    del.setAttribute('aria-label', 'Видалити чат');
    del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm('Видалити чат?')) return;
      state.chats = state.chats.filter(c => c.id !== item.id);
      if (state.activeChatId === item.id) state.activeChatId = state.chats[0]?.id || null;
      saveState();
      renderAll();
      if (currentUser && sb) await sb.from('chats').delete().eq('id', item.id);
    };

    div.appendChild(title);
    div.appendChild(del);

    div.onclick = () => {
      if (busy) return;
      state.activeChatId = item.id;
      saveState();
      renderAll();
      closeSidebar();
    };

    chatList.appendChild(div);
  }
}

// ─── Messages ───────────────────────────────────────────────────────
function renderMessages() {
  const active = ensureChat();
  if (!chat) return;

  // Remove all but chatEmpty
  Array.from(chat.children).forEach(el => {
    if (el.id !== 'chatEmpty') el.remove();
  });

  if (!active.messages.length) {
    chatEmpty.style.display = '';
    return;
  }
  chatEmpty.style.display = 'none';

  for (const msg of active.messages) {
    const wrap = document.createElement('div');
    wrap.className = `msg-wrap ${msg.role}`;
    wrap.dataset.id = msg.id;

    const body = document.createElement('div');
    body.className = 'msg-body';

    if (msg.isError) {
      body.innerHTML = `<div class="msg-error">⚠️ ${msg.content}<br>
        <button class="retry-btn" onclick="retryLast()">🔄 Повторити</button></div>`;
    } else if (msg.role === 'assistant') {
      body.innerHTML = renderMd(msg.content || '');
    } else {
      body.textContent = msg.content || '';
    }

    if (msg.image?.dataUrl) {
      const img = document.createElement('img');
      img.src = msg.image.dataUrl;
      img.className = 'inline-img';
      img.alt = msg.image.name || 'image';
      body.appendChild(img);
    }

    wrap.appendChild(body);
    chat.appendChild(wrap);
  }

  chat.scrollTop = chat.scrollHeight;
}

function renderAll() {
  renderAuth();
  renderChatList();
  renderMessages();
  applyTheme();
  setBusy(busy);
}

// ─── Busy state ─────────────────────────────────────────────────────
function setBusy(val) {
  busy = val;
  if (sendBtn)  sendBtn.classList.toggle('hidden', val);
  if (stopBtn)  stopBtn.classList.toggle('hidden', !val);
  if (statusDot) statusDot.classList.toggle('active', val);
  if (statusText) {
    statusText.classList.toggle('hidden', !val);
    statusText.textContent = val ? 'Генерація...' : '';
  }
}

// ─── Image ──────────────────────────────────────────────────────────
function updateImageUI() {
  if (!imgBar || !imgPreview) return;
  if (!selectedImage) {
    imgBar.classList.add('hidden');
    imgPreview.removeAttribute('src');
    return;
  }
  imgBar.classList.remove('hidden');
  if (imgName) imgName.textContent = selectedImage.name || 'Зображення';
  imgPreview.src = selectedImage.dataUrl;
}

function clearImage() {
  selectedImage = null;
  if (imageInput) imageInput.value = '';
  updateImageUI();
}

imageBtn?.addEventListener('click', () => imageInput?.click());
removeImgBtn?.addEventListener('click', clearImage);

imageInput?.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('Максимальний розмір: 5 МБ'); imageInput.value = ''; return; }
  try {
    selectedImage = { name: file.name, type: file.type, dataUrl: await fileToDataUrl(file) };
    updateImageUI();
  } catch(e) { alert('Помилка завантаження фото'); }
});

// ─── Suggestion chips ───────────────────────────────────────────────
document.querySelectorAll('.suggestion-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.text;
    if (!text || busy) return;
    sendMessage(text);
  });
});

// ─── Build API messages ─────────────────────────────────────────────
function buildMessages(active, assistantMsgId, modelConf) {
  const msgs = [{ role: 'system', content: modelConf.system }];
  const recent = active.messages.slice(-14).filter(m => m.id !== assistantMsgId && !m.isError);

  for (const m of recent) {
    if (m.role === 'user') {
      const text = (m.content || '').trim();
      if (m.image?.dataUrl && modelConf.vision) {
        msgs.push({ role: 'user', content: [
          { type: 'text', text: text || 'Опиши зображення' },
          { type: 'image_url', image_url: { url: m.image.dataUrl } },
        ]});
      } else {
        msgs.push({ role: 'user', content: text || (m.image ? '[Зображення]' : '') });
      }
    } else if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '' });
    }
  }

  // Merge consecutive same-role messages
  const result = [];
  let sys = null;
  for (const m of msgs) {
    if (m.role === 'system') { sys = m; continue; }
    if (result.length && result[result.length-1].role === m.role) {
      const prev = result[result.length-1];
      if (typeof prev.content === 'string' && typeof m.content === 'string') {
        prev.content += '\n\n' + m.content;
      }
    } else {
      result.push(m);
    }
  }
  return sys ? [sys, ...result] : result;
}

// ─── Send message ───────────────────────────────────────────────────
async function sendMessage(text, isRetry = false) {
  if (busy) return;

  const active = ensureChat();
  const modelId = modelSelect?.value || 'groq/llama-3.3-70b-versatile';
  const modelConf = MODELS[modelId] || MODELS['groq/llama-3.3-70b-versatile'];

  if (!isRetry) {
    if (selectedImage && !modelConf.vision) {
      pushError(active, 'Ця модель не підтримує зображення. Обери: Gemini Flash, GPT-4o, Llama Vision або Gemma 3.');
      renderMessages();
      return;
    }

    active.messages.push({
      id: uid(), role: 'user',
      content: text, image: selectedImage, createdAt: Date.now(),
    });

    if (active.messages.length === 1) {
      active.title = (text || 'Фото').slice(0, 40) || 'Новий чат';
    }

    if (active.messages.length > 60) active.messages = active.messages.slice(-60);

    if (promptInput) { promptInput.value = ''; autoResize(); }
    clearImage();
    saveState();
  }

  const aiMsg = { id: uid(), role: 'assistant', content: '', createdAt: Date.now() };
  active.messages.push(aiMsg);
  renderAll();
  setBusy(true);

  const apiMessages = buildMessages(active, aiMsg.id, modelConf);
  controller = new AbortController();

  try {
    const resp = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: apiMessages,
        temperature: 0.5,
        max_tokens: modelConf.tokens,
        top_p: 0.9,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const raw = await resp.text().catch(() => '');
      let msg = `HTTP ${resp.status}`;
      try {
        const p = JSON.parse(raw);
        msg += ': ' + (p?.error?.message || p?.error || p?.details || raw);
      } catch { if (raw) msg += ': ' + raw; }
      throw new Error(msg);
    }

    if (!resp.body) throw new Error('Порожня відповідь сервера');

    const reader = resp.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';

    // Find the assistant element to stream into
    const allMsgEls = chat.querySelectorAll('.msg-wrap.assistant .msg-body');
    const targetEl = allMsgEls[allMsgEls.length - 1];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop() || '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content || '';
            if (delta) {
              aiMsg.content += delta;
              if (targetEl) {
                targetEl.innerHTML = renderMd(aiMsg.content);
                chat.scrollTop = chat.scrollHeight;
              }
            }
          } catch(_) {}
        }
      }
    }

  } catch(e) {
    if (e?.name === 'AbortError') {
      aiMsg.content += '\n\n*[Зупинено]*';
    } else {
      active.messages.pop(); // remove empty aiMsg
      pushError(active, e.message || 'Невідома помилка');
    }
    renderAll();
  } finally {
    controller = null;
    saveState();
    setBusy(false);
  }
}

function pushError(active, message) {
  active.messages.push({ id: uid(), role: 'assistant', isError: true, content: message });
}

window.retryLast = function() {
  const active = getActive();
  if (!active) return;
  const last = active.messages[active.messages.length - 1];
  if (last?.isError) active.messages.pop();
  const lastUser = [...active.messages].reverse().find(m => m.role === 'user');
  if (lastUser) {
    selectedImage = lastUser.image || null;
    updateImageUI();
    sendMessage(lastUser.content || '', true);
  }
};

// ─── Form submit ────────────────────────────────────────────────────
form?.addEventListener('submit', e => {
  e.preventDefault();
  const text = promptInput?.value.trim() || '';
  if (text || selectedImage) sendMessage(text);
});

promptInput?.addEventListener('input', autoResize);

promptInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form?.requestSubmit(); }
});

stopBtn?.addEventListener('click', () => controller?.abort());

function autoResize() {
  if (!promptInput) return;
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
}

// ─── Clear / New chat ────────────────────────────────────────────────
clearBtn?.addEventListener('click', () => {
  const active = ensureChat();
  if (!confirm('Очистити поточний чат?')) return;
  active.messages = [];
  active.title = 'Новий чат';
  saveState();
  renderAll();
});

newChatBtn?.addEventListener('click', () => {
  state.activeChatId = null;
  ensureChat();
  renderAll();
  closeSidebar();
});

// ─── Sidebar / mobile ────────────────────────────────────────────────
function closeSidebar() {
  sidebar?.classList.remove('open');
  overlay?.classList.remove('show');
  document.body.style.overflow = '';
}

hamburger?.addEventListener('click', () => {
  sidebar?.classList.add('open');
  overlay?.classList.add('show');
  document.body.style.overflow = 'hidden';
});

overlay?.addEventListener('click', closeSidebar);

// ─── Supabase auth ───────────────────────────────────────────────────
sb?.auth.onAuthStateChange((_ev, session) => {
  currentUser = session?.user || null;
  renderAuth();
  if (currentUser) loadFromCloud();
});

sb?.auth.getSession().then(({ data }) => {
  currentUser = data?.session?.user || null;
  renderAuth();
  if (currentUser) loadFromCloud();
}).catch(() => {});

// ─── Init ────────────────────────────────────────────────────────────
applyTheme();
renderAll();
autoResize();
updateImageUI();
