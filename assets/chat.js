/* ══════════════════════════════════════
   NOVA AI — Chat Engine v1.0
   • Nova AI identity & personality
   • Sidebar, deep think, search toggle
   • File handling fix
   • Better search with date context
   • Memory: 15 messages
══════════════════════════════════════ */
(function(){'use strict';

const TOOLS_URL='https://n8n.myserverdomen.store/webhook/tools';
const CHAT_URL='https://n8n.myserverdomen.store/webhook/my-custom-chat';
const STORE='nv_chats';const SETTINGS='nv_set';const MAX_MB=10;
const WEBLLM_MODEL='Qwen2.5-3B-Instruct-q4f16_1-MLC';

const TODAY=new Date();
const DATE_STR=TODAY.toLocaleDateString('ru-RU',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

const SYS=`Ты — Nova AI, умный и дружелюбный ИИ-ассистент. Тебя создала компания Nova, разработчик — Джавахир.
Отвечай на языке пользователя. Если пишут на русском — на русском, на английском — на английском.
Используй эмодзи умеренно, **жирный** для ключевого, заголовки и списки когда уместно.
Будь живым и интересным собеседником, не как робот. Можешь шутить, быть неформальным.
НЕ начинай ответ с "Конечно!" или "Разумеется!". Просто отвечай по делу.
Не будь занудой — если пользователь матерится, не читай нотации, просто общайся нормально.
Сегодня: ${DATE_STR}. Текущий год: ${TODAY.getFullYear()}.`;

const SYS_LOCAL=SYS+`
ИНСТРУМЕНТЫ: Когда тебе нужна актуальная информация, новости, цены, факты — ОБЯЗАТЕЛЬНО напиши: [SEARCH: запрос]
Запрос формулируй конкретно, включай год ${TODAY.getFullYear()} если нужна актуальность.
Примеры: [SEARCH: цена Chevrolet Cobalt 2024 Узбекистан] или [SEARCH: курс доллара к суму сегодня]
НЕ выдумывай данные. Сначала ищи, потом отвечай на основе результатов.`;

/* ── DOM ── */
const G=id=>document.getElementById(id);
const qc=G('qc'),qcMsgs=G('qc-msgs'),qcIn=G('qc-in'),qcSend=G('qc-send'),qcSic=G('qc-sic'),qcPic=G('qc-pic'),qcAtt=G('qc-att'),qcMic=G('qc-mic'),qcWave=G('qc-wave'),qcWrap=G('qc-wrap'),qcPills=G('qc-pills'),qcFI=G('qc-fi'),qcDn=G('qc-dn'),qcStat=G('qc-stat');
const sidebar=G('nv-sidebar'),sbOverlay=G('nv-sb-overlay'),sbChats=G('nv-sb-chats');
const nvThink=G('nv-think'),nvSearch=G('nv-search');
const nvProgress=G('nv-progress'),nvProgFill=G('nv-prog-fill'),nvProgText=G('nv-prog-text'),nvProgPct=G('nv-prog-pct');

/* ── STATE ── */
let sid=gSid(),autoScroll=true,abortCtrl=null,isGen=false;
let attached=[],lastFiles=[],isFirst=true,lastTxt='';
let deepThink=false,forceSearch=false;
let exchanges=[],chatHistory=[];
let mode=loadS().mode||'server',engine=null,engineReady=false,wllmAbort=false;
const isMob=/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)||('ontouchstart' in window);

function gSid(){return crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36)}
if(typeof marked!=='undefined')marked.setOptions({breaks:true,gfm:true});
function md(t){return typeof marked!=='undefined'?marked.parse(t):esc(t).replace(/\n/g,'<br>')}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function ftime(){return new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}

/* Toast */
const toast=(()=>{let el=G('qc-toast');if(!el){el=document.createElement('div');el.id='qc-toast';document.body.appendChild(el);}let t;return(m,d=3000)=>{clearTimeout(t);el.textContent=m;el.classList.add('show');t=setTimeout(()=>el.classList.remove('show'),d)}})();

function loadS(){try{return JSON.parse(localStorage.getItem(SETTINGS))||{}}catch{return{}}}
function saveS(s){try{localStorage.setItem(SETTINGS,JSON.stringify(s))}catch{}}

/* ══ SIDEBAR ══ */
G('nv-menu-btn').onclick=()=>{sidebar.classList.add('open');sbOverlay.classList.add('on')};
G('nv-sb-close').onclick=closeSB;
sbOverlay.onclick=closeSB;
function closeSB(){sidebar.classList.remove('open');sbOverlay.classList.remove('on')}

G('nv-sb-new').onclick=()=>{closeSB();newChat()};
G('nv-sb-clear').onclick=()=>{if(!confirm('Очистить чат?'))return;closeSB();clearChat()};

/* Theme */
(function(){applyTheme(localStorage.getItem('nv-theme')||'light')})();
G('nv-sb-theme').onclick=()=>applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');
function applyTheme(t){const dk=t==='dark';qc.classList.toggle('dk',dk);document.documentElement.setAttribute('data-theme',t);document.body.classList.toggle('dk',dk);localStorage.setItem('nv-theme',t);
const s=G('nv-sb-theme');if(s){s.querySelector('.i-sun').style.display=dk?'none':'block';s.querySelector('.i-moon').style.display=dk?'block':'none'}}

/* Mode */
G('nv-sb-mode').onclick=()=>{closeSB();showSettings()};
function updMode(){G('nv-mode-label').textContent=mode==='server'?'☁️ Сервер':'🧠 Устройство';setSt(mode==='server'?'сервер':'устройство','ok')}
function setSt(t,c){if(!qcStat)return;qcStat.textContent=t;qcStat.className='';if(c==='busy')qcStat.classList.add('busy');if(c==='err')qcStat.classList.add('err')}

/* ── Settings Modal ── */
function showSettings(){if(G('qc-settings-modal'))return;const hGPU=!!navigator.gpu;
const m=document.createElement('div');m.id='qc-settings-modal';
m.innerHTML=`<div class="qc-sm-bg"></div><div class="qc-sm-card"><div class="qc-sm-title">Режим работы</div><div class="qc-sm-opts">
<label class="qc-sm-opt ${mode==='server'?'active':''}"><input type="radio" name="qcmode" value="server" ${mode==='server'?'checked':''}><div class="qc-sm-oi">☁️</div><div><div class="qc-sm-on">Сервер</div><div class="qc-sm-od">Быстро, все инструменты</div></div></label>
<label class="qc-sm-opt ${mode==='webgpu'?'active':''} ${!hGPU?'disabled':''}"><input type="radio" name="qcmode" value="webgpu" ${mode==='webgpu'?'checked':''} ${!hGPU?'disabled':''}><div class="qc-sm-oi">🧠</div><div><div class="qc-sm-on">На устройстве${!hGPU?' (недоступно)':''}</div><div class="qc-sm-od">Приватно, модель ~1.5 ГБ</div></div></label>
</div><div class="qc-sm-btns"><button class="qc-sm-cancel">Отмена</button><button class="qc-sm-save">Сохранить</button></div></div>`;
qc.appendChild(m);
m.querySelector('.qc-sm-bg').onclick=()=>m.remove();
m.querySelector('.qc-sm-cancel').onclick=()=>m.remove();
m.querySelectorAll('.qc-sm-opt').forEach(o=>{o.onclick=()=>{if(o.classList.contains('disabled'))return;m.querySelectorAll('.qc-sm-opt').forEach(x=>x.classList.remove('active'));o.classList.add('active');o.querySelector('input').checked=true}});
m.querySelector('.qc-sm-save').onclick=()=>{const nM=m.querySelector('input[name=qcmode]:checked')?.value||'server';if(nM!==mode){mode=nM;saveS({mode});if(mode==='webgpu'&&!engineReady)initWLLM();if(mode==='server'){engine=null;engineReady=false}updMode();toast(mode==='server'?'Режим: Сервер':'Режим: Устройство')}m.remove()}}

/* ══ WebLLM ══ */
async function initWLLM(){if(!navigator.gpu){toast('WebGPU недоступен');mode='server';saveS({mode});updMode();return}
wllmAbort=false;setSt('загрузка...','busy');showProg(0,'Инициализация...');
try{const wl=await import('https://esm.run/@mlc-ai/web-llm');if(wllmAbort)return hideProg();
engine=await wl.CreateMLCEngine(WEBLLM_MODEL,{initProgressCallback:r=>{if(wllmAbort)return;showProg(Math.round((r.progress||0)*100),r.text||'Загрузка...')}});
if(wllmAbort){engine=null;return hideProg()}
hideProg();engineReady=true;updMode();toast('Модель загружена!')
}catch(e){console.error('[WL]',e);hideProg();mode='server';saveS({mode});updMode();toast('Ошибка → сервер')}}

function showProg(p,t){nvProgress.style.display='block';nvProgText.textContent=t;nvProgFill.style.width=p+'%';nvProgPct.textContent=p+'%'}
function hideProg(){nvProgress.style.display='none'}
G('nv-prog-cancel').onclick=()=>{wllmAbort=true;hideProg();mode='server';saveS({mode});updMode();engine=null;engineReady=false;toast('Загрузка отменена')};

/* Tool call */
async function callTool(name,params){try{const r=await fetch(TOOLS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:name,params:params||{}})});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}catch(e){return{error:e.message}}}

