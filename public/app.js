'use strict';
/* six — app client. Chats are stored locally on this device. */

const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $('sidebar'), scrim: $('scrim'), chatList: $('chatList'), chatSearch: $('chatSearch'),
  scroll: $('scroll'), empty: $('empty'), msgs: $('msgs'), chips: $('chips'),
  input: $('input'), composer: $('composer'), sendBtn: $('sendBtn'),
  sendIcon: $('sendIcon'), stopIcon: $('stopIcon'),
  drawBtn: $('drawBtn'), drawBar: $('drawBar'), drawOff: $('drawOff'),
  statusDot: $('statusDot'), statusText: $('statusText'),
  settingsModal: $('settingsModal'), serverInfo: $('serverInfo'), toast: $('toast'),
};

const STAR = '<svg class="star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 2 L61.8 38.2 L98 50 L61.8 61.8 L50 98 L38.2 61.8 L2 50 L38.2 38.2 Z"/></svg>';
const LS_CHATS = 'six.chats.v1';
const LS_ACTIVE = 'six.active.v1';

let chats = [];
let activeId = null;
let streaming = null; // AbortController while six is answering
let drawMode = false;
let health = { chat: false, image: false };

try {
  chats = JSON.parse(localStorage.getItem(LS_CHATS) || '[]');
  if (!Array.isArray(chats)) chats = [];
  activeId = localStorage.getItem(LS_ACTIVE);
} catch { chats = []; }

function save() {
  try {
    localStorage.setItem(LS_CHATS, JSON.stringify(chats));
    if (activeId) localStorage.setItem(LS_ACTIVE, activeId);
  } catch {}
}
function activeChat() { return chats.find((c) => c.id === activeId) || null; }
function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function toast(text, ms) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, ms || 3200);
}

/* ---------------- markdown (escape-first, dependency-free) ---------------- */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mdInline(s) {
  s = escHtml(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function md(src) {
  const fences = [];
  let text = String(src || '').replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    fences.push({ lang: lang || 'code', code: code.replace(/\n$/, '') });
    return '\u0001' + (fences.length - 1) + '\u0001';
  });
  const lines = text.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\u0001(\d+)\u0001$/.exec(line.trim());
    if (fence) {
      closeList();
      const f = fences[Number(fence[1])];
      out.push('<pre><div class="phead"><span>' + escHtml(f.lang) + '</span><button type="button" data-copy="' + fences.indexOf(f) + '">copy</button></div><code>' + escHtml(f.code) + '</code></pre>');
      continue;
    }
    if (/^\s*$/.test(line)) { closeList(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push('<h' + h[1].length + '>' + mdInline(h[2]) + '</h' + h[1].length + '>'); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if (/^\s*>\s?(.*)$/.test(line)) { closeList(); out.push('<blockquote>' + mdInline(line.replace(/^\s*>\s?/, '')) + '</blockquote>'); continue; }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1])) {
      closeList();
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      i--;
      out.push('<table><thead><tr>' + head.map((c) => '<th>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(kind === 'ul' ? '<ul>' : '<ol>'); list = kind; }
      out.push('<li>' + mdInline((ul || ol)[1]) + '</li>');
      continue;
    }
    closeList();
    out.push('<p>' + mdInline(line) + '</p>');
  }
  closeList();
  return out.join('\n').replace(/<p>\s*<\/p>/g, '');
}

