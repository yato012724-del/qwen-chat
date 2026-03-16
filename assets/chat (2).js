/* ═══════════════════════════════════════════════════════
   NOVA AI — Chat Engine v1.0
   Multi-chat, sidebar, search, deep think, file handling
═══════════════════════════════════════════════════════ */
(function(){'use strict';

/* ── CONFIG ── */
const TOOLS_URL = 'https://n8n.myserverdomen.store/webhook/tools';
const CHAT_URL  = 'https://n8n.myserverdomen.store/webhook/my-custom-chat';
const MAX_MB = 10;
const WEBLLM_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
const STORE_KEY = 'nova_chats';
const SETTINGS_KEY = 'nova_settings';
const MAX_HISTORY = 30; // messages to keep in context (15 pairs)

const today = new Date();
const DATE_STR = today.toLocaleDateString('ru-RU', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

const SYS_BASE = `Ты — Nova AI, продвинутый ИИ-ассистент. Ты был спроектирован компанией Nova, главным разработчиком является Джавахир — талантливый инженер, создавший тебя с нуля.

Твои принципы:
- Отвечай на языке пользователя. Если пишут на русском — на русском, на английском — на английском, и т.д.
- Будь дружелюбным, живым, с лёгким юмором. Ты не робот и не зануда — ты классный собеседник.
- Используй **форматирование**: жирный, заголовки, списки, эмодзи — там где уместно.
- Не будь нравоучительным. Не добавляй оговорки вроде "помните что..." если не просят.
- Если не знаешь — честно скажи, не выдумывай.
- Давай прямые, конкретные ответы. Не лей воду.
- Если прикреплён файл — внимательно прочитай его содержимое и работай с ним.

Сегодня: ${DATE_STR}`;

const SYS_DEEP = `\n\nРЕЖИМ ГЛУБОКОГО МЫШЛЕНИЯ:
Перед ответом:
1. Разбери вопрос на составные части
2. Рассмотри разные точки зрения
3. Проверь логику
4. Дай развёрнутый, обоснованный ответ
Используй маркер <think>...</think> для внутренних рассуждений (пользователь их не увидит), затем дай финальный ответ.`;

const SYS_SEARCH = `\n\nРЕЖИМ ПОИСКА:
Ты ДОЛЖЕН найти актуальную информацию. Вставь команду: [SEARCH: запрос]
Запрос пиши коротко и точно, на языке в котором будет больше результатов.
Не угадывай — ищи. После получения результатов дай ответ основанный ТОЛЬКО на найденных данных.
ВАЖНО: указывай источники.`;

const SYS_LOCAL = SYS_BASE + `\nВАЖНО: Когда нужна актуальная информация — вставь [SEARCH: запрос]. НЕ угадывай.`;

/* ── DOM ── */
const $ = id => document.getElementById(id);
const nova = $('nova');
const sidebar = $('nova-sidebar');
const sbOverlay = $('nova-sb-overlay');
const sbChats = $('nova-sb-chats');
const msgs = $('nova-msgs');
const input = $('nova-input');
const sendBtn = $('nova-send');
const sendIcon = $('nova-sic');
const stopIcon = $('nova-pic');
const attBtn = $('nova-att');
const micBtn = $('nova-mic');
const wave = $('nova-wave');
const wrap = $('nova-input-wrap');
const pills = $('nova-pills');
const fi = $('nova-fi');
const scrollDn = $('nova-scroll-dn');
const status = $('nova-h-status');
const header = $('nova-header');
const dlBar = $('nova-dl-bar');
const themeBtn = $('nova-theme-btn');
const menuBtn = $('nova-menu-btn');
const settingsBtn = $('nova-settings-btn');
const toggleThink = $('nova-toggle-think');
const toggleSearch = $('nova-toggle-search');

/* ── STATE ── */
let autoScroll = true, isGen = false, abortCtrl = null;
let attached = [], lastTxt = '', lastFiles = [];
let deepThink = false, forceSearch = false;
let mode = loadSettings().mode || 'server';
let engine = null, engineReady = false, wllmAbort = false;

// Multi-chat state
let allChats = []; // [{id, title, created, exchanges, chatHistory}]
let activeChatId = null;
let exchanges = [];
let chatHistory = [];

const isMob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window);
if(typeof marked !== 'undefined') marked.setOptions({breaks:true, gfm:true});

/* ── UTILS ── */
function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); }
function md(t){ return typeof marked !== 'undefined' ? marked.parse(t) : esc(t).replace(/\n/g,'<br>'); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ftime(){ return new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
function loadSettings(){ try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }catch{ return {}; } }
function saveSettings(s){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }catch{} }