/* ══ THINK & SEARCH TOGGLES ══ */
nvThink.onclick=()=>{deepThink=!deepThink;nvThink.classList.toggle('active',deepThink)};
nvSearch.onclick=()=>{forceSearch=!forceSearch;nvSearch.classList.toggle('active',forceSearch)};

/* ══ VIEWPORT ══ */
let lRAF=null,pVPH=0;
function updLay(){if(lRAF)cancelAnimationFrame(lRAF);lRAF=requestAnimationFrame(()=>{lRAF=null;const vv=window.visualViewport,vpH=vv?vv.height:window.innerHeight,vpT=vv?vv.offsetTop:0;qc.style.top=vpT+'px';qc.style.height=vpH+'px';const bar=G('qc-bar'),bot=G('qc-bot');qc.style.setProperty('--bar-h',(bar?bar.offsetHeight:56)+'px');qc.style.setProperty('--bot-h',(bot?bot.offsetHeight:80)+'px');if(vpH<pVPH)scrollBot();pVPH=vpH})}
pVPH=window.visualViewport?window.visualViewport.height:window.innerHeight;updLay();
if(window.visualViewport){window.visualViewport.addEventListener('resize',updLay,{passive:true});window.visualViewport.addEventListener('scroll',updLay,{passive:true})}
window.addEventListener('resize',updLay,{passive:true});
qcIn.addEventListener('focus',()=>{setTimeout(updLay,100);setTimeout(updLay,300);setTimeout(updLay,600)});
qcIn.addEventListener('blur',()=>setTimeout(updLay,100));
document.addEventListener('touchmove',e=>{let el=e.target;while(el&&el!==document.body){if(el===qcMsgs||(el.tagName==='TEXTAREA'&&el.scrollHeight>el.clientHeight)||el.tagName==='CODE'||el.tagName==='PRE'||el.id==='nv-sb-chats')return;el=el.parentElement}e.preventDefault()},{passive:false});
const qcBot=G('qc-bot');let tSY=0;if(qcBot){qcBot.addEventListener('touchstart',e=>{tSY=e.touches[0].clientY},{passive:true});qcBot.addEventListener('touchend',e=>{if(tSY-e.changedTouches[0].clientY>25)qcIn.focus()},{passive:true})}

