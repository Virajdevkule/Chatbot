/* =========================================================
   NEXUS — Application Logic
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Config ---------- */
  const API_URL = "/chat";// CHANGE THIS to your backend URL
  const STORAGE_KEY = 'nexus_conversations_v1';
  const SETTINGS_KEY = 'nexus_settings_v1';
  const MAX_CHARS = 8000;

  const MODEL_TOKEN_LIMITS = {
    'gemini-2.5-flash': 128000,
    'gemini-2.5-pro': 1000000,
    'gemini-2.5-flash-lite': 64000,
  };
  const MODEL_NAMES = {
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
  };

  /* ---------- DOM refs ---------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const sidebar = $('#sidebar');
  const overlay = $('#overlay');
  const historyList = $('#historyList');
  const searchInput = $('#searchInput');
  const newChatBtn = $('#newChatBtn');
  const collapseBtn = $('#collapseBtn');
  const openSidebarBtn = $('#openSidebarBtn');

  const profileBtn = $('#profileBtn');
  const profileMenu = $('#profileMenu');

  const chatScroll = $('#chatScroll');
  const chatContainer = $('#chatContainer');
  const messagesEl = $('#messages');
  const emptyState = $('#emptyState');
  const scrollBottomBtn = $('#scrollBottomBtn');

  const promptInput = $('#promptInput');
  const sendBtn = $('#sendBtn');
  const charCounter = $('#charCounter');
  const attachBtn = $('#attachBtn');
  const fileInput = $('#fileInput');
  const attachmentsEl = $('#attachments');
  const composer = $('.composer');
  const dropZone = $('#dropZone');
  const micBtn = $('#micBtn');

  const modelSelector = $('#modelSelector');
  const modelBtn = $('#modelBtn');
  const modelDropdown = $('#modelDropdown');
  const modelNameEl = $('#modelName');
  const tokenUsageEl = $('#tokenUsage');

  const themeToggle = $('#themeToggle');
  const searchInChatBtn = $('#searchInChatBtn');
  const chatSearchBar = $('#chatSearchBar');
  const chatSearchInput = $('#chatSearchInput');
  const closeChatSearch = $('#closeChatSearch');
  const searchCount = $('#searchCount');

  const settingsBackdrop = $('#settingsBackdrop');
  const closeSettings = $('#closeSettings');
  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightboxImg');
  const toastRoot = $('#toastRoot');

  /* ---------- State ---------- */
  let conversations = [];
  let activeId = null;
  let currentModel = 'gemini-2.5-flash';
  let pendingAttachments = [];
  let isGenerating = false;
  let abortController = null;
  let recognizing = false;

  let settings = {
    theme: 'dark',
    fontSize: 'md',
    chatWidth: 'default',
    memory: true,
    autosave: true,
  };

  /* =========================================================
     Persistence
     ========================================================= */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = { ...settings, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    applySettings();
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applySettings() {
    // Theme
    let effectiveTheme = settings.theme;
    if (effectiveTheme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.body.setAttribute('data-theme', effectiveTheme);

    document.body.setAttribute('data-font-size', settings.fontSize);
    document.body.setAttribute('data-chat-width', settings.chatWidth);

    $$('#themeSegmented button').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
    $$('#fontSizeSegmented button').forEach(b => b.classList.toggle('active', b.dataset.size === settings.fontSize));
    $$('#chatWidthSegmented button').forEach(b => b.classList.toggle('active', b.dataset.width === settings.chatWidth));

    $('#memoryToggle').checked = settings.memory;
    $('#autosaveToggle').checked = settings.autosave;
  }

  function loadConversations() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      conversations = raw ? JSON.parse(raw) : [];
    } catch (e) {
      conversations = [];
    }
  }

  function saveConversations() {
    if (!settings.autosave) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      updateStorageMeter();
    } catch (e) {
      showToast('Storage limit reached — try exporting & clearing old chats', 'error');
    }
  }

  function updateStorageMeter() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '';
      const bytes = new Blob([raw]).size;
      const kb = bytes / 1024;
      const limitKb = 5120; // approx 5MB soft cap for display
      const pct = Math.min(100, (kb / limitKb) * 100);
      $('#storageFill').style.width = pct + '%';
      $('#storageUsed').textContent = kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb/1024).toFixed(2)} MB`;
    } catch (e) {
      $('#storageUsed').textContent = '—';
    }
  }

  /* =========================================================
     Conversation helpers
     ========================================================= */
  function newId() {
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function createConversation() {
    const conv = {
      id: newId(),
      title: 'New chat',
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: currentModel,
      messages: [],
    };
    conversations.unshift(conv);
    activeId = conv.id;
    saveConversations();
    renderHistory();
    renderMessages();
    return conv;
  }

  function getActiveConversation() {
    return conversations.find(c => c.id === activeId) || null;
  }

  function ensureConversation() {
    let conv = getActiveConversation();
    if (!conv) conv = createConversation();
    return conv;
  }

  function deleteConversation(id) {
    conversations = conversations.filter(c => c.id !== id);
    if (activeId === id) {
      activeId = conversations.length ? conversations[0].id : null;
    }
    saveConversations();
    renderHistory();
    renderMessages();
  }

  function setActiveConversation(id) {
    activeId = id;
    const conv = getActiveConversation();
    if (conv && conv.model && MODEL_NAMES[conv.model]) {
      currentModel = conv.model;
      modelNameEl.textContent = MODEL_NAMES[currentModel];
      $$('.model-card').forEach(c => c.classList.toggle('active', c.dataset.model === currentModel));
    }
    renderHistory();
    renderMessages();
    closeMobileSidebar();
  }

  function touchConversation(conv) {
    conv.updatedAt = Date.now();
    conversations.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  /* =========================================================
     Sidebar / History rendering
     ========================================================= */
  function timeGroup(ts) {
    const now = new Date();
    const d = new Date(ts);
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    if (d > weekAgo) return 'Previous 7 days';
    return 'Older';
  }

  function renderHistory() {
    const query = searchInput.value.trim().toLowerCase();
    historyList.innerHTML = '';

    let list = conversations.filter(c => {
      if (!query) return true;
      const inTitle = c.title.toLowerCase().includes(query);
      const inMsgs = c.messages.some(m => m.content.toLowerCase().includes(query));
      return inTitle || inMsgs;
    });

    if (!list.length) {
      historyList.innerHTML = `<div class="history-empty">${query ? 'No matching conversations' : 'No conversations yet — start one! 💬'}</div>`;
      return;
    }

    const pinned = list.filter(c => c.pinned);
    const rest = list.filter(c => !c.pinned);

    if (pinned.length) {
      historyList.appendChild(sectionLabel('Pinned'));
      pinned.forEach(c => historyList.appendChild(historyItem(c)));
    }

    const groups = {};
    rest.forEach(c => {
      const g = timeGroup(c.updatedAt);
      groups[g] = groups[g] || [];
      groups[g].push(c);
    });

    ['Today', 'Yesterday', 'Previous 7 days', 'Older'].forEach(g => {
      if (groups[g] && groups[g].length) {
        historyList.appendChild(sectionLabel(g));
        groups[g].forEach(c => historyList.appendChild(historyItem(c)));
      }
    });
  }

  function sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'history-section-label';
    el.textContent = text;
    return el;
  }

  function historyItem(conv) {
    const item = document.createElement('div');
    item.className = 'history-item' + (conv.id === activeId ? ' active' : '');
    item.dataset.id = conv.id;

    item.innerHTML = `
      <span class="history-icon">
        <svg viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="history-title">${escapeHtml(conv.title)}</span>
      <div class="history-actions">
        <button class="pin-btn ${conv.pinned ? 'pin-active' : ''}" title="${conv.pinned ? 'Unpin' : 'Pin'}" aria-label="Pin conversation">
          <svg viewBox="0 0 24 24" fill="${conv.pinned ? 'currentColor' : 'none'}"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </button>
        <button class="rename-btn" title="Rename" aria-label="Rename conversation">
          <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="delete-btn" title="Delete" aria-label="Delete conversation">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0l-1 14a1 1 0 01-1 1H6a1 1 0 01-1-1L4 6h16z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.history-actions')) return;
      setActiveConversation(conv.id);
    });

    item.querySelector('.pin-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      conv.pinned = !conv.pinned;
      saveConversations();
      renderHistory();
    });

    item.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${conv.title}"? This can't be undone.`)) {
        deleteConversation(conv.id);
        showToast('Conversation deleted', 'success');
      }
    });

    item.querySelector('.rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(item, conv);
    });

    return item;
  }

  function startRename(item, conv) {
    item.classList.add('editing');
    const titleEl = item.querySelector('.history-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'history-title-input';
    input.value = conv.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = (save) => {
      if (save && input.value.trim()) {
        conv.title = input.value.trim().slice(0, 60);
        saveConversations();
      }
      renderHistory();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  /* =========================================================
     Messages rendering
     ========================================================= */
  function renderMessages() {
    const conv = getActiveConversation();
    messagesEl.innerHTML = '';

    if (!conv || conv.messages.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }
    emptyState.style.display = 'none';

    conv.messages.forEach((msg, idx) => {
      messagesEl.appendChild(renderMessage(msg, idx));
    });

    highlightAndEnhance();
    scrollToBottom(true);
  }

  function renderMessage(msg, idx) {
    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    el.dataset.idx = idx;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    if (msg.role === 'user') {
      avatar.textContent = 'VG';
    } else {
      avatar.innerHTML = `<svg viewBox="0 0 32 32" fill="none"><path d="M16 2L29 9V23L16 30L3 23V9L16 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
    }

    const body = document.createElement('div');
    body.className = 'msg-body';

    // Attachments
    if (msg.attachments && msg.attachments.length) {
      const attWrap = document.createElement('div');
      attWrap.className = 'msg-attachments';
      msg.attachments.forEach(att => {
        if (att.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.className = 'msg-attachment-img';
          img.src = att.dataUrl;
          img.alt = att.name;
          img.addEventListener('click', () => openLightbox(att.dataUrl));
          attWrap.appendChild(img);
        } else {
          const chip = document.createElement('div');
          chip.className = 'msg-attachment-file';
          chip.innerHTML = `${fileIconSvg()}<span>${escapeHtml(att.name)}</span>`;
          attWrap.appendChild(chip);
        }
      });
      body.appendChild(attWrap);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (msg.role === 'assistant' && msg.streaming) {
      el.classList.add('streaming');
      bubble.innerHTML = `<div class="thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-label">Thinking…</span></div>`;
    } else {
      bubble.innerHTML = `<div class="md">${renderMarkdown(msg.content)}</div>`;
    }
    body.appendChild(bubble);

    // Meta + actions
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = document.createElement('span');
    time.textContent = formatTime(msg.timestamp);
    meta.appendChild(time);

    if (!msg.streaming) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';

      // Copy
      actions.appendChild(actionBtn(copyIconSvg(), 'Copy', () => {
        navigator.clipboard.writeText(msg.content).then(() => {
          showToast('Copied to clipboard 📋', 'success');
        });
      }));

      if (msg.role === 'user') {
        // Edit
        actions.appendChild(actionBtn(editIconSvg(), 'Edit', () => startEditMessage(el, msg, idx)));
      } else {
        // Regenerate
        actions.appendChild(actionBtn(regenIconSvg(), 'Regenerate', () => regenerateResponse(idx)));
      }

      meta.appendChild(actions);
    }

    body.appendChild(meta);

    el.appendChild(avatar);
    el.appendChild(body);
    return el;
  }

  function actionBtn(svg, title, onClick) {
    const btn = document.createElement('button');
    btn.innerHTML = svg;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function startEditMessage(el, msg, idx) {
    const bubble = el.querySelector('.msg-bubble');
    const original = bubble.innerHTML;
    bubble.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.className = 'msg-edit-area';
    textarea.value = msg.content;
    bubble.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'msg-edit-actions';
    actions.innerHTML = `<button class="save-btn">Save &amp; submit</button><button class="cancel-btn">Cancel</button>`;
    bubble.appendChild(actions);

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    autoResize(textarea);
    textarea.addEventListener('input', () => autoResize(textarea));

    actions.querySelector('.cancel-btn').addEventListener('click', () => {
      bubble.innerHTML = original;
    });

    actions.querySelector('.save-btn').addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (!newText) return;
      const conv = getActiveConversation();
      // Truncate conversation at this point and resubmit
      conv.messages = conv.messages.slice(0, idx);
      sendMessage(newText, msg.attachments || []);
    });
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
  }

  /* =========================================================
     Markdown / code rendering
     ========================================================= */
  function configureMarked() {
    if (typeof marked === 'undefined') return;
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }

  function renderMarkdown(text) {
    if (typeof marked === 'undefined') return escapeHtml(text);

    // Handle mermaid code blocks specially before marked
    let html = marked.parse(text);

    // Wrap pre/code blocks with custom header + copy button
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    wrapper.querySelectorAll('pre').forEach(pre => {
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;
      const langMatch = (codeEl.className || '').match(/language-(\w+)/);
      const lang = langMatch ? langMatch[1] : 'text';

      if (lang === 'mermaid') {
        const block = document.createElement('div');
        block.className = 'mermaid-block';
        block.innerHTML = `<div class="mermaid-label">📊 Mermaid diagram</div><pre style="white-space:pre-wrap;margin:0;">${codeEl.innerHTML}</pre>`;
        pre.replaceWith(block);
        return;
      }

      const block = document.createElement('div');
      block.className = 'code-block';
      const header = document.createElement('div');
      header.className = 'code-block-header';
      header.innerHTML = `<span>${escapeHtml(lang)}</span><button class="code-copy-btn">${copyIconSvg()}<span>Copy</span></button>`;
      block.appendChild(header);

      const newPre = pre.cloneNode(true);
      block.appendChild(newPre);
      pre.replaceWith(block);

      header.querySelector('.code-copy-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
          btn.classList.add('copied');
          btn.querySelector('span').textContent = 'Copied!';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.querySelector('span').textContent = 'Copy';
          }, 1500);
        });
      });
    });

    return wrapper.innerHTML;
  }

  function highlightAndEnhance() {
    if (typeof hljs !== 'undefined') {
      messagesEl.querySelectorAll('pre code').forEach(block => {
        try { hljs.highlightElement(block); } catch (e) {}
      });
    }
  }

  /* =========================================================
     Sending messages / streaming
     ========================================================= */
  function sendMessage(text, attachments = []) {
    text = text.trim();
    if (!text && attachments.length === 0) return;

    const conv = ensureConversation();

    // Title from first message
    if (conv.messages.length === 0) {
      conv.title = text.slice(0, 48) || (attachments[0] ? attachments[0].name : 'New chat');
    }

    conv.messages.push({
      role: 'user',
      content: text,
      attachments,
      timestamp: Date.now(),
    });

    const assistantMsg = {
      role: 'assistant',
      content: '',
      streaming: true,
      timestamp: Date.now(),
    };
    conv.messages.push(assistantMsg);

    touchConversation(conv);
    saveConversations();
    renderHistory();
    renderMessages();
    setGenerating(true);

    requestReply(conv, assistantMsg);
  }

  function setGenerating(state) {
    isGenerating = state;
    sendBtn.classList.toggle('generating', state);
    sendBtn.disabled = state ? false : (promptInput.value.trim().length === 0 && pendingAttachments.length === 0);
  }

  async function requestReply(conv, assistantMsg) {
    abortController = new AbortController();

    // Build conversation history for context if memory enabled
    const history = settings.memory
      ? conv.messages
          .filter(m => m !== assistantMsg)
          .slice(-20)
          .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }))
      : [];

    const lastUserMsg = conv.messages[conv.messages.length - 2];

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: lastUserMsg.content, history: history.slice(0, -1), model: conv.model }),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const replyText = data.reply || '';
      await streamText(conv, assistantMsg, replyText);

    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content = assistantMsg.content || '_Generation stopped._';
      } else {
        assistantMsg.content = `⚠️ **Couldn't reach the backend.**\n\nMake sure your server is running at \`${API_URL}\`.\n\n\`\`\`\n${err.message}\n\`\`\``;
      }
      assistantMsg.streaming = false;
      finalizeAssistantMessage(conv, assistantMsg);
    }
  }

  // Simulated streaming (since /chat returns the full reply at once)
  function streamText(conv, assistantMsg, fullText) {
    return new Promise((resolve) => {
      if (!fullText) {
        assistantMsg.content = '_(empty response)_';
        assistantMsg.streaming = false;
        finalizeAssistantMessage(conv, assistantMsg);
        resolve();
        return;
      }

      const words = fullText.split(/(\s+)/);
      let i = 0;
      const bubble = () => messagesEl.querySelector(`.message[data-idx="${conv.messages.length - 1}"] .msg-bubble`);

      function step() {
        if (abortController && abortController.signal.aborted) {
          assistantMsg.streaming = false;
          finalizeAssistantMessage(conv, assistantMsg);
          resolve();
          return;
        }
        if (i >= words.length) {
          assistantMsg.streaming = false;
          finalizeAssistantMessage(conv, assistantMsg);
          resolve();
          return;
        }

        // batch a few "tokens" per tick for speed
        const batch = Math.min(3, words.length - i);
        for (let k = 0; k < batch; k++) {
          assistantMsg.content += words[i];
          i++;
        }

        const b = bubble();
        if (b) {
          b.innerHTML = `<div class="md">${renderMarkdown(assistantMsg.content)}</div><span class="stream-cursor"></span>`;
          highlightAndEnhance();
          scrollToBottomIfNear();
        }

        setTimeout(step, 18);
      }

      // initial paint to remove "thinking"
      const b = bubble();
      if (b) b.innerHTML = `<div class="md"></div><span class="stream-cursor"></span>`;

      step();
    });
  }

  function finalizeAssistantMessage(conv, assistantMsg) {
    setGenerating(false);
    saveConversations();
    renderMessages();
    estimateTokenUsage(conv);
  }

  function regenerateResponse(idx) {
    const conv = getActiveConversation();
    if (!conv) return;
    // idx is the assistant message index; remove it and everything after, resend last user msg
    conv.messages = conv.messages.slice(0, idx);
    const lastUser = conv.messages[conv.messages.length - 1];
    if (lastUser && lastUser.role === 'user') {
      conv.messages.pop();
      sendMessage(lastUser.content, lastUser.attachments || []);
    }
  }

  function stopGeneration() {
    if (abortController) abortController.abort();
  }

  function estimateTokenUsage(conv) {
    const totalChars = conv.messages.reduce((acc, m) => acc + m.content.length, 0);
    const approxTokens = Math.round(totalChars / 4);
    const limit = MODEL_TOKEN_LIMITS[conv.model] || MODEL_TOKEN_LIMITS[currentModel];
    tokenUsageEl.textContent = `${formatTokens(approxTokens)} / ${formatTokens(limit)}`;
  }

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return String(n);
  }

  /* =========================================================
     Scrolling
     ========================================================= */
  function scrollToBottom(force = false) {
    if (force) {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }

  function scrollToBottomIfNear() {
    const threshold = 120;
    const distFromBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight;
    if (distFromBottom < threshold) {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }

  chatScroll.addEventListener('scroll', () => {
    const distFromBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight;
    scrollBottomBtn.classList.toggle('show', distFromBottom > 200);
  });

  scrollBottomBtn.addEventListener('click', () => scrollToBottom(true));

  /* =========================================================
     Composer behavior
     ========================================================= */
  promptInput.addEventListener('input', () => {
    autoResize(promptInput);
    const len = promptInput.value.length;
    charCounter.textContent = `${len} / ${MAX_CHARS}`;
    charCounter.classList.toggle('over-limit', len > MAX_CHARS);
    if (!isGenerating) {
      sendBtn.disabled = promptInput.value.trim().length === 0 && pendingAttachments.length === 0;
    }
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', () => {
    if (isGenerating) {
      stopGeneration();
    } else {
      handleSend();
    }
  });

  function handleSend() {
    const text = promptInput.value;
    if (isGenerating) return;
    if (!text.trim() && pendingAttachments.length === 0) return;
    if (text.length > MAX_CHARS) {
      showToast('Message exceeds character limit', 'error');
      return;
    }

    const atts = pendingAttachments.slice();
    sendMessage(text, atts);

    promptInput.value = '';
    autoResize(promptInput);
    charCounter.textContent = `0 / ${MAX_CHARS}`;
    charCounter.classList.remove('over-limit');
    pendingAttachments = [];
    renderAttachments();
  }

  // Suggestion cards
  $$('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      promptInput.value = card.dataset.prompt;
      autoResize(promptInput);
      promptInput.dispatchEvent(new Event('input'));
      promptInput.focus();
    });
  });

  /* =========================================================
     Attachments
     ========================================================= */
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  function handleFiles(fileList) {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        pendingAttachments.push({
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: reader.result,
        });
        renderAttachments();
        sendBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = '';
    pendingAttachments.forEach((att, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const preview = att.type.startsWith('image/')
        ? `<img src="${att.dataUrl}" alt="${escapeHtml(att.name)}" />`
        : `<div class="file-icon">${fileIconSvg()}</div>`;
      chip.innerHTML = `${preview}<span class="name">${escapeHtml(att.name)}</span><button class="remove-btn" aria-label="Remove attachment">${closeIconSvg()}</button>`;
      chip.querySelector('.remove-btn').addEventListener('click', () => {
        pendingAttachments.splice(idx, 1);
        renderAttachments();
        if (pendingAttachments.length === 0 && promptInput.value.trim() === '') sendBtn.disabled = true;
      });
      attachmentsEl.appendChild(chip);
    });
  }

  // Drag & drop
  ['dragenter', 'dragover'].forEach(evt => {
    composer.addEventListener(evt, (e) => {
      e.preventDefault();
      composer.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    composer.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && e.target !== composer) return;
      composer.classList.remove('dragover');
    });
  });
  composer.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  /* =========================================================
     Voice input
     ========================================================= */
  let recognition = null;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      promptInput.value = transcript;
      autoResize(promptInput);
      promptInput.dispatchEvent(new Event('input'));
    };
    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove('recording');
    };
    recognition.onerror = () => {
      recognizing = false;
      micBtn.classList.remove('recording');
      showToast('Voice input error — check microphone permissions', 'error');
    };
  }

  micBtn.addEventListener('click', () => {
    if (!recognition) {
      showToast('Voice input not supported in this browser', 'error');
      return;
    }
    if (recognizing) {
      recognition.stop();
      recognizing = false;
      micBtn.classList.remove('recording');
    } else {
      recognition.start();
      recognizing = true;
      micBtn.classList.add('recording');
    }
  });

  /* =========================================================
     Model selector
     ========================================================= */
  modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modelSelector.classList.toggle('open');
  });

  $$('.model-card').forEach(card => {
    card.addEventListener('click', () => {
      currentModel = card.dataset.model;
      modelNameEl.textContent = MODEL_NAMES[currentModel];
      $$('.model-card').forEach(c => c.classList.toggle('active', c === card));
      modelSelector.classList.remove('open');

      const conv = getActiveConversation();
      if (conv) {
        conv.model = currentModel;
        saveConversations();
        estimateTokenUsage(conv);
      } else {
        tokenUsageEl.textContent = `0 / ${formatTokens(MODEL_TOKEN_LIMITS[currentModel])}`;
      }
      showToast(`Switched to ${MODEL_NAMES[currentModel]} ${card.querySelector('.model-card-icon').textContent}`, 'success');
    });
  });

  /* =========================================================
     Theme toggle (quick)
     ========================================================= */
  themeToggle.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme');
    settings.theme = current === 'dark' ? 'light' : 'dark';
    applySettings();
    saveSettings();
  });

  /* =========================================================
     Sidebar interactions
     ========================================================= */
  newChatBtn.addEventListener('click', () => {
    createConversation();
    promptInput.focus();
  });

  collapseBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  openSidebarBtn.addEventListener('click', () => {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('show');
  });

  overlay.addEventListener('click', closeMobileSidebar);

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
  }

  searchInput.addEventListener('input', renderHistory);

  // Profile menu
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileMenu.classList.toggle('open');
    profileBtn.classList.toggle('open');
  });

  $$('.profile-menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      profileMenu.classList.remove('open');
      profileBtn.classList.remove('open');
      handleProfileAction(action);
    });
  });

  function handleProfileAction(action) {
    switch (action) {
      case 'settings': openSettings(); break;
      case 'usage': openSettings('data'); showToast(`${conversations.length} conversations stored locally 📊`, 'success'); break;
      case 'export': exportChats(); break;
      case 'import': importChats(); break;
      case 'clear': clearAllHistory(); break;
    }
  }

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!modelSelector.contains(e.target)) modelSelector.classList.remove('open');
    if (!profileBtn.contains(e.target) && !profileMenu.contains(e.target)) {
      profileMenu.classList.remove('open');
      profileBtn.classList.remove('open');
    }
  });

  /* =========================================================
     Settings modal
     ========================================================= */
  function openSettings(tab) {
    settingsBackdrop.classList.add('open');
    if (tab) {
      $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      $$('.modal-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
    }
  }
  function closeSettingsModal() {
    settingsBackdrop.classList.remove('open');
  }
  closeSettings.addEventListener('click', closeSettingsModal);
  settingsBackdrop.addEventListener('click', (e) => {
    if (e.target === settingsBackdrop) closeSettingsModal();
  });

  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.modal-tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.modal-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
    });
  });

  $$('#themeSegmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.theme = btn.dataset.theme;
      applySettings();
      saveSettings();
    });
  });
  $$('#fontSizeSegmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.fontSize = btn.dataset.size;
      applySettings();
      saveSettings();
    });
  });
  $$('#chatWidthSegmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.chatWidth = btn.dataset.width;
      applySettings();
      saveSettings();
    });
  });

  $('#memoryToggle').addEventListener('change', (e) => {
    settings.memory = e.target.checked;
    saveSettings();
  });
  $('#autosaveToggle').addEventListener('change', (e) => {
    settings.autosave = e.target.checked;
    saveSettings();
    if (settings.autosave) saveConversations();
  });

  $('#exportBtn').addEventListener('click', exportChats);
  $('#importBtn').addEventListener('click', importChats);
  $('#clearAllBtn').addEventListener('click', clearAllHistory);

  function exportChats() {
    const blob = new Blob([JSON.stringify(conversations, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Chats exported 📤', 'success');
  }

  function importChats() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error('Invalid format');
          conversations = [...imported, ...conversations];
          saveConversations();
          renderHistory();
          showToast(`Imported ${imported.length} conversation(s) 📥`, 'success');
        } catch (err) {
          showToast('Invalid import file', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function clearAllHistory() {
    if (!confirm('Clear all conversation history? This cannot be undone.')) return;
    conversations = [];
    activeId = null;
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
    renderMessages();
    updateStorageMeter();
    closeSettingsModal();
    showToast('All history cleared 🗑️', 'success');
  }

  /* =========================================================
     In-chat search
     ========================================================= */
  searchInChatBtn.addEventListener('click', () => {
    chatSearchBar.classList.toggle('show');
    if (chatSearchBar.classList.contains('show')) chatSearchInput.focus();
    else clearSearchHighlights();
  });
  closeChatSearch.addEventListener('click', () => {
    chatSearchBar.classList.remove('show');
    clearSearchHighlights();
  });

  function clearSearchHighlights() {
    messagesEl.querySelectorAll('mark.search-hit').forEach(m => {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    searchCount.textContent = '';
  }

  chatSearchInput.addEventListener('input', () => {
    clearSearchHighlights();
    const term = chatSearchInput.value.trim();
    if (!term) return;

    let count = 0;
    const walker = document.createTreeWalker(messagesEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    const regex = new RegExp(escapeRegex(term), 'gi');
    nodes.forEach(node => {
      const text = node.nodeValue;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let m;
      while ((m = regex.exec(text))) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = m[0];
        frag.appendChild(mark);
        lastIndex = m.index + m[0].length;
        count++;
      }
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.parentNode.replaceChild(frag, node);
    });

    searchCount.textContent = count ? `${count} match${count > 1 ? 'es' : ''}` : 'No matches';
    const first = messagesEl.querySelector('mark.search-hit');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* =========================================================
     Lightbox
     ========================================================= */
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add('open');
  }
  lightbox.addEventListener('click', () => lightbox.classList.remove('open'));

  /* =========================================================
     Toasts
     ========================================================= */
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : '⚠️';
    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    toastRoot.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 2600);
  }

  /* =========================================================
     Keyboard shortcuts
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      createConversation();
      promptInput.focus();
    }
    if (cmd && e.key === '/') {
      e.preventDefault();
      promptInput.focus();
    }
    if (e.key === 'Escape') {
      if (isGenerating) stopGeneration();
      if (settingsBackdrop.classList.contains('open')) closeSettingsModal();
      if (lightbox.classList.contains('open')) lightbox.classList.remove('open');
      if (chatSearchBar.classList.contains('show')) {
        chatSearchBar.classList.remove('show');
        clearSearchHighlights();
      }
    }
  });

  /* =========================================================
     Utility / icons
     ========================================================= */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function copyIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  function editIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function regenIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function fileIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }
  function closeIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  /* =========================================================
     Init
     ========================================================= */
  function init() {
    loadSettings();
    loadConversations();
    configureMarked();
    updateStorageMeter();

    if (conversations.length) {
      activeId = conversations[0].id;
      currentModel = conversations[0].model || currentModel;
      modelNameEl.textContent = MODEL_NAMES[currentModel] || MODEL_NAMES['gemini-2.5-flash'];
      $$('.model-card').forEach(c => c.classList.toggle('active', c.dataset.model === currentModel));
    }

    renderHistory();
    renderMessages();

    const conv = getActiveConversation();
    if (conv) estimateTokenUsage(conv);
    else tokenUsageEl.textContent = `0 / ${formatTokens(MODEL_TOKEN_LIMITS[currentModel])}`;

    // React to system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.theme === 'system') applySettings();
    });
  }
  

  init();
  
})();