/* Toast */
const toast = (() => {
  const el = document.createElement('div'); el.id = 'nova-toast'; nova.appendChild(el);
  let t = null;
  return (m, d=2500) => { clearTimeout(t); el.textContent = m; el.classList.add('show'); t = setTimeout(() => el.classList.remove('show'), d); };
})();

/* ═══ THEME ═══ */
(function(){
  applyTheme(localStorage.getItem('nova-theme') || 'light');
})();
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  document.body.style.background = t === 'dark' ? '#0a0a0f' : '';
  localStorage.setItem('nova-theme', t);
  const sun = themeBtn?.querySelector('.i-sun');
  const moon = themeBtn?.querySelector('.i-moon');
  if(sun) sun.style.display = t === 'dark' ? 'none' : 'block';
  if(moon) moon.style.display = t === 'dark' ? 'block' : 'none';
}
if(themeBtn) themeBtn.onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

/* ═══ SIDEBAR ═══ */
function openSidebar(){ sidebar.classList.add('open'); sbOverlay.classList.add('show'); renderChatList(); }
function closeSidebar(){ sidebar.classList.remove('open'); sbOverlay.classList.remove('show'); }
if(menuBtn) menuBtn.onclick = openSidebar;
if(sbOverlay) sbOverlay.onclick = closeSidebar;
$('nova-sb-close-btn')?.addEventListener('click', closeSidebar);

$('nova-sb-new-btn')?.addEventListener('click', () => { createNewChat(); closeSidebar(); });

function renderChatList(){
  if(!sbChats) return;
  sbChats.innerHTML = '';
  const sorted = [...allChats].sort((a,b) => b.created - a.created);
  sorted.forEach(ch => {
    const el = document.createElement('div');
    el.className = 'nova-chat-item' + (ch.id === activeChatId ? ' active' : '');
    el.innerHTML = `
      <div class="nova-chat-item-icon"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></div>
      <div class="nova-chat-item-text">
        <div class="nova-chat-item-title">${esc(ch.title || 'Новый чат')}</div>
        <div class="nova-chat-item-date">${new Date(ch.created).toLocaleDateString('ru-RU')}</div>
      </div>
      <div class="nova-chat-item-del" data-id="${ch.id}"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></div>`;
    el.addEventListener('click', (e) => {
      if(e.target.closest('.nova-chat-item-del')) return;
      switchChat(ch.id);
      closeSidebar();
    });
    el.querySelector('.nova-chat-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(ch.id);
    });
    sbChats.appendChild(el);
  });
}

/* ═══ MULTI-CHAT ═══ */
function createNewChat(noSwitch){
  saveCurrentChat();
  const ch = { id: uid(), title: '', created: Date.now(), exchanges: [], chatHistory: [] };
  allChats.push(ch);
  if(!noSwitch){
    activeChatId = ch.id;
    exchanges = [];
    chatHistory = [];
    rebuildUI();
  }
  saveAll();
  renderChatList();
  return ch.id;
}

function switchChat(id){
  if(id === activeChatId) return;
  if(isGen) return toast('Подождите завершения');
  saveCurrentChat();
  activeChatId = id;
  const ch = allChats.find(c => c.id === id);
  if(!ch) return;
  exchanges = ch.exchanges || [];
  chatHistory = ch.chatHistory || [];
  rebuildUI();
  renderChatList();
}

function deleteChat(id){
  allChats = allChats.filter(c => c.id !== id);
  if(id === activeChatId){
    if(allChats.length) switchChat(allChats[allChats.length-1].id);
    else createNewChat();
  }
  saveAll();
  renderChatList();
}

function saveCurrentChat(){
  const ch = allChats.find(c => c.id === activeChatId);
  if(!ch) return;
  ch.exchanges = exchanges.map(e => ({
    versions: e.versions.map(v => ({ text: v.text, filesInfo: v.filesInfo || [], botHTML: v.botHTML || '' })),
    vi: e.vi
  }));
  ch.chatHistory = chatHistory.slice(-MAX_HISTORY);
  // Auto title from first message
  if(!ch.title && exchanges.length){
    const first = exchanges[0]?.versions[0]?.text || '';
    ch.title = first.substring(0,40) || 'Чат';
  }
}