/* Scroll */
qcMsgs.addEventListener('scroll',()=>{const d=qcMsgs.scrollHeight-qcMsgs.scrollTop-qcMsgs.clientHeight;autoScroll=d<=24;qcDn.classList.toggle('on',d>120);const bar=G('qc-bar');if(bar)bar.classList.toggle('scrolled',qcMsgs.scrollTop>10)},{passive:true});
function scrollBot(f){if(autoScroll||f)try{qcMsgs.scrollTo({top:qcMsgs.scrollHeight,behavior:'smooth'})}catch(_){qcMsgs.scrollTop=qcMsgs.scrollHeight}}
qcDn.onclick=()=>{autoScroll=true;scrollBot(true)};

/* Textarea */
qcIn.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,140)+'px';updLay()});
function resetIn(){qcIn.value='';qcIn.style.height='auto'}

/* ══ FILES ══ */
qcAtt.onclick=()=>qcFI.click();
qcFI.onchange=e=>{addF(Array.from(e.target.files));qcFI.value=''};
function addF(files){let r=0;files.forEach(f=>{if(f.size<=MAX_MB*1024*1024)attached.push(f);else r++});if(r)toast(r+' файл(ов) > '+MAX_MB+' МБ');renderP()}

const FI='<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>',FP='<path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',FD='<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>';
function fic(f){if(f.type?.startsWith('image/'))return FI;if(f.type?.includes('pdf'))return FP;return FD}
function ficN(n){if(/\.(png|jpg|jpeg|gif|webp)$/i.test(n))return FI;if(/\.pdf$/i.test(n))return FP;return FD}
function renderP(){qcPills.innerHTML='';attached.forEach((f,i)=>{const d=document.createElement('div');d.className='qcp';d.innerHTML='<svg viewBox="0 0 24 24">'+fic(f)+'</svg><span class="qcp-n" title="'+esc(f.name)+'">'+esc(f.name)+'</span><div class="qcp-rm" data-i="'+i+'"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></div>';qcPills.appendChild(d)});qcPills.querySelectorAll('.qcp-rm').forEach(b=>{b.onclick=()=>{attached.splice(+b.dataset.i,1);renderP()}});updLay()}

