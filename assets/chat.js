/**
 * Afina AI · assets/chat.js
 *
 * File-handling overhaul in this version:
 *  1. Files are sent as actual FormData (multipart) when present —
 *     n8n receives them in $binary, chatInput still has text content for the AI.
 *  2. DeepSeek-style file cards in input preview (horizontal scroll row).
 *  3. File cards rendered in sent messages (grid above user bubble).
 *  4. Files stored in versions[] — preserved across edits and version navigation.
 *  5. Edit re-sends files via FormData, not just text.
 *  6. 20-file upload limit with toast notification.
 *  7. Retry re-sends files from the current version.
 *
 * Previous fixes preserved:
 *  - Binary file detection before .text()
 *  - AbortController + reader.cancel() for stop
 *  - Edit branch sessionId for fresh n8n memory
 *  - Turn tail hide/restore on version navigation
 *  - Clear chat generates new sessionId
 *  - Tooltip direction, icon rendering
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {

  // ── Config ──────────────────────────────────────────────────
  const WEBHOOK_URL           = 'https://n8n.myserverdomen.store/webhook/my-custom-chat';
  const AUTO_SCROLL_THRESHOLD = 15;
  const MAX_FILES             = 20;

  // ── Text-file extensions (safe to call .text() on) ─────────
  const TEXT_EXTS = new Set([
    '.txt','.md','.markdown','.js','.mjs','.cjs','.ts','.tsx','.jsx',
    '.css','.scss','.sass','.less','.html','.htm','.xml','.svg',
    '.json','.jsonl','.csv','.tsv','.yaml','.yml','.toml','.ini',
    '.env','.sh','.bash','.zsh','.py','.rb','.php','.go','.rs',
    '.java','.kt','.swift','.c','.cpp','.h','.cs','.sql','.graphql',
    '.log','.conf','.gitignore','.editorconfig','.prettierrc',
  ]);
  const TEXT_MIME_PREFIXES = ['text/','application/json','application/javascript',
    'application/xml','application/yaml','application/toml'];

  function isTextFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (TEXT_EXTS.has(ext)) return true;
    if (file.type && TEXT_MIME_PREFIXES.some(p => file.type.startsWith(p))) return true;
    return false;
  }

  // ── DOM refs ────────────────────────────────────────────────
  const inputField           = document.getElementById('user-input');
  const actionBtn            = document.getElementById('action-btn');
  const sendIcon             = document.getElementById('send-icon');
  const stopIcon             = document.getElementById('stop-icon');
  const messagesContainer    = document.getElementById('chat-messages-container');
  const typingIndicator      = document.getElementById('typing-indicator');
  const typingText           = document.getElementById('typing-text');
  const welcomeScreen        = document.getElementById('welcome-screen');
  const attachBtn            = document.getElementById('attach-btn');
  const fileInput            = document.getElementById('file-input');
  const micBtn               = document.getElementById('mic-btn');
  const filePreviewContainer = document.getElementById('file-preview-container');
  const clearBtn             = document.getElementById('clear-btn');
  const themeBtn             = document.getElementById('theme-btn');
  const iconMoon             = document.getElementById('icon-moon');
  const iconSun              = document.getElementById('icon-sun');
  const scrollToBottomBtn    = document.getElementById('scroll-to-bottom');
  const ctxOverlay           = document.getElementById('ctx-overlay');
  const ctxMenu              = document.getElementById('ctx-menu');
  const ctxCopyBtn           = document.getElementById('ctx-copy-btn');
  const ctxEditBtn           = document.getElementById('ctx-edit-btn');
  const ctxRetryBtn          = document.getElementById('ctx-retry-btn');

  // ── State ───────────────────────────────────────────────────
  let mainSessionId   = genId();
  let activeSessionId = mainSessionId;
  let autoScroll      = true;
  let abortCtrl       = null;
  let activeReader    = null;
  let isGenerating    = false;
  let isFirstMsg      = true;
  let attachedFiles   = [];              // File objects in input area
  let turns           = [];
  let ctxTarget       = null;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                || navigator.maxTouchPoints > 1;

  function genId() {
    return Math.random().toString(36).slice(2, 13);
  }

  // ── Inline SVG icons (stroke-based, NO fill attribute) ─────
  const IC = {
    copy:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    copied: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    edit:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    retry:  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.34"/></svg>`,
    stop:   `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    attach: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    close:  `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  };

  const LOADING_HTML = `<div class="bot-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;

  // ── Utilities ───────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /** Ghost-click-safe click listener */
  function onClick(el, fn) {
    if (!el) return;
    let blocked = false;
    el.addEventListener('touchend', (e) => {
      blocked = true;
      e.preventDefault();
      fn(e);
      setTimeout(() => { blocked = false; }, 380);
    }, { passive: false });
    el.addEventListener('click', (e) => { if (!blocked) fn(e); });
  }

  // ══════════════════════════════════════════════════════════════
  //  FILE CARD SYSTEM
  // ══════════════════════════════════════════════════════════════

  /** Map file extension → { cls, label } for icon color & text */
  function getFileTypeInfo(ext) {
    const map = {
      pdf:'fc-pdf',doc:'fc-doc',docx:'fc-doc',rtf:'fc-doc',odt:'fc-doc',
      ppt:'fc-ppt',pptx:'fc-ppt',odp:'fc-ppt',key:'fc-ppt',
      xls:'fc-xls',xlsx:'fc-xls',csv:'fc-xls',tsv:'fc-xls',ods:'fc-xls',
      png:'fc-img',jpg:'fc-img',jpeg:'fc-img',gif:'fc-img',webp:'fc-img',
      bmp:'fc-img',ico:'fc-img',tiff:'fc-img',svg:'fc-img',
      js:'fc-code',ts:'fc-code',jsx:'fc-code',tsx:'fc-code',py:'fc-code',
      rb:'fc-code',php:'fc-code',go:'fc-code',rs:'fc-code',java:'fc-code',
      kt:'fc-code',swift:'fc-code',c:'fc-code',cpp:'fc-code',h:'fc-code',
      cs:'fc-code',sql:'fc-code',html:'fc-code',css:'fc-code',scss:'fc-code',
      json:'fc-code',xml:'fc-code',yaml:'fc-code',yml:'fc-code',
      txt:'fc-text',md:'fc-text',log:'fc-text',conf:'fc-text',ini:'fc-text',
      env:'fc-text',sh:'fc-text',bash:'fc-text',
      zip:'fc-arch',rar:'fc-arch',tar:'fc-arch',gz:'fc-arch','7z':'fc-arch',
    };
    return map[ext.toLowerCase()] || 'fc-other';
  }

  /** Format bytes → human-readable */
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  }

  /** Build metadata object from a File — used for display & storage */
  function buildFileMeta(file) {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
    const typeClass = getFileTypeInfo(ext);
    const label = ext ? ext.toUpperCase() : 'FILE';
    return {
      name: file.name,
      ext,
      typeClass,
      typeLabel: label.length > 4 ? label.slice(0, 4) : label,
      sizeStr: fmtSize(file.size),
    };
  }

  /** Create a DOM element for a file card
   *  @param {Object} meta  — from buildFileMeta()
   *  @param {boolean} removable — show × button
   *  @param {number}  idx — index for remove handler
   */
  function buildFileCardEl(meta, removable, idx) {
    const card = document.createElement('div');
    card.className = 'file-card';

    const icon = document.createElement('div');
    icon.className = 'fcard-icon ' + meta.typeClass;
    icon.textContent = meta.typeLabel;

    const info = document.createElement('div');
    info.className = 'fcard-info';

    const name = document.createElement('div');
    name.className = 'fcard-name';
    name.textContent = meta.name;
    name.title = meta.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'fcard-meta';
    metaEl.textContent = meta.typeLabel + ' ' + meta.sizeStr;

    info.append(name, metaEl);
    card.append(icon, info);

    if (removable) {
      const btn = document.createElement('button');
      btn.className = 'fcard-remove';
      btn.innerHTML = IC.close;
      btn.dataset.i = idx;
      card.appendChild(btn);
    }

    return card;
  }

  /** Render file cards in input preview area */
  function renderFileCards() {
    filePreviewContainer.innerHTML = '';
    attachedFiles.forEach((file, i) => {
      const meta = buildFileMeta(file);
      const card = buildFileCardEl(meta, true, i);
      filePreviewContainer.appendChild(card);
    });
    // Wire remove buttons
    filePreviewContainer.querySelectorAll('.fcard-remove').forEach(btn => {
      onClick(btn, (e) => {
        attachedFiles.splice(parseInt(e.currentTarget.dataset.i, 10), 1);
        renderFileCards();
      });
    });
  }

  /** Render a file-card grid for a message (non-removable) */
  function buildMsgFilesGrid(filesMeta) {
    if (!filesMeta || !filesMeta.length) return null;
    const grid = document.createElement('div');
    grid.className = 'msg-files';
    filesMeta.forEach(fm => grid.appendChild(buildFileCardEl(fm, false)));
    return grid;
  }

  /** Show toast when file limit reached */
  let toastTimer = null;
  function showFileToast(msg) {
    let toast = document.querySelector('.file-limit-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'file-limit-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  // ── Read text files for chatInput embedding ─────────────────
  // Text file content is embedded in chatInput so the AI can read it.
  // Binary files get a metadata placeholder.

  async function readFilesAsText(files) {
    const parts = [];
    for (const f of files) {
      if (isTextFile(f)) {
        try {
          const content = await f.text();
          parts.push(`--- Файл: ${f.name} ---\n${content}`);
        } catch {
          parts.push(`--- Файл: ${f.name} --- (ошибка чтения)`);
        }
      } else {
        parts.push(`--- Файл: ${f.name} (${f.type || 'бинарный'}, ${fmtSize(f.size)}) --- (бинарный файл, отправлен отдельно)`);
      }
    }
    return parts.join('\n\n');
  }

  // ── Theme ────────────────────────────────────────────────────

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('afina-theme', t);
    iconMoon.style.display = t === 'dark'  ? 'block' : 'none';
    iconSun.style.display  = t === 'light' ? 'block' : 'none';
  }
  applyTheme(localStorage.getItem('afina-theme') || 'dark');
  onClick(themeBtn, () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  // ── Clear chat ──────────────────────────────────────────────

  onClick(clearBtn, () => {
    if (!turns.length && isFirstMsg) return;
    if (!confirm('Очистить историю чата? Память ИИ будет сброшена.')) return;

    if (isGenerating) {
      abortCtrl?.abort();
      try { activeReader?.cancel(); } catch {}
    }

    messagesContainer.querySelectorAll('.turn').forEach(el => el.remove());
    turns = [];

    mainSessionId   = genId();
    activeSessionId = mainSessionId;
    isFirstMsg = true;

    const existing = document.getElementById('welcome-screen');
    if (existing) {
      existing.classList.remove('hidden');
    } else {
      const ws = document.createElement('div');
      ws.id = 'welcome-screen';
      ws.innerHTML = `<div class="welcome-inner">
        <svg class="logo-svg welcome-logo-large" viewBox="0 0 80 80" fill="none">
          <circle class="logo-orbit" cx="40" cy="40" r="34.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="22 11 6 11" stroke-linecap="round"/>
          <circle cx="40" cy="40" r="27" stroke="currentColor" stroke-width="0.7" opacity="0.2"/>
          <path class="logo-glyph" d="M40 18L56 62M40 18L24 62M28 48h24" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle class="logo-dot" cx="40" cy="40" r="3.5" fill="currentColor"/>
        </svg>
        <p class="welcome-hint">Задайте вопрос или прикрепите файл</p>
        <div id="welcome-content-slot"></div>
      </div>`;
      messagesContainer.appendChild(ws);
    }

    toggleUIState(false);
    abortCtrl  = null;
    activeReader = null;
  });

  // ── Mobile viewport resize ──────────────────────────────────

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      document.getElementById('my-custom-chat').style.height = `${window.visualViewport.height}px`;
      window.scrollTo(0, 0);
      scrollToBottom();
    });
  }
  inputField.addEventListener('focus', () => {
    setTimeout(() => window.scrollTo(0, 0), 50);
    setTimeout(scrollToBottom, 300);
  });

  // ── Auto-scroll ─────────────────────────────────────────────

  messagesContainer.addEventListener('scroll', () => {
    const dist = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
    autoScroll = dist <= AUTO_SCROLL_THRESHOLD;
    scrollToBottomBtn.classList.toggle('hidden', autoScroll);
  });

  function scrollToBottom() {
    if (autoScroll) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  onClick(scrollToBottomBtn, () => {
    autoScroll = true;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    scrollToBottomBtn.classList.add('hidden');
  });

  // ── Creatium slot ───────────────────────────────────────────

  const extSlot = document.querySelector('.creatium-external-slot');
  const intSlot = document.getElementById('welcome-content-slot');
  if (extSlot && intSlot) { intSlot.appendChild(extSlot); extSlot.hidden = false; }

  // ── File handling ───────────────────────────────────────────

  onClick(attachBtn, () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const incoming = Array.from(e.target.files);
    const space = MAX_FILES - attachedFiles.length;
    if (space <= 0) {
      showFileToast(`Максимум ${MAX_FILES} файлов`);
      fileInput.value = '';
      return;
    }
    if (incoming.length > space) {
      showFileToast(`Добавлено ${space} из ${incoming.length} (лимит ${MAX_FILES})`);
    }
    incoming.slice(0, space).forEach(f => attachedFiles.push(f));
    renderFileCards();
    fileInput.value = '';
    setTimeout(() => inputField.focus(), 80);
  });

  // ── Voice ───────────────────────────────────────────────────

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const rec = new SR();
    rec.lang = 'ru-RU'; rec.continuous = false;
    rec.onstart  = () => micBtn.classList.add('recording');
    rec.onend    = () => micBtn.classList.remove('recording');
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      inputField.value += (inputField.value ? ' ' : '') + t;
      inputField.dispatchEvent(new Event('input'));
    };
    onClick(micBtn, () => micBtn.classList.contains('recording') ? rec.stop() : rec.start());
  } else {
    micBtn.style.display = 'none';
  }

  // ── Input resize ────────────────────────────────────────────

  inputField.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = `${this.scrollHeight}px`;
  });
  function resetInput() { inputField.value = ''; inputField.style.height = 'auto'; }

  // ── UI state ────────────────────────────────────────────────

  function toggleUIState(gen) {
    isGenerating = gen;
    sendIcon.style.display = gen ? 'none'  : 'block';
    stopIcon.style.display = gen ? 'block' : 'none';
    typingIndicator.classList.toggle('hidden', !gen);
    if (gen) typingText.textContent = 'Формулирую ответ';
  }

  // ── Copy helper ─────────────────────────────────────────────

  function copyText(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text).catch(() => fbCopy(text));
    return Promise.resolve(fbCopy(text));
  }
  function fbCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }

  // ── Send / Stop ─────────────────────────────────────────────

  onClick(actionBtn, () => {
    if (isGenerating) {
      abortCtrl?.abort();
      try { activeReader?.cancel(); } catch {}
    } else {
      sendNewMessage();
    }
  });

  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      if (!isGenerating) sendNewMessage();
    }
  });

  // ── Context prefix for edit branches ────────────────────────

  function buildContextPrefix(upToIndex) {
    const relevant = turns.slice(Math.max(0, upToIndex - 4), upToIndex);
    if (!relevant.length) return '';
    const lines = relevant.map(t => {
      const v = t.versions[t.activeIndex];
      const botText = v.bot ? v.bot.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      return `Пользователь: ${v.user}\nАссистент: ${botText || '(нет ответа)'}`;
    });
    return `[Предыдущий контекст разговора (не отвечать на него, только учитывать):\n${lines.join('\n---\n')}\n]\n\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TURN SYSTEM
  //
  //  versions[i] = {
  //    user             : string,     // display text
  //    bot              : string,     // final HTML
  //    sessionId        : string,     // n8n session key
  //    tail             : TurnObj[],  // turns that came AFTER this version
  //    files            : File[],     // actual File objects (for FormData re-send)
  //    filesMeta        : Object[],   // display metadata [{name,ext,typeClass,typeLabel,sizeStr}]
  //    filesTextContent : string      // pre-read text content for chatInput embedding
  //  }
  // ═══════════════════════════════════════════════════════════════

  function createTurn(userText, filesMeta) {
    const turnEl = document.createElement('div');
    turnEl.className = 'turn';

    // ── User side
    const userWrapper = document.createElement('div');
    userWrapper.className = 'message-wrapper user';

    // File cards grid (above user text bubble)
    const filesGrid = buildMsgFilesGrid(filesMeta);

    const userBubble = document.createElement('div');
    userBubble.className = 'message user-message';

    const userContent = document.createElement('div');
    userContent.className = 'message-content';
    userContent.textContent = userText;

    userBubble.appendChild(userContent);

    const userActions = document.createElement('div');
    userActions.className = 'message-actions';

    const copyUserBtn = makeIcoBtn(IC.copy, 'Копировать');
    const editUserBtn = makeIcoBtn(IC.edit, 'Редактировать');

    const versionNav = document.createElement('div');
    versionNav.className = 'version-nav';
    const verPrev = document.createElement('button');
    verPrev.className = 'ver-btn'; verPrev.textContent = '‹'; verPrev.title = 'Предыдущая версия';
    const verText = document.createElement('span');
    verText.className = 'ver-text'; verText.textContent = '1 / 1';
    const verNext = document.createElement('button');
    verNext.className = 'ver-btn'; verNext.textContent = '›'; verNext.title = 'Следующая версия';
    versionNav.append(verPrev, verText, verNext);

    userActions.append(copyUserBtn, editUserBtn, versionNav);

    // Assemble user wrapper: files grid → bubble → actions
    if (filesGrid) userWrapper.appendChild(filesGrid);
    userWrapper.append(userBubble, userActions);

    // ── Bot side
    const botWrapper = document.createElement('div');
    botWrapper.className = 'message-wrapper bot generating';

    const botBubble = document.createElement('div');
    botBubble.className = 'message bot-message';

    const botContent = document.createElement('div');
    botContent.className = 'message-content';
    botContent.innerHTML = LOADING_HTML;

    botBubble.appendChild(botContent);

    const botActions = document.createElement('div');
    botActions.className = 'message-actions';
    const copyBotBtn  = makeIcoBtn(IC.copy,  'Копировать');
    const retryBotBtn = makeIcoBtn(IC.retry, 'Повторить');
    botActions.append(copyBotBtn, retryBotBtn);

    botWrapper.append(botBubble, botActions);
    turnEl.append(userWrapper, botWrapper);
    messagesContainer.appendChild(turnEl);

    const turn = {
      versions:    [{
        user: userText,
        bot: '',
        sessionId: activeSessionId,
        tail: [],
        files: [],
        filesMeta: filesMeta || [],
        filesTextContent: '',
      }],
      activeIndex: 0,
      el: {
        turn: turnEl,
        userWrapper, userBubble, userContent, userActions,
        versionNav, verText, verPrev, verNext,
        botWrapper, botContent, botActions,
        copyUserBtn, editUserBtn, copyBotBtn, retryBotBtn,
      },
    };
    turns.push(turn);

    // Wire user actions
    onClick(copyUserBtn, () => {
      copyText(turn.el.userContent.innerText.trim()).then(() => {
        copyUserBtn.innerHTML = IC.copied;
        setTimeout(() => { copyUserBtn.innerHTML = IC.copy; }, 1800);
      });
    });
    onClick(editUserBtn, () => startInlineEdit(turn));
    onClick(verPrev, () => navigateVersion(turn, -1));
    onClick(verNext, () => navigateVersion(turn,  1));

    // Wire bot actions — retry now re-sends files
    onClick(copyBotBtn, () => {
      copyText(turn.el.botContent.innerText.replace(/Остановлено\s*Продолжить/gi,'').trim()).then(() => {
        copyBotBtn.innerHTML = IC.copied;
        setTimeout(() => { copyBotBtn.innerHTML = IC.copy; }, 1800);
      });
    });
    onClick(retryBotBtn, () => {
      if (isGenerating) return;
      const v = turn.versions[turn.activeIndex];
      const files = v.files || [];
      let chatInput = v.user;
      if (v.filesTextContent) {
        chatInput = v.user + '\n\n[Прикреплённые файлы]:\n' + v.filesTextContent;
      }
      fetchBot(turn, v.user, v.sessionId, true, chatInput, null, files);
    });

    if (isMobile) {
      attachLongPress(userWrapper, turn, 'user');
      attachLongPress(botWrapper,  turn, 'bot');
    }

    autoScroll = true;
    scrollToBottom();
    return turn;
  }

  function makeIcoBtn(iconHtml, tooltip) {
    const b = document.createElement('button');
    b.className = 'icon-action-btn';
    b.dataset.tooltip = tooltip;
    b.innerHTML = iconHtml;
    return b;
  }

  // ── Version navigation ────────────────────────────────────────

  function navigateVersion(turn, dir) {
    if (isGenerating) return;
    const next = turn.activeIndex + dir;
    if (next < 0 || next >= turn.versions.length) return;

    const N = turns.indexOf(turn);

    const currentTail = turns.splice(N + 1);
    currentTail.forEach(t => { t.el.turn.style.display = 'none'; });
    turn.versions[turn.activeIndex].tail = currentTail;

    turn.activeIndex = next;
    activeSessionId = turn.versions[next].sessionId;

    const newTail = turn.versions[next].tail || [];
    newTail.forEach(t => { t.el.turn.style.display = ''; turns.push(t); });
    turn.versions[next].tail = [];

    applyVersion(turn);
  }

  function applyVersion(turn) {
    const v = turn.versions[turn.activeIndex];
    const { el } = turn;

    // Update user text
    el.userContent.textContent = v.user;

    // Update bot content
    el.botContent.innerHTML = v.bot || LOADING_HTML;

    // Update file cards grid
    const existingGrid = el.userWrapper.querySelector('.msg-files');
    if (existingGrid) existingGrid.remove();
    const newGrid = buildMsgFilesGrid(v.filesMeta);
    if (newGrid) el.userWrapper.insertBefore(newGrid, el.userBubble);

    // Update version nav
    const total = turn.versions.length;
    el.verText.textContent = `${turn.activeIndex + 1} / ${total}`;
    el.verPrev.disabled = turn.activeIndex === 0;
    el.verNext.disabled = turn.activeIndex === total - 1;

    if (total > 1) {
      el.versionNav.classList.add('visible');
      el.userActions.classList.add('always-visible');
    }
  }

  // ── Inline edit ───────────────────────────────────────────────

  function startInlineEdit(turn) {
    if (isGenerating) return;
    const { el } = turn;
    const currentVersion = turn.versions[turn.activeIndex];
    const current = currentVersion.user;

    const form = document.createElement('div');
    form.className = 'edit-form';

    // Show attached files (read-only) inside edit form
    const filesMeta = currentVersion.filesMeta || [];
    let editFilesHtml = '';
    if (filesMeta.length) {
      editFilesHtml = '<div class="edit-files"></div>';
    }

    form.innerHTML = `${editFilesHtml}<textarea class="edit-textarea" rows="1"></textarea>
      <div class="edit-form-actions">
        <button class="edit-cancel-btn">Отмена</button>
        <button class="edit-send-btn">Отправить</button>
      </div>`;

    // Populate edit-files with card elements
    if (filesMeta.length) {
      const editFilesDiv = form.querySelector('.edit-files');
      filesMeta.forEach(fm => editFilesDiv.appendChild(buildFileCardEl(fm, false)));
    }

    const ta      = form.querySelector('.edit-textarea');
    const cancelB = form.querySelector('.edit-cancel-btn');
    const sendB   = form.querySelector('.edit-send-btn');

    ta.value = current;
    ta.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = `${this.scrollHeight}px`; });

    // Hide original content, show edit form
    el.userBubble.style.display = 'none';
    el.userActions.style.display = 'none';
    // Also hide file grid during edit (it's shown inside the form now)
    const msgGrid = el.userWrapper.querySelector('.msg-files');
    if (msgGrid) msgGrid.style.display = 'none';

    el.userWrapper.appendChild(form);

    requestAnimationFrame(() => {
      ta.focus();
      ta.style.height = `${ta.scrollHeight}px`;
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });

    onClick(cancelB, () => {
      form.remove();
      el.userBubble.style.display = '';
      el.userActions.style.display = '';
      if (msgGrid) msgGrid.style.display = '';
    });

    const doSend = () => {
      const newText = ta.value.trim();
      if (!newText) return;
      form.remove();
      el.userBubble.style.display = '';
      el.userActions.style.display = '';
      if (msgGrid) msgGrid.style.display = '';
      submitEdit(turn, newText);
    };

    onClick(sendB, doSend);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); doSend(); }
      if (e.key === 'Escape') cancelB.click();
    });
  }

  function submitEdit(turn, newText) {
    const N = turns.indexOf(turn);
    const currentVersion = turn.versions[turn.activeIndex];

    // Save turns after this one into current version's tail
    const savedTail = turns.splice(N + 1);
    savedTail.forEach(t => { t.el.turn.style.display = 'none'; });
    currentVersion.tail = savedTail;

    // New branch sessionId
    const branchSession = mainSessionId + '_b' + genId();

    // ── CARRY FORWARD FILES from current version ──
    const files            = currentVersion.files || [];
    const filesMeta        = currentVersion.filesMeta || [];
    const filesTextContent = currentVersion.filesTextContent || '';

    turn.versions.push({
      user: newText,
      bot: '',
      sessionId: branchSession,
      tail: [],
      files,
      filesMeta,
      filesTextContent,
    });
    turn.activeIndex = turn.versions.length - 1;
    activeSessionId = branchSession;

    turn.el.userContent.textContent = newText;
    applyVersion(turn);

    // Build chatInput with context prefix + files
    const prefix = buildContextPrefix(N);
    let chatInput = prefix ? prefix + 'Пользователь: ' + newText : newText;
    if (filesTextContent) {
      chatInput += '\n\n[Прикреплённые файлы]:\n' + filesTextContent;
    }

    fetchBot(turn, newText, branchSession, false, chatInput, null, files);
  }

  // ═══════════════════════════════════════════════════════════════
  //  CORE FETCH — streaming bot response
  //
  //  When files[] is non-empty, sends FormData (multipart):
  //    - chatInput  → text field (AI reads this)
  //    - sessionId  → text field
  //    - files      → actual File objects (n8n receives in $binary)
  //
  //  When no files, sends JSON as before for backward compatibility.
  // ═══════════════════════════════════════════════════════════════

  async function fetchBot(turn, userText, sessId, _isRetry, chatInput, appendCtx, files) {
    const { el } = turn;
    const payload = chatInput ?? userText;
    const sendFiles = files || [];

    abortCtrl    = new AbortController();
    activeReader = null;
    toggleUIState(true);
    autoScroll = true;

    el.botWrapper.classList.add('generating');

    let botText = '';
    const contentDiv = el.botContent;

    if (appendCtx) {
      botText = appendCtx.botText;
      contentDiv.querySelector('.stop-badge')?.remove();
    } else {
      contentDiv.innerHTML = LOADING_HTML;
    }

    scrollToBottom();

    try {
      let res;

      if (sendFiles.length > 0) {
        // ── FormData: actual files + text fields ──
        const formData = new FormData();
        formData.append('chatInput', payload);
        formData.append('sessionId', sessId);
        sendFiles.forEach(f => formData.append('files', f, f.name));

        res = await fetch(WEBHOOK_URL, {
          method:  'POST',
          headers: { 'Accept': 'text/event-stream' },
          // NO Content-Type — browser sets multipart boundary automatically
          body:    formData,
          signal:  abortCtrl.signal,
        });
      } else {
        // ── JSON: text-only messages ──
        res = await fetch(WEBHOOK_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body:    JSON.stringify({ chatInput: payload, sessionId: sessId }),
          signal:  abortCtrl.signal,
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      typingText.textContent = 'Печатает';

      const reader = res.body.getReader();
      activeReader = reader;

      const dec = new TextDecoder('utf-8');
      let buf = '', first = true, done = false;

      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;

        buf += dec.decode(value, { stream: true });
        buf = buf.replace(/}\s*{/g, '}\n{');
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          let s = line.trim();
          if (s.startsWith('data:')) s = s.slice(5).trim();
          if (!s) continue;
          if (s === '[DONE]') { done = true; break; }
          try {
            const obj = JSON.parse(s);
            if (obj.type === 'item' && obj.content !== undefined) {
              if (first && !appendCtx) { contentDiv.innerHTML = ''; first = false; }
              botText += obj.content;
              contentDiv.innerHTML = marked.parse(botText);
              scrollToBottom();
            }
          } catch { /* partial chunk */ }
        }
        if (done) break;
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        const badge = document.createElement('div');
        badge.className = 'stop-badge';
        badge.innerHTML = IC.stop + ' Остановлено ';
        const contBtn = document.createElement('button');
        contBtn.className = 'continue-btn';
        contBtn.textContent = 'Продолжить';
        // Continue does NOT re-send files — just asks the AI to keep going
        onClick(contBtn, () => fetchBot(turn, userText, sessId, false, 'Продолжи', { botText }, []));
        badge.appendChild(contBtn);
        contentDiv.appendChild(badge);
      } else {
        console.error('[Chat] fetch error:', err);
        contentDiv.textContent = 'Произошла ошибка связи с сервером.';
      }
    } finally {
      try { await activeReader?.cancel(); } catch {}
      activeReader = null;

      turn.versions[turn.activeIndex].bot = contentDiv.innerHTML;

      if (!botText && !appendCtx && contentDiv.querySelector('.bot-loading')) {
        contentDiv.innerHTML = '<em style="color:var(--text-muted)">Ответ не получен</em>';
        turn.versions[turn.activeIndex].bot = contentDiv.innerHTML;
      }

      toggleUIState(false);
      el.botWrapper.classList.remove('generating');
      abortCtrl = null;
    }
  }

  // ── Top-level send ────────────────────────────────────────────

  async function sendNewMessage() {
    const text = inputField.value.trim();
    if (!text && !attachedFiles.length) return;

    if (isFirstMsg) {
      isFirstMsg = false;
      const ws = document.getElementById('welcome-screen');
      if (ws) { ws.classList.add('hidden'); setTimeout(() => ws.remove(), 360); }
    }

    // Snapshot files & clear input
    const files = [...attachedFiles];
    resetInput();
    attachedFiles = [];
    renderFileCards();

    // Build file metadata for display
    const filesMeta = files.map(f => buildFileMeta(f));

    // Read text content for chatInput embedding
    let filesTextContent = '';
    let chatInput = text;
    if (files.length) {
      filesTextContent = await readFilesAsText(files);
      chatInput = text
        ? `${text}\n\n[Прикреплённые файлы]:\n${filesTextContent}`
        : `[Прикреплённые файлы]:\n${filesTextContent}`;
    }

    const displayText = text || 'Отправлен файл';
    const turn = createTurn(displayText, filesMeta);

    // Store files, metadata, and text content in version for re-send on edit/retry
    turn.versions[0].files            = files;
    turn.versions[0].filesMeta        = filesMeta;
    turn.versions[0].filesTextContent = filesTextContent;

    await fetchBot(turn, displayText, activeSessionId, false, chatInput, null, files);
  }

  // ── Long-press (mobile) ─────────────────────────────────────

  function attachLongPress(wrapper, turn, sender) {
    let timer = null;
    wrapper.addEventListener('touchstart', () => {
      wrapper.classList.add('press-active');
      timer = setTimeout(() => { wrapper.classList.remove('press-active'); showCtx(turn, sender); }, 500);
    }, { passive: true });
    const cancel = () => { clearTimeout(timer); wrapper.classList.remove('press-active'); };
    wrapper.addEventListener('touchend',    cancel, { passive: true });
    wrapper.addEventListener('touchmove',   cancel, { passive: true });
    wrapper.addEventListener('touchcancel', cancel, { passive: true });
  }

  let ctxStartY = 0;
  function showCtx(turn, sender) {
    ctxTarget = { turn, sender };
    ctxEditBtn.classList.toggle('hidden',  sender !== 'user');
    ctxRetryBtn.classList.toggle('hidden', sender !== 'bot');
    ctxOverlay.classList.remove('hidden');
    ctxMenu.classList.remove('hidden');
  }
  function hideCtx() {
    ctxOverlay.classList.add('hidden');
    ctxMenu.classList.add('hidden');
    ctxTarget = null;
  }

  ctxOverlay.addEventListener('click', hideCtx);
  ctxMenu.addEventListener('touchstart', (e) => { ctxStartY = e.touches[0].clientY; }, { passive: true });
  ctxMenu.addEventListener('touchmove',  (e) => { if (e.touches[0].clientY - ctxStartY > 60) hideCtx(); }, { passive: true });

  onClick(ctxCopyBtn, () => {
    if (!ctxTarget) return;
    const { turn, sender } = ctxTarget;
    const t = sender === 'user'
      ? turn.el.userContent.innerText.trim()
      : turn.el.botContent.innerText.replace(/Остановлено\s*Продолжить/gi,'').trim();
    copyText(t); hideCtx();
  });

  onClick(ctxEditBtn, () => {
    if (!ctxTarget) return;
    const t = ctxTarget.turn; hideCtx();
    setTimeout(() => startInlineEdit(t), 200);
  });

  onClick(ctxRetryBtn, () => {
    if (!ctxTarget) return;
    const t = ctxTarget.turn; hideCtx();
    if (!isGenerating) {
      const v = t.versions[t.activeIndex];
      const files = v.files || [];
      let chatInput = v.user;
      if (v.filesTextContent) {
        chatInput = v.user + '\n\n[Прикреплённые файлы]:\n' + v.filesTextContent;
      }
      fetchBot(t, v.user, v.sessionId, true, chatInput, null, files);
    }
  });

});