function rebuildUI(){
  msgs.innerHTML = '';
  if(!exchanges.length){
    msgs.appendChild(createWelcome());
    return;
  }
  exchanges.forEach((ex, i) => {
    const v = ex.versions[ex.vi];
    if(!v) return;
    const um = addMsg(v.text, 'user', v.filesInfo || [], i);
    ex.domUser = um.wrap;
    const bm = addMsg('', 'bot');
    ex.domBot = bm.cnt;
    if(v.botHTML){
      bm.cnt.innerHTML = v.botHTML;
      enhCode(bm.cnt);
    } else {
      bm.cnt.innerHTML = '<em style="color:var(--t3)">—</em>';
    }
    bm.wrap.classList.remove('gen');
  });
  scrollBot(true);
}

/* ═══ STORAGE ═══ */
function saveAll(){
  saveCurrentChat();
  try{
    const data = allChats.map(ch => ({
      id: ch.id, title: ch.title, created: ch.created,
      exchanges: (ch.exchanges||[]).map(e => ({
        versions: e.versions.map(v => ({ text:v.text, filesInfo:v.filesInfo||[], botHTML:v.botHTML||'' })),
        vi: e.vi
      })),
      chatHistory: (ch.chatHistory||[]).slice(-MAX_HISTORY)
    }));
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }catch(e){ console.warn('save err', e); }
}

function loadAll(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(!Array.isArray(data) || !data.length) return;
    allChats = data.map(ch => ({
      ...ch,
      exchanges: (ch.exchanges||[]).map(e => ({
        versions: e.versions.map(v => ({...v, fileObjects:[]})),
        vi: e.vi, domUser: null, domBot: null
      })),
      chatHistory: ch.chatHistory || []
    }));
  }catch(e){ console.warn('load err', e); }
}

/* ═══ EXPORT / IMPORT ═══ */
$('nova-sb-export')?.addEventListener('click', () => {
  saveCurrentChat();
  const ch = allChats.find(c => c.id === activeChatId);
  if(!ch || !ch.exchanges?.length){ toast('Нечего экспортировать'); return; }
  const blob = new Blob([JSON.stringify(ch, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nova-chat-${ch.title?.replace(/[^a-zA-Zа-яА-Я0-9]/g,'_')||'export'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Чат экспортирован');
  closeSidebar();
});

$('nova-sb-import')?.addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = (e) => {
    const f = e.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        const data = JSON.parse(r.result);
        if(!data.id || !data.exchanges) throw new Error('bad format');
        data.id = uid(); // new id to avoid collision
        data.created = Date.now();
        data.exchanges = (data.exchanges||[]).map(ex => ({
          ...ex, domUser:null, domBot:null,
          versions: ex.versions.map(v => ({...v, fileObjects:[]}))
        }));
        allChats.push(data);
        switchChat(data.id);
        saveAll();
        toast('Чат импортирован');
        closeSidebar();
      }catch(err){ toast('Ошибка формата файла'); }
    };
    r.readAsText(f);
  };
  inp.click();
});

/* ═══ MODE / STATUS ═══ */
function setStatus(t, c){
  if(!status) return;
  status.textContent = t;
  status.className = 'nova-h-status';
  if(c) status.classList.add(c);
}
function updMode(){
  const labels = {server:'онлайн', webgpu:'локально'};
  setStatus(labels[mode] || 'онлайн', 'ok');
}

/* ═══ SETTINGS MODAL ═══ */
if(settingsBtn) settingsBtn.onclick = showSettings;
function showSettings(){
  if($('nova-mode-modal')) return;
  const hasGPU = !!navigator.gpu;
  const m = document.createElement('div');
  m.id = 'nova-mode-modal';
  m.innerHTML = `
    <div class="nova-modal-card">
      <div class="nova-modal-title">Режим работы</div>
      <div class="nova-modal-desc">Выберите как будет работать Nova AI</div>
      <div class="nova-modal-opts">
        <div class="nova-modal-opt ${mode==='server'?'active':''}" data-m="server">
          <div class="nova-modal-opt-icon">☁️</div>
          <div><div class="nova-modal-opt-name">Сервер</div><div class="nova-modal-opt-desc">Быстро, все инструменты</div></div>
        </div>
        <div class="nova-modal-opt ${mode==='webgpu'?'active':''} ${!hasGPU?'disabled':''}" data-m="webgpu">
          <div class="nova-modal-opt-icon">🧠</div>
          <div><div class="nova-modal-opt-name">На устройстве${!hasGPU?' — недоступно':''}</div><div class="nova-modal-opt-desc">Приватно, модель ~1.5 ГБ</div></div>
        </div>
      </div>
      <div class="nova-modal-btns">
        <button class="nova-modal-btn nova-modal-cancel">Отмена</button>
        <button class="nova-modal-btn nova-modal-save">Сохранить</button>
      </div>
    </div>`;
  nova.appendChild(m);
  m.addEventListener('click', e => { if(e.target === m) m.remove(); });
  m.querySelector('.nova-modal-cancel').onclick = () => m.remove();
  m.querySelectorAll('.nova-modal-opt').forEach(o => {
    o.onclick = () => {
      if(o.classList.contains('disabled')) return;
      m.querySelectorAll('.nova-modal-opt').forEach(x => x.classList.remove('active'));
      o.classList.add('active');
    };
  });
  m.querySelector('.nova-modal-save').onclick = () => {
    const sel = m.querySelector('.nova-modal-opt.active');
    const nM = sel?.dataset.m || 'server';
    if(nM !== mode){
      mode = nM;
      saveSettings({mode});
      if(mode === 'webgpu' && !engineReady) initWLLM();
      if(mode === 'server'){ engine = null; engineReady = false; }
      updMode();
      toast(mode === 'server' ? 'Режим: Сервер' : 'Режим: На устройстве');
    }
    m.remove();
  };
}