/* Chips */
function initChips(root){root.querySelectorAll('.qc-chip').forEach(c=>{c.onclick=()=>{if(c.dataset.p==='file'){qcFI.click();return}const map={write:'Помоги написать текст: ',task:'Разбери задачу: '};qcIn.value=map[c.dataset.p]||'';qcIn.dispatchEvent(new Event('input'));qcIn.focus()}})}
const ws0=G('qc-welcome');if(ws0)initChips(ws0);

/* Clear / New */
function clearChat(){stopA();resetIn();attached=[];lastFiles=[];renderP();exchanges=[];chatHistory=[];isFirst=true;sid=gSid();qcMsgs.innerHTML='';localStorage.removeItem(STORE);qcMsgs.appendChild(mkW())}
function newChat(){stopA();save();resetIn();attached=[];lastFiles=[];renderP();exchanges=[];chatHistory=[];isFirst=true;sid=gSid();qcMsgs.innerHTML='';qcMsgs.appendChild(mkW())}
function stopA(){if(isGen&&abortCtrl)abortCtrl.abort()}
function mkW(){const d=document.createElement('div');d.id='qc-welcome';d.innerHTML='<div id="qc-wi">N</div><h2 id="qc-wh">Nova AI</h2><p id="qc-wp">Чем могу помочь?</p><div id="qc-chips"><button class="qc-chip" data-p="write">✍️ Написать</button><button class="qc-chip" data-p="task">🔍 Задача</button><button class="qc-chip" data-p="file">📄 Файл</button></div>';initChips(d);return d}

/* D&D */
let dc=0;qc.addEventListener('dragenter',e=>{e.preventDefault();dc++;qc.classList.add('drag')});qc.addEventListener('dragleave',()=>{if(--dc<=0){dc=0;qc.classList.remove('drag')}});qc.addEventListener('dragover',e=>e.preventDefault());qc.addEventListener('drop',e=>{e.preventDefault();dc=0;qc.classList.remove('drag');addF(Array.from(e.dataTransfer.files))});document.addEventListener('paste',e=>{if(e.clipboardData?.files.length)addF(Array.from(e.clipboardData.files))});

/* File reading */
const TXTRE=/\.(txt|md|csv|json|yaml|yml|xml|py|js|ts|jsx|tsx|html|htm|css|sh|log|ini|toml|sql|java|cpp|c|h|php|rb|go|rs)$/i;
const TXTMT=['text/','application/json','application/xml','application/javascript'];
function isTxt(f){return TXTMT.some(m=>f.type.startsWith(m))||TXTRE.test(f.name)}
function rdTxt(f){return new Promise((ok,er)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=er;r.readAsText(f,'utf-8')})}