/* ---------------- rendering ---------------- */
function stickBottom(force) {
  const el = els.scroll;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
  if (force || near) el.scrollTop = el.scrollHeight;
}
function msgEl(m) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (m.r === 'u' ? 'user' : 'six');
  const av = document.createElement('div');
  av.className = 'av';
  av.innerHTML = m.r === 'u' ? 'u' : STAR;
  const body = document.createElement('div');
  body.className = 'body';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = m.r === 'u' ? 'you' : 'six';
  const content = document.createElement('div');
  content.className = 'md';
  if (m.img) {
    const img = document.createElement('img');
    img.className = 'gen';
    img.src = m.img;
    img.alt = m.t || 'generated image';
    content.appendChild(img);
  }
  if (m.t) {
    const div = document.createElement('div');
    div.innerHTML = md(m.t);
    content.appendChild(div);
  }
  body.appendChild(who);
  body.appendChild(content);
  if (m.r === 's' && m.t) {
    const acts = document.createElement('div');
    acts.className = 'acts';
    const cp = document.createElement('button');
    cp.type = 'button';
    cp.className = 'act';
    cp.innerHTML = '<svg viewBox="0 0 24 24" class="ic"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2"/></svg> copy';
    cp.addEventListener('click', () => { navigator.clipboard.writeText(m.t).then(() => toast('copied')); });
    acts.appendChild(cp);
    body.appendChild(acts);
  }
  wrap.appendChild(av);
  wrap.appendChild(body);
  return wrap;
}
function renderMsgs() {
  const chat = activeChat();
  els.msgs.innerHTML = '';
  const has = !!(chat && chat.msgs.length);
  els.empty.style.display = has ? 'none' : '';
  if (chat) for (const m of chat.msgs) els.msgs.appendChild(msgEl(m));
  stickBottom(true);
}
function renderList() {
  const q = (els.chatSearch.value || '').toLowerCase();
  els.chatList.innerHTML = '';
  const sorted = [...chats].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  let shown = 0;
  for (const c of sorted) {
    if (q && !(c.title || '').toLowerCase().includes(q)) continue;
    shown++;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chatitem' + (c.id === activeId ? ' on' : '');
    const tt = document.createElement('span');
    tt.className = 'tt';
    tt.textContent = c.title || 'new chat';
    const del = document.createElement('span');
    del.className = 'del';
    del.innerHTML = '<svg viewBox="0 0 24 24" class="ic"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    del.title = 'delete chat';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      chats = chats.filter((x) => x.id !== c.id);
      if (activeId === c.id) activeId = chats.length ? [...chats].sort((a, b2) => (b2.ts || 0) - (a.ts || 0))[0].id : null;
      save(); renderList(); renderMsgs();
    });
    b.appendChild(tt);
    b.appendChild(del);
    b.addEventListener('click', () => { activeId = c.id; save(); renderList(); renderMsgs(); closeDrawer(); });
    els.chatList.appendChild(b);
  }
  if (!shown) {
    const d = document.createElement('div');
    d.className = 'none';
    d.textContent = chats.length ? 'no chats match that' : 'no chats yet — start one below';
    els.chatList.appendChild(d);
  }
}

/* ---------------- suggestions ---------------- */
const IDEAS = [
  ['explain it like i\'m five', 'explain quantum entanglement like i\'m five'],
  ['write my essay intro', 'write a killer intro paragraph for an essay about social media and attention spans'],
  ['give me a workout', 'give me a 20-minute no-equipment workout that actually goes hard'],
  ['roast my music taste', 'roast somebody whose top artists are lucki, d4vd and drake'],
  ['plan a side hustle', 'give me 5 realistic side hustles a high schooler can start with $50'],
  ['debug my code', 'my javascript fetch keeps returning undefined — what are the usual causes and fixes?'],
  ['story time', 'write the opening of a horror story set in an abandoned water park at 3am'],
  ['study hack', 'teach me the basics of chemical bonds in 5 bullet points i can memorize'],
  ['caption ideas', 'give me 10 short, cutting captions for a gaming clip dump'],
  ['settle a debate', 'is cereal a soup? argue both sides then pick a winner'],
  ['rap bars', 'write 8 bars about grinding in a small town, dark beat energy'],
  ['what should i eat', 'suggest a late-night snack combo that goes unreasonably hard'],
];
function renderChips() {
  els.chips.innerHTML = '';
  const picks = [...IDEAS].sort(() => Math.random() - 0.5).slice(0, 4);
  for (const [label, prompt] of picks) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    const bold = document.createElement('b');
    bold.textContent = label;
    b.appendChild(bold);
    b.appendChild(document.createTextNode(prompt.length > 64 ? prompt.slice(0, 64) + '…' : prompt));
    b.addEventListener('click', () => { els.input.value = prompt; autoGrow(); send(); });
    els.chips.appendChild(b);
  }
}

/* ---------------- chat engine ---------------- */
function ensureChat() {
  let chat = activeChat();
  if (!chat) {
    chat = { id: uid(), title: '', msgs: [], ts: Date.now() };
    chats.push(chat);
    activeId = chat.id;
    save();
  }
  return chat;
}
function setStreaming(on) {
  els.sendIcon.hidden = on;
  els.stopIcon.hidden = !on;
  els.sendBtn.classList.toggle('stop', on);
  els.sendBtn.disabled = false;
}
async function send() {
  const text = els.input.value.trim();
  if (streaming) return;
  if (drawMode) {
    if (!text) return;
    await draw(text);
    return;
  }
  if (!text) return;
  const chat = ensureChat();
  const userMsg = { r: 'u', t: text };
  chat.msgs.push(userMsg);
  chat.ts = Date.now();
  if (!chat.title) chat.title = text.slice(0, 46);
  save();
  els.input.value = '';
  autoGrow();
  renderList();
  renderMsgs();

  // placeholder six message with typing dots
  const sixMsg = { r: 's', t: '' };
  chat.msgs.push(sixMsg);
  const node = msgEl(sixMsg);
  const content = node.querySelector('.md');
  content.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  els.msgs.appendChild(node);
  els.empty.style.display = 'none';
  stickBottom(true);

  const history = chat.msgs.slice(0, -1).map((m) => ({ role: m.r === 's' ? 'model' : 'user', text: m.t }));
  streaming = new AbortController();
  setStreaming(true);
  let acc = '';
  let started = false;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
      signal: streaming.signal,
    });
    if (!res.ok || !res.body) {
      let err = 'six couldnt answer rn';
      try { const j = await res.json(); if (j && j.error) err = j.error; } catch {}
      throw new Error(err);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.t) {
          started = true;
          acc += ev.t;
          sixMsg.t = acc;
          content.innerHTML = md(acc);
          content.classList.add('caret');
          stickBottom(false);
        } else if (ev.error) {
          throw new Error(ev.error);
        }
      }
    }
    if (!started && !acc) throw new Error('six sent nothing back — try again');
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (!acc) { chat.msgs = chat.msgs.filter((m) => m !== sixMsg); }
    } else {
      sixMsg.t = acc || ('⚠ ' + (e.message || 'something broke'));
      content.innerHTML = md(sixMsg.t);
    }
  } finally {
    content.classList.remove('caret');
    sixMsg.t = acc && sixMsg.t !== acc ? acc : sixMsg.t;
    if (acc) sixMsg.t = acc;
    chat.ts = Date.now();
    save();
    streaming = null;
    setStreaming(false);
    renderMsgs();
    stickBottom(false);
  }
}