/* ═══ DEEP THINK / SEARCH TOGGLES ═══ */
if(toggleThink) toggleThink.onclick = () => {
  deepThink = !deepThink;
  toggleThink.classList.toggle('active', deepThink);
};
if(toggleSearch) toggleSearch.onclick = () => {
  forceSearch = !forceSearch;
  toggleSearch.classList.toggle('active', forceSearch);
};

/* ═══ WebLLM ═══ */
async function initWLLM(){
  if(!navigator.gpu){ toast('WebGPU не поддерживается'); mode='server'; saveSettings({mode}); updMode(); return; }
  wllmAbort = false;
  try{
    setStatus('загрузка модели...','busy');
    showDL(0,'Инициализация...');
    const wl = await import('https://esm.run/@mlc-ai/web-llm');
    if(wllmAbort){ hideDL(); return; }
    engine = await wl.CreateMLCEngine(WEBLLM_MODEL, {
      initProgressCallback: r => {
        if(wllmAbort) return;
        showDL(Math.round((r.progress||0)*100), r.text||'Загрузка...');
      }
    });
    if(wllmAbort){ engine=null; hideDL(); return; }
    hideDL(); engineReady = true; updMode();
    toast('Модель загружена!');
  }catch(e){
    console.error('[WL]',e); hideDL();
    mode='server'; saveSettings({mode}); updMode();
    toast('Ошибка → режим сервера');
  }
}

/* Download progress — sticky bar */
function showDL(pct, txt){
  if(!dlBar) return;
  dlBar.classList.add('show');
  dlBar.querySelector('.nova-dl-text').textContent = txt;
  dlBar.querySelector('.nova-dl-fill').style.width = pct + '%';
  dlBar.querySelector('.nova-dl-pct').textContent = pct + '%';
}
function hideDL(){ if(dlBar) dlBar.classList.remove('show'); }
$('nova-dl-cancel-btn')?.addEventListener('click', () => {
  wllmAbort = true;
  hideDL();
  mode = 'server'; saveSettings({mode}); updMode();
  engine = null; engineReady = false;
  toast('Загрузка отменена');
});

/* ═══ TOOL CALLS ═══ */
async function callTool(name, params){
  try{
    const r = await fetch(TOOLS_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({tool:name, params:params||{}})
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  }catch(e){ return {error:e.message}; }
}

/* ═══ VIEWPORT ═══ */
let lRAF = null;
function updLayout(){
  if(lRAF) cancelAnimationFrame(lRAF);
  lRAF = requestAnimationFrame(() => {
    lRAF = null;
    const vv = window.visualViewport;
    const vpH = vv ? vv.height : window.innerHeight;
    nova.style.height = vpH + 'px';
    const bot = $('nova-bottom');
    nova.style.setProperty('--bot-h', (bot ? bot.offsetHeight : 80) + 'px');
  });
}
updLayout();
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', updLayout, {passive:true});
  window.visualViewport.addEventListener('scroll', updLayout, {passive:true});
}
window.addEventListener('resize', updLayout, {passive:true});
input?.addEventListener('focus', () => { setTimeout(updLayout,100); setTimeout(updLayout,300); });
input?.addEventListener('blur', () => setTimeout(updLayout,100));

/* ═══ SCROLL ═══ */
msgs?.addEventListener('scroll', () => {
  const d = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
  autoScroll = d <= 24;
  scrollDn?.classList.toggle('on', d > 100);
  header?.classList.toggle('scrolled', msgs.scrollTop > 10);
}, {passive:true});
function scrollBot(force){
  if(autoScroll || force){
    try{ msgs.scrollTo({top:msgs.scrollHeight, behavior:'smooth'}); }
    catch{ msgs.scrollTop = msgs.scrollHeight; }
  }
}
if(scrollDn) scrollDn.onclick = () => { autoScroll = true; scrollBot(true); };