/* Code blocks */
function enhCode(el){el.querySelectorAll('pre').forEach(pre=>{if(pre.querySelector('.pre-hdr'))return;const code=pre.querySelector('code');const cls=[...(code?.classList||[])].find(c=>c.startsWith('language-'));const lang=cls?cls.replace('language-',''):'code';const hdr=document.createElement('div');hdr.className='pre-hdr';hdr.innerHTML='<span class="pre-lang">'+esc(lang)+'</span><button class="pre-cp"><svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Копировать</button>';pre.insertBefore(hdr,pre.firstChild);hdr.querySelector('.pre-cp').onclick=()=>{navigator.clipboard.writeText(code?code.innerText:pre.innerText).then(()=>{const b=hdr.querySelector('.pre-cp');b.textContent='✓ Скопировано';setTimeout(()=>{b.innerHTML='<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Копировать'},2000)})}})};

function toggleUI(g){isGen=g;qcSic.style.display=g?'none':'block';qcPic.style.display=g?'block':'none';qcSend.classList.toggle('stop',g);if(!g)updMode();else setSt('думает...','busy')}

/* Bubble helpers */
function rBF(cnt,fi){const old=cnt.querySelector('.qcm-fls');if(old)old.remove();if(!fi?.length)return;const fd=document.createElement('div');fd.className='qcm-fls';fi.forEach(f=>{const n=typeof f==='string'?f:(f.name||'');fd.innerHTML+='<span class="qcm-ft"><svg viewBox="0 0 24 24">'+ficN(n)+'</svg>'+esc(n)+'</span>'});cnt.appendChild(fd)}
function gTO(cnt){const c=cnt.cloneNode(true);const f=c.querySelector('.qcm-fls');if(f)f.remove();return(c.textContent||'').trim()}

/* ══ MESSAGES ══ */
const IC_CP='<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const IC_OK='<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const IC_RT='<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const IC_ED='<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

function addMsg(text,side,filesInfo=[],exIdx=null){
const wrap=document.createElement('div');wrap.className='qcm '+(side==='u'?'u':'b');
if(side==='b')wrap.classList.add('gen');
const bbl=document.createElement('div');bbl.className='qcm-bl '+(side==='u'?'ub':'bb');
const cnt=document.createElement('div');cnt.className='qcm-cnt';
if(side==='b')cnt.innerHTML='<div class="qcm-ld"><div class="d"></div><div class="d"></div><div class="d"></div></div>';
else{cnt.textContent=text;rBF(cnt,filesInfo)}
bbl.appendChild(cnt);wrap.appendChild(bbl);
const mt=document.createElement('div');mt.className='qcm-mt';mt.textContent=ftime();wrap.appendChild(mt);
const ac=document.createElement('div');ac.className='qcm-ac';
const cpB=mkQA(IC_CP,'Копировать');cpB.onclick=()=>{navigator.clipboard.writeText(gTO(cnt).trim()).then(()=>{cpB.innerHTML=IC_OK;cpB.classList.add('ok');setTimeout(()=>{cpB.innerHTML=IC_CP;cpB.classList.remove('ok')},2000)})};ac.appendChild(cpB);
if(side==='b'){const rtB=mkQA(IC_RT,'Повторить');rtB.onclick=()=>{wrap.remove();doSend(lastTxt,true)};ac.appendChild(rtB)}
if(side==='u'){const edB=mkQA(IC_ED,'Редактировать');edB.className='qa qc-edit-btn';edB.style.display='none';edB.onclick=()=>{const ct=gTO(cnt),ex=exchanges[exIdx],ver=ex?ex.versions[ex.vi]:null;startEdit(wrap,cnt,bbl,exIdx,ct,ver?(ver.filesInfo||[]):[],ver?(ver.fileObjects||[]):[])};ac.appendChild(edB)}
wrap.appendChild(ac);qcMsgs.appendChild(wrap);autoScroll=true;scrollBot();return{cnt,wrap}}
function mkQA(h,t){const b=document.createElement('button');b.className='qa';b.title=t;b.innerHTML=h;return b}
function updLE(){const all=qcMsgs.querySelectorAll('.qc-edit-btn');all.forEach((b,i)=>{b.style.display=(i===all.length-1)?'':'none'})}