async function draw(prompt) {
  if (!health.image) {
    toast('drawing isnt set up on this server yet — the server needs cloudflare keys to draw', 4200);
    return;
  }
  const chat = ensureChat();
  chat.msgs.push({ r: 'u', t: prompt });
  if (!chat.title) chat.title = '🎨 ' + prompt.slice(0, 40);
  chat.ts = Date.now();
  save();
  els.input.value = '';
  autoGrow();
  renderList();
  renderMsgs();
  const ph = { r: 's', t: 'drawing that for u…' };
  chat.msgs.push(ph);
  renderMsgs();
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.image) throw new Error((j && j.error) || 'drawing failed');
    ph.t = 'here u go — "' + prompt.slice(0, 80) + '"';
    ph.img = j.image;
  } catch (e) {
    ph.t = '⚠ ' + (e.message || 'drawing failed');
  }
  save();
  renderMsgs();
}

/* ---------------- composer ---------------- */
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 168) + 'px';
  els.sendBtn.disabled = !els.input.value.trim() && !streaming;
}
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!streaming) send(); }
});
els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (streaming) { streaming.abort(); return; }
  send();
});
els.sendBtn.addEventListener('click', (e) => {
  if (streaming) { e.preventDefault(); streaming.abort(); }
});
function setDraw(on) {
  drawMode = on;
  els.drawBar.hidden = !on;
  els.drawBtn.classList.toggle('on', on);
  els.input.placeholder = on ? 'describe the picture…' : 'message six…';
  els.input.focus();
}
els.drawBtn.addEventListener('click', () => setDraw(!drawMode));
els.drawOff.addEventListener('click', () => setDraw(false));

/* code-block copy (event delegation, buttons carry their block index per render) */
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-copy]');
  if (!btn) return;
  const pre = btn.closest('pre');
  const code = pre && pre.querySelector('code');
  if (code) navigator.clipboard.writeText(code.textContent).then(() => toast('code copied'));
});

/* ---------------- sidebar / nav ---------------- */
function newChat() {
  activeId = null;
  save();
  renderList();
  renderMsgs();
  renderChips();
  closeDrawer();
  els.input.focus();
}
$('newChatBtn').addEventListener('click', newChat);
$('topNewBtn').addEventListener('click', newChat);
els.chatSearch.addEventListener('input', renderList);
function openDrawer() { els.sidebar.classList.add('open'); els.scrim.hidden = false; }
function closeDrawer() { els.sidebar.classList.remove('open'); els.scrim.hidden = true; }
$('menuBtn').addEventListener('click', openDrawer);
els.scrim.addEventListener('click', closeDrawer);

/* ---------------- settings ---------------- */
$('settingsBtn').addEventListener('click', () => { els.settingsModal.hidden = false; });
$('settingsClose').addEventListener('click', () => { els.settingsModal.hidden = true; });
els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) els.settingsModal.hidden = true; });
$('clearBtn').addEventListener('click', () => {
  chats = [];
  activeId = null;
  save();
  renderList();
  renderMsgs();
  renderChips();
  els.settingsModal.hidden = true;
  toast('all chats cleared');
});

/* ---------------- health ---------------- */
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    health = await r.json();
  } catch { health = { chat: false, image: false }; }
  if (health.chat) {
    els.statusDot.className = 'dot ok';
    els.statusText.textContent = 'online';
  } else {
    els.statusDot.className = 'dot bad';
    els.statusText.textContent = 'brain not connected yet';
  }
  els.serverInfo.textContent = 'chat: ' + (health.chat ? 'connected' : 'not set up') + ' · drawing: ' + (health.image ? 'connected' : 'not set up');
}

/* ---------------- boot ---------------- */
if (activeId && !activeChat()) activeId = null;
renderList();
renderMsgs();
renderChips();
autoGrow();
checkHealth();