/* ═══ TEXTAREA AUTO-RESIZE ═══ */
input?.addEventListener('input', function(){
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  updLayout();
});
function resetInput(){ if(input){ input.value=''; input.style.height='auto'; } }

/* ═══ FILES ═══ */
if(attBtn) attBtn.onclick = () => fi?.click();
if(fi) fi.onchange = e => { addFiles(Array.from(e.target.files)); fi.value = ''; };

function addFiles(files){
  let rejected = 0;
  files.forEach(f => { if(f.size <= MAX_MB*1024*1024) attached.push(f); else rejected++; });
  if(rejected) toast(rejected + ' файл(ов) > ' + MAX_MB + ' МБ');
  renderPills();
}
function renderPills(){
  if(!pills) return;
  pills.innerHTML = '';
  attached.forEach((f,i) => {
    const d = document.createElement('div');
    d.className = 'nova-pill';
    d.innerHTML = `<svg viewBox="0 0 24 24">${fileIcon(f)}</svg><span class="nova-pill-name" title="${esc(f.name)}">${esc(f.name)}</span><div class="nova-pill-rm" data-i="${i}"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></div>`;
    pills.appendChild(d);
  });
  pills.querySelectorAll('.nova-pill-rm').forEach(b => {
    b.onclick = () => { attached.splice(+b.dataset.i, 1); renderPills(); };
  });
  updLayout();
}

const FI_IMG = '<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>';
const FI_PDF = '<path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>';
const FI_DOC = '<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>';
function fileIcon(f){ if(f.type?.startsWith('image/')) return FI_IMG; if(f.type?.includes('pdf')) return FI_PDF; return FI_DOC; }
function fileIconByName(n){ if(/\.(png|jpg|jpeg|gif|webp)$/i.test(n)) return FI_IMG; if(/\.pdf$/i.test(n)) return FI_PDF; return FI_DOC; }

/* File reading */
const TXT_RE = /\.(txt|md|csv|json|yaml|yml|xml|py|js|ts|html|css|sh|log|sql|env|ini|conf|toml|c|cpp|h|java|rb|go|rs|swift|kt)$/i;
const TXT_MT = ['text/', 'application/json', 'application/xml', 'application/javascript'];
function isTextFile(f){ return TXT_MT.some(m => f.type?.startsWith(m)) || TXT_RE.test(f.name); }
function readText(f){ return new Promise((ok,er) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = er; r.readAsText(f,'utf-8'); }); }
function readBase64(f){ return new Promise((ok,er) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = er; r.readAsDataURL(f); }); }

/* DnD */
let dc = 0;
nova.addEventListener('dragenter', e => { e.preventDefault(); dc++; nova.classList.add('drag'); });
nova.addEventListener('dragleave', () => { if(--dc <= 0){ dc=0; nova.classList.remove('drag'); } });
nova.addEventListener('dragover', e => e.preventDefault());
nova.addEventListener('drop', e => { e.preventDefault(); dc=0; nova.classList.remove('drag'); addFiles(Array.from(e.dataTransfer.files)); });
document.addEventListener('paste', e => { if(e.clipboardData?.files?.length) addFiles(Array.from(e.clipboardData.files)); });