/* ══ EDIT ══ */
const eFI=document.createElement('input');eFI.type='file';eFI.multiple=true;eFI.style.cssText='display:none!important';eFI.accept='.txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.gif,.webp,.py,.js,.ts,.html,.css,.xml,.yaml,.yml,.log,.sh,.xlsx,.docx';document.body.appendChild(eFI);
function startEdit(wrap,cnt,bbl,exIdx,oT,oFI,oFO){if(isGen)return;bbl.style.display='none';let eF=oFI.map((fi,i)=>({name:typeof fi==='string'?fi:(fi.name||''),file:oFO[i] instanceof File?oFO[i]:null}));const ed=document.createElement('div');ed.className='qcm-ed';const ta=document.createElement('textarea');ta.className='qcm-edta';ta.value=oT;ta.rows=1;ta.style.height='auto';requestAnimationFrame(()=>{ta.style.height=Math.min(ta.scrollHeight,200)+'px'});ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,200)+'px'});ed.appendChild(ta);const fz=document.createElement('div');fz.className='qcm-ed-filezone';ed.appendChild(fz);
function rEF(){fz.innerHTML='';eF.forEach((ef,i)=>{const row=document.createElement('div');row.className='qcm-ed-file';row.innerHTML='<svg viewBox="0 0 24 24">'+ficN(ef.name)+'</svg><span class="qcm-ed-file-name">'+esc(ef.name)+'</span><span class="qcm-ed-file-rm" data-i="'+i+'"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></span>';row.querySelector('.qcm-ed-file-rm').onclick=()=>{eF.splice(i,1);rEF()};fz.appendChild(row)});const ab=document.createElement('button');ab.className='qcm-ed-addfile';ab.innerHTML='<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Файл';ab.onclick=()=>eFI.click();fz.appendChild(ab)}rEF();
const onEFI=()=>{Array.from(eFI.files).forEach(f=>{if(f.size>MAX_MB*1024*1024){toast(f.name+' > '+MAX_MB+' МБ');return}eF.push({name:f.name,file:f})});eFI.value='';rEF()};eFI.addEventListener('change',onEFI);
const btns=document.createElement('div');btns.className='qcm-edbtns';const okB=document.createElement('button');okB.className='qcm-edok';okB.textContent='Отправить';const cnB=document.createElement('button');cnB.className='qcm-edcn';cnB.textContent='Отмена';btns.appendChild(cnB);btns.appendChild(okB);ed.appendChild(btns);wrap.insertBefore(ed,bbl);ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);
function cancel(){eFI.removeEventListener('change',onEFI);ed.remove();bbl.style.display=''}
cnB.onclick=cancel;ta.addEventListener('keydown',e=>{if(e.key==='Escape')cancel()});
okB.onclick=()=>{const nt=ta.value.trim();eFI.removeEventListener('change',onEFI);if(!nt&&!eF.length){cancel();return}cnt.innerHTML='';if(nt)cnt.appendChild(document.createTextNode(nt));const nfi=eF.map(ef=>({name:ef.name}));rBF(cnt,nfi);ed.remove();bbl.style.display='';
if(exIdx!==null&&exchanges[exIdx]){const ex=exchanges[exIdx];if(ex.domBot)ex.versions[ex.vi].botHTML=ex.domBot.innerHTML;ex.domBot?.closest('.qcm')?.remove();for(let j=exIdx+1;j<exchanges.length;j++){exchanges[j].domUser?.remove();exchanges[j].domBot?.closest('.qcm')?.remove()}exchanges.splice(exIdx+1);chatHistory=chatHistory.slice(0,exIdx*2);const afo=eF.map(ef=>ef.file).filter(Boolean);ex.versions.push({text:nt,filesInfo:nfi,fileObjects:afo,botHTML:''});ex.vi=ex.versions.length-1;lastTxt=nt;lastFiles=afo;updLE();sendMsg(nt,afo,exIdx)}};
ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!isMob){e.preventDefault();okB.click()}})}

/* Voice */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SR){const rec=new SR();rec.lang='ru-RU';rec.continuous=false;rec.interimResults=true;let base='';rec.onstart=()=>{qcMic.classList.add('rec');qcWrap.classList.add('rec');qcWave.classList.add('on');base=qcIn.value;qcIn.placeholder='🎙 Говорите...'};rec.onend=()=>{qcMic.classList.remove('rec');qcWrap.classList.remove('rec');qcWave.classList.remove('on');qcIn.placeholder='Спросите что-нибудь...';qcIn.dispatchEvent(new Event('input'))};rec.onerror=e=>{if(e.error!=='aborted')console.warn('SR',e.error)};rec.onresult=e=>{let fin='',inter='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)fin+=t;else inter+=t}if(fin)base+=(base?' ':'')+fin.trim();qcIn.value=base+(inter?' '+inter:'');qcIn.dispatchEvent(new Event('input'))};qcMic.onclick=()=>{if(qcMic.classList.contains('rec'))rec.stop();else rec.start()}}else qcMic.style.display='none';

/* ══ SEND ══ */
qcSend.onclick=()=>{if(isGen){if(abortCtrl)abortCtrl.abort();return}doSend()};
qcIn.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!isMob){e.preventDefault();if(!isGen)doSend()}});

function doSend(mT,isR){if(isGen)return;const txt=mT!=null?mT:qcIn.value.trim();const files=isR?[...lastFiles]:[...attached];if(!txt&&!files.length)return;
if(isFirst){const ws=G('qc-welcome');if(ws){ws.classList.add('out');setTimeout(()=>ws.remove(),300)}isFirst=false}
lastTxt=txt;lastFiles=files;const exIdx=exchanges.length;
if(!isR){const fi=files.map(f=>({name:f.name}));const{cnt,wrap}=addMsg(txt||'📎 Файл(ы)','u',fi,exIdx);exchanges.push({versions:[{text:txt,filesInfo:fi,fileObjects:[...files],botHTML:''}],vi:0,domUser:wrap,domBot:null});updLE()}
resetIn();attached=[];renderP();
// Reset toggles after send
if(forceSearch){forceSearch=false;nvSearch.classList.remove('active')}
sendMsg(txt,files,exIdx)}

/* ══ GENERATE ══ */
async function sendMsg(txt,files,exIdx){abortCtrl=new AbortController();toggleUI(true);autoScroll=true;scrollBot();
const bm=addMsg('','b');const cnt=bm.cnt,bW=bm.wrap;if(exchanges[exIdx])exchanges[exIdx].domBot=cnt;
try{
// Read file contents
let fCtx='';for(const f of files){if(f instanceof File){try{if(isTxt(f)){const c=await rdTxt(f);fCtx+='\n\n📎 Файл «'+f.name+'»:\n```\n'+c.substring(0,8000)+'\n```'}else{fCtx+='\n\n📎 Файл «'+f.name+'» ('+f.type+', '+(f.size/1024).toFixed(0)+' КБ) — бинарный, содержимое недоступно для чтения'}}catch(e){fCtx+='\n\n📎 Файл «'+f.name+'» — ошибка чтения'}}}

let uC=txt;
if(fCtx)uC+=fCtx;
if(deepThink)uC='[Думай пошагово, анализируй глубоко, рассмотри разные варианты]\n'+uC;
if(forceSearch)uC='[ОБЯЗАТЕЛЬНО используй поиск в интернете для ответа на этот вопрос. Год: '+TODAY.getFullYear()+']\n'+uC;

chatHistory.push({role:'user',content:uC});
// Trim history to last 15 exchanges (30 messages)
if(chatHistory.length>30)chatHistory=chatHistory.slice(-30);

if(mode==='webgpu'&&engineReady)await genLocal(uC,cnt,exIdx);
else await genServer(uC,files,cnt,exIdx);
}catch(err){if(err.name==='AbortError')cnt.innerHTML+='<div class="qcm-sb"><em>Остановлено</em></div>';else{cnt.innerHTML='<span style="color:var(--er)">⚠️ '+esc(err.message)+'</span>';setSt('ошибка','err')}}
finally{if(exchanges[exIdx])exchanges[exIdx].versions[exchanges[exIdx].vi].botHTML=cnt.innerHTML;toggleUI(false);bW.classList.remove('gen');abortCtrl=null;save()}}