/* ═══ CODE HIGHLIGHT ═══ */
function enhCode(el){
  el.querySelectorAll('pre').forEach(pre => {
    if(pre.querySelector('.nova-pre-hdr')) return;
    const code = pre.querySelector('code');
    const cls = [...(code?.classList||[])].find(c => c.startsWith('language-'));
    const lang = cls ? cls.replace('language-','') : 'code';
    const hdr = document.createElement('div');
    hdr.className = 'nova-pre-hdr';
    hdr.innerHTML = `<span class="nova-pre-lang">${esc(lang)}</span><button class="nova-pre-cp"><svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>`;
    pre.insertBefore(hdr, pre.firstChild);
    hdr.querySelector('.nova-pre-cp').onclick = () => {
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(() => {
        const b = hdr.querySelector('.nova-pre-cp');
        b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        setTimeout(() => { b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>'; }, 2000);
      });
    };
  });
}

/* ═══ UI TOGGLE ═══ */
function toggleUI(g){
  isGen = g;
  if(sendIcon) sendIcon.style.display = g ? 'none' : 'block';
  if(stopIcon) stopIcon.style.display = g ? 'block' : 'none';
  if(sendBtn) sendBtn.classList.toggle('stop', g);
  if(!g) updMode(); else setStatus('думает...','busy');
}

/* ═══ MESSAGES ═══ */
const IC_CP = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const IC_OK = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const IC_RT = '<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';

function addMsg(text, side, filesInfo=[], exIdx=null){
  const wrap = document.createElement('div');
  wrap.className = 'nova-msg ' + (side === 'user' ? 'user' : 'bot');
  if(side === 'bot') wrap.classList.add('gen');

  const bbl = document.createElement('div');
  bbl.className = 'nova-msg-bubble';
  const cnt = document.createElement('div');
  cnt.className = 'nova-cnt';

  if(side === 'bot'){
    cnt.innerHTML = '<div class="nova-dots"><span></span><span></span><span></span></div>';
  } else {
    cnt.textContent = text;
    renderFilesBubble(cnt, filesInfo);
  }
  bbl.appendChild(cnt);
  wrap.appendChild(bbl);

  const mt = document.createElement('div');
  mt.className = 'nova-msg-time';
  mt.textContent = ftime();
  wrap.appendChild(mt);

  const ac = document.createElement('div');
  ac.className = 'nova-msg-actions';

  const cpBtn = mkAct(IC_CP, 'Копировать');
  cpBtn.onclick = () => {
    const raw = getTextOnly(cnt);
    navigator.clipboard.writeText(raw).then(() => {
      cpBtn.innerHTML = IC_OK; cpBtn.classList.add('ok');
      setTimeout(() => { cpBtn.innerHTML = IC_CP; cpBtn.classList.remove('ok'); }, 2000);
    });
  };
  ac.appendChild(cpBtn);

  if(side === 'bot'){
    const rtBtn = mkAct(IC_RT, 'Повторить');
    rtBtn.onclick = () => { wrap.remove(); doSend(lastTxt, true); };
    ac.appendChild(rtBtn);
  }
  wrap.appendChild(ac);
  msgs.appendChild(wrap);
  autoScroll = true;
  scrollBot();
  return {cnt, wrap};
}

function mkAct(html, title){
  const b = document.createElement('button');
  b.className = 'nova-act';
  b.title = title;
  b.innerHTML = html;
  return b;
}

function renderFilesBubble(cnt, fi){
  if(!fi?.length) return;
  const fd = document.createElement('div');
  fd.className = 'nova-msg-files';
  fi.forEach(f => {
    const n = typeof f === 'string' ? f : (f.name || '');
    fd.innerHTML += `<span class="nova-file-tag"><svg viewBox="0 0 24 24">${fileIconByName(n)}</svg>${esc(n)}</span>`;
  });
  cnt.appendChild(fd);
}

function getTextOnly(cnt){
  const c = cnt.cloneNode(true);
  c.querySelector('.nova-msg-files')?.remove();
  return (c.textContent || '').trim();
}

/* ═══ WELCOME ═══ */
function createWelcome(){
  const d = document.createElement('div');
  d.id = 'nova-welcome';
  d.innerHTML = `
    <div class="nova-w-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></div>
    <h2 class="nova-w-title">Привет! Я <span>Nova AI</span> 👋</h2>
    <p class="nova-w-sub">Умный ассистент от Nova. Задайте вопрос, загрузите файл или выберите подсказку</p>
    <div class="nova-w-chips">
      <button class="nova-chip" data-p="write">✍️ Написать</button>
      <button class="nova-chip" data-p="task">🔍 Задача</button>
      <button class="nova-chip" data-p="file">📄 Файл</button>
      <button class="nova-chip" data-p="idea">💡 Идея</button>
    </div>`;
  d.querySelectorAll('.nova-chip').forEach(c => {
    c.onclick = () => {
      const map = {write:'Помоги написать: ', task:'Помоги разобрать: ', idea:'Подкинь идею для: ', file:null};
      if(c.dataset.p === 'file'){ fi?.click(); return; }
      if(input){ input.value = map[c.dataset.p] || ''; input.dispatchEvent(new Event('input')); input.focus(); }
    };
  });
  return d;
}

/* ═══ VOICE ═══ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if(SR && micBtn){
  const rec = new SR();
  rec.lang = 'ru-RU'; rec.continuous = false; rec.interimResults = true;
  let base = '';
  rec.onstart = () => { micBtn.classList.add('rec'); wrap?.classList.add('rec'); wave?.classList.add('on'); base = input?.value || ''; if(input) input.placeholder = '🎙 Говорите...'; };
  rec.onend = () => { micBtn.classList.remove('rec'); wrap?.classList.remove('rec'); wave?.classList.remove('on'); if(input) input.placeholder = 'Сообщение для Nova...'; input?.dispatchEvent(new Event('input')); };
  rec.onerror = e => { if(e.error !== 'aborted') console.warn('SR',e.error); };
  rec.onresult = e => {
    let fin='', inter='';
    for(let i=e.resultIndex; i<e.results.length; i++){
      const t = e.results[i][0].transcript;
      if(e.results[i].isFinal) fin += t; else inter += t;
    }
    if(fin) base += (base?' ':'') + fin.trim();
    if(input){ input.value = base + (inter ? ' '+inter : ''); input.dispatchEvent(new Event('input')); }
  };
  micBtn.onclick = () => { if(micBtn.classList.contains('rec')) rec.stop(); else rec.start(); };
} else if(micBtn) micBtn.style.display = 'none';

/* ═══ SEND ═══ */
if(sendBtn) sendBtn.onclick = () => { if(isGen){ abortCtrl?.abort(); return; } doSend(); };
input?.addEventListener('keydown', e => { if(e.key==='Enter' && !e.shiftKey && !isMob){ e.preventDefault(); if(!isGen) doSend(); } });

function doSend(mT, isRetry){
  if(isGen) return;
  const txt = mT != null ? mT : (input?.value || '').trim();
  const files = isRetry ? [...lastFiles] : [...attached];
  if(!txt && !files.length) return;

  // Remove welcome
  const wel = $('nova-welcome');
  if(wel){ wel.classList.add('out'); setTimeout(() => wel.remove(), 300); }

  // Ensure we have an active chat
  if(!activeChatId) createNewChat(true);

  lastTxt = txt;
  lastFiles = files;
  const exIdx = exchanges.length;

  if(!isRetry){
    const fileInfo = files.map(f => ({name:f.name}));
    const {cnt, wrap:w} = addMsg(txt || '📎 Файл(ы)', 'user', fileInfo, exIdx);
    exchanges.push({
      versions: [{text:txt, filesInfo:fileInfo, fileObjects:[...files], botHTML:''}],
      vi: 0, domUser: w, domBot: null
    });
  }
  resetInput();
  attached = [];
  renderPills();
  sendMsg(txt, files, exIdx);
}

/* ═══ GENERATE ═══ */
async function sendMsg(txt, files, exIdx){
  abortCtrl = new AbortController();
  toggleUI(true);
  autoScroll = true;
  scrollBot();
  const bm = addMsg('', 'bot');
  const cnt = bm.cnt, bW = bm.wrap;
  if(exchanges[exIdx]) exchanges[exIdx].domBot = cnt;

  try{
    // Build file context
    let fCtx = '';
    for(const f of files){
      if(f instanceof File){
        if(isTextFile(f)){
          try{
            const c = await readText(f);
            fCtx += `\n\n--- Файл: ${f.name} ---\n${c.substring(0, 8000)}\n--- Конец файла ---`;
          }catch{}
        } else if(f.type?.startsWith('image/')){
          try{
            const b64 = await readBase64(f);
            fCtx += `\n\n[Изображение: ${f.name} — содержимое закодировано в base64]`;
          }catch{}
        } else if(f.name.endsWith('.pdf')){
          fCtx += `\n\n[PDF файл: ${f.name} — текст не может быть извлечён на клиенте, обработайте на сервере]`;
        } else {
          try{
            const c = await readText(f);
            fCtx += `\n\n--- Файл: ${f.name} ---\n${c.substring(0, 8000)}\n--- Конец файла ---`;
          }catch{
            fCtx += `\n\n[Файл: ${f.name} — не удалось прочитать]`;
          }
        }
      }
    }

    let userContent = txt;
    if(fCtx) userContent += fCtx;

    // Build system prompt
    let sys = SYS_BASE;
    if(deepThink) sys += SYS_DEEP;
    if(forceSearch) sys += SYS_SEARCH;

    chatHistory.push({role:'user', content:userContent});

    if(mode === 'webgpu' && engineReady){
      await genLocal(userContent, sys, cnt, exIdx);
    } else {
      await genServer(userContent, sys, files, cnt, exIdx);
    }
  }catch(err){
    if(err.name === 'AbortError'){
      cnt.innerHTML += '<div class="nova-trunc"><em>⏹ Остановлено</em></div>';
    } else {
      cnt.innerHTML = `<span style="color:var(--er)">⚠️ ${esc(err.message)}</span>`;
      setStatus('ошибка','err');
    }
  }finally{
    if(exchanges[exIdx]) exchanges[exIdx].versions[exchanges[exIdx].vi].botHTML = cnt.innerHTML;
    toggleUI(false);
    bW.classList.remove('gen');
    abortCtrl = null;
    saveAll();
  }
}

/* ── LOCAL GENERATION ── */
async function genLocal(userContent, sys, cnt, exIdx){
  const localSys = sys + '\nВАЖНО: Когда нужна актуальная информация — вставь [SEARCH: запрос]. НЕ угадывай.';
  const msgList = [{role:'system', content:localSys}, ...chatHistory.slice(-MAX_HISTORY)];
  let botTxt = '', round = 0;

  while(round < 3){
    const res = await engine.chat.completions.create({messages:msgList, stream:true, temperature:0.7, max_tokens:2048});
    let ct = '';
    cnt.innerHTML = '';

    for await(const ch of res){
      if(abortCtrl?.signal.aborted) throw new DOMException('','AbortError');
      const d = ch.choices[0]?.delta?.content;
      if(d){ ct += d; botTxt = ct; cnt.innerHTML = md(ct); enhCode(cnt); scrollBot(); }
    }

    // Process [SEARCH: ...] commands
    const sm = ct.match(/\[SEARCH:\s*(.+?)\]/i);
    if(sm && round < 2){
      const q = sm[1].trim();
      cnt.innerHTML = md(ct.replace(sm[0], `*🔍 Ищу: "${q}"...*`));
      scrollBot();
      const r = await callTool('web_search', {query: q});
      const sCtx = r.result ? r.result.map(x => `${x.title}: ${x.snippet} (${x.url})`).join('\n') : 'Ничего не найдено';
      msgList.push({role:'assistant', content:ct});
      msgList.push({role:'user', content:`Результаты поиска "${q}":\n${sCtx}\n\nОтветь пользователю на основе найденных данных. Язык = язык вопроса. Укажи источники.`});
      botTxt = '';
      round++;
      continue;
    }

    // Strip <think> tags for display
    let display = botTxt.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if(display !== botTxt){
      cnt.innerHTML = md(display);
      enhCode(cnt);
    }
    chatHistory.push({role:'assistant', content:botTxt});
    break;
  }
}

/* ── SERVER GENERATION ── */
async function genServer(txt, sys, files, cnt, exIdx){
  const payload = {
    chatInput: txt,
    sessionId: activeChatId || 'default',
    systemPrompt: sys
  };

  const fOpts = {
    method: 'POST',
    signal: abortCtrl.signal,
    headers: {'Content-Type':'application/json', 'Accept':'text/event-stream'},
    body: JSON.stringify(payload)
  };

  const res = await fetch(CHAT_URL, fOpts);
  if(!res.ok) throw new Error('HTTP ' + res.status);

  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '', botTxt = '', first = true;

  while(true){
    const {done, value} = await reader.read();
    if(done) break;
    buf += dec.decode(value, {stream:true});
    buf = buf.replace(/}\s*\{/g, '}\n{');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for(const raw of lines){
      let ln = raw.trim();
      if(ln.startsWith('data:')) ln = ln.slice(5).trim();
      if(!ln || ln === '[DONE]') continue;
      try{
        const o = JSON.parse(ln);
        const ch = o.content ?? o.message ?? o.text ?? o.output ?? o.delta ?? null;
        if(ch !== null){
          if(first){ cnt.innerHTML = ''; first = false; }
          botTxt += ch;
          cnt.innerHTML = md(botTxt);
          enhCode(cnt);
          scrollBot();
        }
      }catch{}
    }
  }

  // Process remaining buffer
  if(buf.trim()){
    let ln = buf.trim();
    if(ln.startsWith('data:')) ln = ln.slice(5).trim();
    if(ln && ln !== '[DONE]'){
      try{
        const o = JSON.parse(ln);
        const ch = o.content ?? o.message ?? o.text ?? o.output ?? null;
        if(ch){ if(first) cnt.innerHTML = ''; botTxt += ch; cnt.innerHTML = md(botTxt); enhCode(cnt); scrollBot(); }
      }catch{}
    }
  }

  chatHistory.push({role:'assistant', content:botTxt});
}

/* ═══ INIT ═══ */
function init(){
  loadAll();
  if(!allChats.length) createNewChat(true);
  activeChatId = activeChatId || allChats[allChats.length-1]?.id;
  const ch = allChats.find(c => c.id === activeChatId);
  if(ch){
    exchanges = ch.exchanges || [];
    chatHistory = ch.chatHistory || [];
  }
  rebuildUI();
  updMode();
  if(mode === 'webgpu') initWLLM();
  renderChatList();
}

setTimeout(init, 50);

})();