/* LOCAL — WebLLM */
async function genLocal(uC,cnt,exIdx){const msgs=[{role:'system',content:SYS_LOCAL},...chatHistory];let botTxt='',round=0;
while(round<3){const res=await engine.chat.completions.create({messages:msgs,stream:true,temperature:0.7,max_tokens:2048});let ct='';cnt.innerHTML='';
for await(const ch of res){if(abortCtrl?.signal.aborted)throw new DOMException('','AbortError');const d=ch.choices[0]?.delta?.content;if(d){ct+=d;botTxt=ct;cnt.innerHTML=md(ct);enhCode(cnt);scrollBot()}}
const sm=ct.match(/\[SEARCH:\s*(.+?)\]/i);
if(sm&&round<2){const q=sm[1].trim();cnt.innerHTML=md(ct.replace(sm[0],'🔍 *Ищу: «'+q+'»...*'));scrollBot();
const r=await callTool('web_search',{query:q});const sCtx=r.result?.length?r.result.map(x=>'• '+x.title+': '+x.snippet+(x.url?' ('+x.url+')':'')).join('\n'):'Ничего не найдено';
msgs.push({role:'assistant',content:ct});msgs.push({role:'user',content:'Результаты поиска «'+q+'»:\n'+sCtx+'\n\nОтветь развёрнуто на основе результатов. Язык = язык вопроса.'});botTxt='';round++;continue}
chatHistory.push({role:'assistant',content:botTxt});break}}

/* SERVER — Ollama */
async function genServer(txt,files,cnt,exIdx){
const d={chatInput:txt,sessionId:sid,systemPrompt:SYS+'\nДата: '+DATE_STR};
if(deepThink)d.chatInput='[Думай пошагово]\n'+d.chatInput;
const fO={method:'POST',signal:abortCtrl.signal,headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(d)};
const res=await fetch(CHAT_URL,fO);if(!res.ok)throw new Error('HTTP '+res.status);
const reader=res.body.getReader(),dec=new TextDecoder('utf-8');let buf='',bT='',first=true;
while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});buf=buf.replace(/}\s*\{/g,'}\n{');const lines=buf.split('\n');buf=lines.pop()??'';
for(const raw of lines){let ln=raw.trim();if(ln.startsWith('data:'))ln=ln.slice(5).trim();if(!ln||ln==='[DONE]')continue;try{const o=JSON.parse(ln);const ch=o.content??o.message??o.text??o.output??o.delta??null;if(ch!==null){if(first){cnt.innerHTML='';first=false}bT+=ch;cnt.innerHTML=md(bT);enhCode(cnt);scrollBot()}}catch{}}}
if(buf.trim()){let ln=buf.trim();if(ln.startsWith('data:'))ln=ln.slice(5).trim();if(ln&&ln!=='[DONE]'){try{const o=JSON.parse(ln);const ch=o.content??o.message??o.text??o.output??null;if(ch){if(first)cnt.innerHTML='';bT+=ch;cnt.innerHTML=md(bT);enhCode(cnt);scrollBot()}}catch{}}}
chatHistory.push({role:'assistant',content:bT})}

/* ══ STORAGE ══ */
function save(){try{localStorage.setItem(STORE,JSON.stringify(exchanges.map(e=>({versions:e.versions.map(v=>({text:v.text,filesInfo:v.filesInfo||[],botHTML:v.botHTML||''})),vi:e.vi}))))}catch{}}
function load(){try{const raw=localStorage.getItem(STORE);if(!raw)return;const data=JSON.parse(raw);if(!data?.length)return;const ws=G('qc-welcome');if(ws){ws.classList.add('out');setTimeout(()=>ws.remove(),300)}isFirst=false;
data.forEach((ex,i)=>{const v=ex.versions[ex.vi];if(!v)return;const um=addMsg(v.text,'u',v.filesInfo||[],i);const e={versions:ex.versions.map(vv=>({...vv,fileObjects:[]})),vi:ex.vi,domUser:um.wrap,domBot:null};exchanges.push(e);chatHistory.push({role:'user',content:v.text});const bm=addMsg('','b');e.domBot=bm.cnt;if(v.botHTML){bm.cnt.innerHTML=v.botHTML;enhCode(bm.cnt);chatHistory.push({role:'assistant',content:bm.cnt.textContent||''})}else{bm.cnt.innerHTML='<em style="color:var(--t3)">—</em>';chatHistory.push({role:'assistant',content:''})}bm.wrap.classList.remove('gen')});updLE();scrollBot(true)}catch(e){console.warn('[NV]',e)}}

setTimeout(load,60);updMode();if(mode==='webgpu')initWLLM();
})();
