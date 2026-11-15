/* 우리 가족 기록장
 * 엄마 · 도완 · 도은을 위한 가족 대시보드
 * 동기화: ntfy.sh 공용 채널(방 코드) — SSE 실시간 수신 + 폴링 폴백 + localStorage
 */
'use strict';

/* ============================== 설정 ============================== */
const ROOM = 'pickle-family-9134b5d45b47';      // 우리 가족 방 코드 (동기화 채널)
const NTFY = 'https://ntfy.sh';
const WIRE_MAX_BYTES = 3900;                      // ntfy 메시지 한도(4096B) 여유
const POLL_MS = 6000;                             // 실시간 연결이 끊겼을 때 폴링 간격

const LS = {
  state: 'fd_state_v1',
  me: 'fd_me',
  device: 'fd_device',
  city: 'fd_city',
  bed: 'fd_bed_on',
  bedTime: 'fd_bed_time',
  bedLast: 'fd_bed_last',
  room: 'fd_room',
  timer: 'fd_timer_min'
};

const MEMBERS = [
  { name: '엄마', key: 'mom', role: '사랑하는 엄마', color: '#F3A0AE' },
  { name: '도완', key: 'dowan', role: '우리 도완이', color: '#F2CE63' },
  { name: '도은', key: 'doeun', role: '우리 도은이', color: '#8FD3AE' }
];

const DEFAULT_MISSIONS = [
  '저녁 준비 같이 돕기',
  '거실 10분 같이 정리하기',
  '서로 칭찬 한 마디씩 하기',
  '자기 전 책 10분 읽기',
  '설거지 · 식탁 닦기 돕기',
  '오늘 고마웠던 일 한 가지 말하기',
  '가족 사진 한 장 찍기',
  '함께 노래 한 곡 부르기',
  '내일 입을 옷 미리 꺼내 두기',
  '10분 동안 같이 스트레칭',
  '물건 5개 제자리에 정리하기',
  '가족에게 손편지 한 줄 쓰기',
  '함께 과일 깎아 먹기',
  '오늘의 기분 한 마디씩 나누기',
  '신발 가지런히 정리하기'
];

const CITIES = [
  ['대구', 35.8714, 128.6014], ['서울', 37.5665, 126.9780], ['부산', 35.1796, 129.0756],
  ['인천', 37.4563, 126.7052], ['대전', 36.3504, 127.3845], ['광주', 35.1595, 126.8526],
  ['울산', 35.5384, 129.3114], ['세종', 36.4800, 127.2890], ['제주', 33.4996, 126.5312],
  ['수원', 37.2636, 127.0286], ['청주', 36.6424, 127.4890], ['전주', 35.8242, 127.1480],
  ['춘천', 37.8813, 127.7300], ['포항', 36.0190, 129.3435], ['경주', 35.8562, 129.2247],
  ['안동', 36.5684, 128.7294], ['구미', 36.1195, 128.3446], ['김해', 35.2285, 128.8893]
];

const STICKERS = ['❤️', '🙌', '⭐', '😊', '🍚', '🎉', '👍', '😴'];

const WMO = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤️'], 2: ['구름 조금', '⛅'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['안개', '🌫️'],
  51: ['이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['이슬비', '🌦️'],
  56: ['어는 이슬비', '🌧️'], 57: ['어는 이슬비', '🌧️'],
  61: ['비', '🌧️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'],
  66: ['어는 비', '🌧️'], 67: ['어는 비', '🌧️'],
  71: ['눈', '🌨️'], 73: ['눈', '🌨️'], 75: ['많은 눈', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['소나기', '🌦️'], 81: ['소나기', '🌦️'], 82: ['강한 소나기', '⛈️'],
  85: ['눈 소나기', '🌨️'], 86: ['눈 소나기', '🌨️'],
  95: ['천둥번개', '⛈️'], 96: ['천둥번개', '⛈️'], 99: ['천둥번개', '⛈️']
};

/* ============================== 도우미 ============================== */
const $ = (id) => document.getElementById(id);
const ri = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const now = () => Date.now();
const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byteLen = (s) => new TextEncoder().encode(s).length;
const memberByName = (n) => MEMBERS.find((m) => m.name === n) || null;
const memberByKey = (k) => MEMBERS.find((m) => m.key === k) || null;
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch (e) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ============================== 아바타 (직접 그린 SVG) ============================== */
function avatarSVG(key) {
  if (key === 'mom') {
    return `<svg viewBox="0 0 100 100" role="img" aria-label="엄마">
      <ellipse cx="50" cy="90" rx="24" ry="5" fill="#E8D6C4" opacity=".45"/>
      <path d="M27 33 L20 11 L45 23 Z" fill="#FFFCF6" stroke="#E7D3C0" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M73 33 L80 11 L55 23 Z" fill="#FFFCF6" stroke="#E7D3C0" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M28 30 L23.6 15.5 L38 24 Z" fill="#FBD3D8"/>
      <path d="M72 30 L76.4 15.5 L62 24 Z" fill="#FBD3D8"/>
      <circle cx="50" cy="53" r="29" fill="#FFFCF6" stroke="#E7D3C0" stroke-width="2.4"/>
      <ellipse cx="32" cy="61" rx="6.4" ry="4.4" fill="#FBC6CE" opacity=".85"/>
      <ellipse cx="68" cy="61" rx="6.4" ry="4.4" fill="#FBC6CE" opacity=".85"/>
      <ellipse cx="39" cy="53" rx="3.3" ry="4.1" fill="#4E423A"/>
      <ellipse cx="61" cy="53" rx="3.3" ry="4.1" fill="#4E423A"/>
      <path d="M46 62 q4 4.5 8 0" stroke="#4E423A" stroke-width="1.9" fill="none" stroke-linecap="round"/>
      <g transform="translate(72 28)">
        <circle r="2.6" fill="#F7A8B4"/>
        <path d="M-2.6 0 l-6 -4.4 v8.8 z" fill="#F7A8B4"/>
        <path d="M2.6 0 l6 -4.4 v8.8 z" fill="#F7A8B4"/>
      </g>
    </svg>`;
  }
  if (key === 'dowan') {
    return `<svg viewBox="0 0 100 100" role="img" aria-label="도완">
      <ellipse cx="50" cy="90" rx="23" ry="5" fill="#E8D6A8" opacity=".45"/>
      <circle cx="50" cy="55" r="29" fill="#FFF6CD" stroke="#EBD79A" stroke-width="2.4"/>
      <path d="M49 26 q2 -9 9 -12 q-2 7 0 12" fill="#FFE79B" stroke="#EBD79A" stroke-width="2" stroke-linejoin="round"/>
      <path d="M47 24 q13 -16 26 -8 q-11 12 -26 8 z" fill="#A6D89C" stroke="#84C179" stroke-width="2" stroke-linejoin="round"/>
      <ellipse cx="31" cy="62" rx="6" ry="4.2" fill="#F7C6A0" opacity=".8"/>
      <ellipse cx="69" cy="62" rx="6" ry="4.2" fill="#F7C6A0" opacity=".8"/>
      <ellipse cx="40" cy="54" rx="3.3" ry="4.1" fill="#4E423A"/>
      <ellipse cx="60" cy="54" rx="3.3" ry="4.1" fill="#4E423A"/>
      <path d="M46 63 l4 5 l4 -5 z" fill="#F0A94E"/>
      <path d="M52 63.5 q5 2 8 -1" stroke="#E39A3E" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 100 100" role="img" aria-label="도은">
      <ellipse cx="50" cy="90" rx="22" ry="5" fill="#BFD9C9" opacity=".4"/>
      <path d="M38 34 q-7 -24 1 -26 q8 -2 8.5 24" fill="#EAF9F0" stroke="#BFE3CD" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M62 34 q7 -24 -1 -26 q-8 -2 -8.5 24" fill="#EAF9F0" stroke="#BFE3CD" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M40 28 q-4 -16 0 -18 q4 -1 4.5 16" fill="#FBD3D8"/>
      <path d="M60 28 q4 -16 0 -18 q-4 -1 -4.5 16" fill="#FBD3D8"/>
      <circle cx="50" cy="57" r="27" fill="#EFFBF4" stroke="#BFE3CD" stroke-width="2.4"/>
      <ellipse cx="33" cy="64" rx="5.8" ry="4" fill="#FBD3D8" opacity=".85"/>
      <ellipse cx="67" cy="64" rx="5.8" ry="4" fill="#FBD3D8" opacity=".85"/>
      <ellipse cx="41" cy="57" rx="3.2" ry="4" fill="#4E423A"/>
      <ellipse cx="59" cy="57" rx="3.2" ry="4" fill="#4E423A"/>
      <path d="M47 65 q3 3.5 6 0" stroke="#4E423A" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M72 40 l2.4 4.8 5.3.7 -4 3.6 1 5.2 -4.7-2.5 -4.7 2.5 1-5.2 -4-3.6 5.3-.7 z" fill="#FFE182" stroke="#EFC94F" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
}

/* ============================== 상태 ============================== */
function emptyState() {
  return { v: 1, chat: {}, reacts: {}, stars: { base: {}, ev: {} }, stamps: {}, missions: {}, cur: null };
}

let state = loadState();

function loadState() {
  try {
    const raw = store.get(LS.state, '');
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    return normalizeState(s);
  } catch (e) {
    return emptyState();
  }
}

function normalizeState(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  return {
    v: 1,
    chat: s.chat && typeof s.chat === 'object' ? s.chat : {},
    reacts: s.reacts && typeof s.reacts === 'object' ? s.reacts : {},
    stars: {
      base: s.stars && s.stars.base && typeof s.stars.base === 'object' ? s.stars.base : {},
      ev: s.stars && s.stars.ev && typeof s.stars.ev === 'object' ? s.stars.ev : {}
    },
    stamps: s.stamps && typeof s.stamps === 'object' ? s.stamps : {},
    missions: s.missions && typeof s.missions === 'object' ? s.missions : {},
    cur: Array.isArray(s.cur) ? s.cur : null
  };
}

function saveState() {
  try { store.set(LS.state, JSON.stringify(pruneForStore(state))); } catch (e) {}
}

function pruneForStore(s) {
  const out = {
    v: 1,
    chat: {}, reacts: {}, stars: { base: { ...s.stars.base }, ev: {} },
    stamps: {}, missions: { ...s.missions }, cur: s.cur
  };
  const ids = Object.keys(s.chat).sort((a, b) => s.chat[b][1] - s.chat[a][1]);
  ids.slice(0, 60).forEach((id) => {
    out.chat[id] = s.chat[id];
    if (s.reacts[id]) out.reacts[id] = s.reacts[id];
  });
  const evCut = now() - 60 * 24 * 3600 * 1000;
  const evIds = Object.keys(s.stars.ev).sort((a, b) => (s.stars.ev[b][1] || 0) - (s.stars.ev[a][1] || 0));
  evIds.slice(0, 300).forEach((id) => { const e = s.stars.ev[id]; if (e[1] > evCut || evIds.indexOf(id) < 100) out.stars.ev[id] = e; });
  const stampCut = dayKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  Object.keys(s.stamps).forEach((d) => { if (d >= stampCut) out.stamps[d] = s.stamps[d]; });
  return out;
}

/* 병합: 채팅·별·도장·미션은 합집합, 현재 미션은 더 최신 것 */
function mergeState(target, incoming) {
  if (!incoming || typeof incoming !== 'object') return 0;
  let changes = 0;
  const inc = normalizeState(incoming);

  Object.keys(inc.chat).forEach((id) => {
    if (!target.chat[id]) { target.chat[id] = inc.chat[id]; changes++; }
  });
  Object.keys(inc.reacts).forEach((id) => {
    if (!target.chat[id]) return;
    const mine = target.reacts[id] || (target.reacts[id] = []);
    inc.reacts[id].forEach((w) => { if (!mine.includes(w)) { mine.push(w); changes++; } });
  });
  Object.keys(inc.stars.base).forEach((w) => {
    const v = Number(inc.stars.base[w]) || 0;
    if (v > (Number(target.stars.base[w]) || 0)) { target.stars.base[w] = v; changes++; }
  });
  Object.keys(inc.stars.ev).forEach((id) => {
    if (!target.stars.ev[id]) { target.stars.ev[id] = inc.stars.ev[id]; changes++; }
  });
  Object.keys(inc.stamps).forEach((d) => {
    const mine = target.stamps[d] || (target.stamps[d] = []);
    inc.stamps[d].forEach((s) => {
      if (!mine.some((m) => m[0] === s[0] && m[2] === s[2])) { mine.push(s); changes++; }
    });
  });
  Object.keys(inc.missions).forEach((id) => {
    if (!target.missions[id]) { target.missions[id] = inc.missions[id]; changes++; }
  });
  if (inc.cur && (!target.cur || (inc.cur[1] || 0) > (target.cur[1] || 0))) {
    if (!target.cur || target.cur[0] !== inc.cur[0]) changes++;
    target.cur = inc.cur;
  }
  return changes;
}

/* ============================== 동기화 ============================== */
const DEVICE = (() => {
  let d = store.get(LS.device, '');
  if (!d) { d = ri(); store.set(LS.device, d); }
  return d;
})();
let room = store.get(LS.room, ROOM) || ROOM;

let lastMsgTime = 0;
let sse = null;
let pollTimer = null;
let sseFailures = 0;
let sseRetryTimer = null;
let pubTimer = null;
let pubBusy = false;
let pendingPublish = false;
let lastSyncAt = 0;
let helloAt = 0;
let statusMode = 'wait';

function setStatus(mode, text) {
  statusMode = mode;
  const el = $('syncStatus');
  if (!el) return;
  el.classList.remove('on', 'off', 'flash');
  if (mode === 'on' || mode === 'flash') el.classList.add('on');
  if (mode === 'off') el.classList.add('off');
  el.textContent = text || (mode === 'on' ? '가족과 연결됨'
    : mode === 'off' ? '오프라인 — 이 기기에 저장 중'
    : '연결 중…');
  const info = $('syncInfo');
  if (info) {
    info.textContent = lastSyncAt
      ? `마지막 동기화: ${hhmm(lastSyncAt)} · 방 코드 ${room}`
      : `방 코드 ${room}`;
  }
}

function wireState(maxBytes) {
  const s = pruneForStore(state);
  let ids = Object.keys(s.chat).sort((a, b) => s.chat[b][1] - s.chat[a][1]);
  let keepChat = 40;
  let keepEv = 200;
  let keepMissions = 15;
  const build = () => {
    const out = { v: 1, chat: {}, reacts: {}, stars: { base: s.stars.base, ev: {} }, stamps: s.stamps, missions: {}, cur: s.cur };
    ids.slice(0, keepChat).forEach((id) => {
      out.chat[id] = s.chat[id];
      if (s.reacts[id]) out.reacts[id] = s.reacts[id];
    });
    Object.keys(s.stars.ev)
      .sort((a, b) => (s.stars.ev[b][1] || 0) - (s.stars.ev[a][1] || 0))
      .slice(0, keepEv)
      .forEach((id) => { out.stars.ev[id] = s.stars.ev[id]; });
    Object.keys(s.missions)
      .sort((a, b) => (s.missions[b][2] || 0) - (s.missions[a][2] || 0))
      .slice(0, keepMissions)
      .forEach((id) => { out.missions[id] = s.missions[id]; });
    return out;
  };
  let payload = build();
  let guard = 0;
  while (byteLen(JSON.stringify(payload)) > maxBytes && guard++ < 40) {
    if (keepChat > 5) keepChat -= 5;
    else if (keepEv > 20) keepEv -= 20;
    else if (keepMissions > 0) keepMissions -= 1;
    else break;
    payload = build();
  }
  return payload;
}

function schedulePublish(delay = 300) {
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => { publish(); }, delay);
}

async function publish(payloadExtra) {
  if (pubBusy) { schedulePublish(600); return; }
  pubBusy = true;
  try {
    const body = payloadExtra
      ? JSON.stringify(payloadExtra)
      : JSON.stringify({ f: DEVICE, t: now(), s: wireState(WIRE_MAX_BYTES) });
    const res = await fetch(`${NTFY}/${encodeURIComponent(room)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    pendingPublish = false;
    lastSyncAt = now();
    setStatus('on');
    renderSyncInfo();
  } catch (e) {
    pendingPublish = true;
    setStatus('off');
  } finally {
    pubBusy = false;
  }
}

async function handleIncoming(msg) {
  if (!msg || msg.event !== 'message') return;
  if (msg.time && msg.time * 1000 > lastMsgTime) lastMsgTime = msg.time * 1000;
  let data = msg.message;
  if (msg.attachment && msg.attachment.url) {
    try {
      const r = await fetch(msg.attachment.url, { cache: 'no-store' });
      if (r.ok) data = await r.text();
    } catch (e) { return; }
  }
  let obj;
  try { obj = JSON.parse(data); } catch (e) { return; }
  if (!obj || typeof obj !== 'object') return;
  if (obj.f === DEVICE) return;                       // 내가 보낸 것
  if (obj.hello && !obj.s) {                          // 새 기기가 상태를 찾는 중
    if (Object.keys(state.chat).length || Object.keys(state.stamps).length || state.cur) {
      if (now() - helloAt > 8000) { helloAt = now(); schedulePublish(150); }
    }
    return;
  }
  if (obj.s) {
    const changed = mergeState(state, obj.s);
    if (changed) {
      saveState();
      renderAll();
      flashSync();
    }
  }
}

function flashSync() {
  const el = $('syncStatus');
  if (!el) return;
  lastSyncAt = now();
  setStatus('flash', '가족 기록 받는 중…');
  setTimeout(() => setStatus('on'), 900);
}

async function pollOnce(initial) {
  try {
    const since = initial ? '12h' : (lastMsgTime ? String(Math.max(1, Math.floor(lastMsgTime / 1000) - 2)) : '12h');
    const res = await fetch(`${NTFY}/${encodeURIComponent(room)}/json?poll=1&since=${since}&sched=0`, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try { await handleIncoming(JSON.parse(line)); } catch (e) {}
    }
    lastSyncAt = now();
    setStatus('on');
    renderSyncInfo();
  } catch (e) {
    setStatus('off');
  }
}

function startPolling() {
  if (pollTimer) return;
  pollOnce(false);
  pollTimer = setInterval(() => { if (!document.hidden) pollOnce(false); }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startStream() {
  if (!('EventSource' in window)) { startPolling(); return; }
  closeStream();
  const since = lastMsgTime ? String(Math.max(1, Math.floor(lastMsgTime / 1000) - 2)) : '2h';
  try {
    sse = new EventSource(`${NTFY}/${encodeURIComponent(room)}/sse?since=${since}`);
  } catch (e) {
    startPolling();
    return;
  }
  sse.onopen = () => {
    sseFailures = 0;
    stopPolling();
    lastSyncAt = now();
    setStatus('on');
    renderSyncInfo();
  };
  sse.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleIncoming(msg);
  };
  sse.onerror = () => {
    sseFailures++;
    if (sse.readyState === EventSource.CLOSED) {
      startPolling();                                  // 폴링 폴백
      setStatus('off', '실시간 연결 끊김 — 다시 연결 중');
      clearTimeout(sseRetryTimer);
      sseRetryTimer = setTimeout(startStream, Math.min(30000, 3000 * sseFailures));
    } else if (sseFailures > 6) {
      startPolling();
    }
  };
}

function closeStream() {
  if (sse) { try { sse.close(); } catch (e) {} sse = null; }
}

/* ============================== 사용자/기기 ============================== */
function getMe() { return store.get(LS.me, ''); }
function setMe(name) {
  store.set(LS.me, name);
  renderWho();
  renderMembers();
}

/* ============================== 렌더 ============================== */
function renderAll() {
  renderToday();
  renderWho();
  renderMembers();
  renderMission();
  renderCalendar();
  renderChat();
  pruneCheck();
}

function renderToday() {
  const d = new Date();
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const el = $('todayLabel');
  if (el) el.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${wd}요일`;
}

function renderWho() {
  const me = getMe();
  const wrap = $('whoPills');
  if (!wrap) return;
  wrap.innerHTML = MEMBERS.map((m) => `
    <button class="pill" data-who="${esc(m.name)}" aria-pressed="${me === m.name}">
      <span class="avatar-mini">${avatarSVG(m.key)}</span>${esc(m.name)}
    </button>`).join('');
  const hint = $('whoHint');
  if (hint) {
    hint.textContent = me
      ? `${me}(으)로 정해 두었어요. 이 기기에서는 계속 ${me}(으)로 기록돼요.`
      : '휴대폰마다 한 번만 골라 두면, 그 기기는 계속 그 사람으로 기억해요.';
  }
}

function starCount(name) {
  let n = Number(state.stars.base[name]) || 0;
  const cut = now() - 60 * 24 * 3600 * 1000;
  Object.values(state.stars.ev).forEach((e) => { if (e[0] === name && e[1] > cut) n++; });
  return n;
}

function renderMembers() {
  const wrap = $('members');
  if (!wrap) return;
  const me = getMe();
  wrap.innerHTML = MEMBERS.map((m) => `
    <div class="member ${m.key}">
      ${me === m.name ? '<span class="member-me">이 기기</span>' : ''}
      <div class="avatar">${avatarSVG(m.key)}</div>
      <div class="m-name">${esc(m.name)}</div>
      <div class="m-sub">${esc(m.role)}</div>
      <div class="m-stars"><span class="star">⭐</span><span>${starCount(m.name)}</span></div>
      <button class="star-btn" data-star="${esc(m.name)}">+1 칭찬</button>
    </div>`).join('');
}

function currentMissionText() {
  return state.cur && state.cur[0] ? state.cur[0] : '';
}

function renderMission() {
  const el = $('missionText');
  if (!el) return;
  if (!state.cur) { setMissionRandom(false); return; }
  el.textContent = state.cur[0];
  const meta = $('missionMeta');
  if (meta) {
    const custom = state.missions[state.cur[2]];
    meta.textContent = custom ? `우리 가족이 만든 미션${custom[1] ? ' · ' + custom[1] : ''}` : '오늘 하루, 다 같이 해 봐요';
  }
}

function setMissionRandom(publishIt = true) {
  const pool = DEFAULT_MISSIONS.concat(Object.values(state.missions).map((m) => m[0]));
  const pick = pool[Math.floor(Math.random() * pool.length)];
  state.cur = [pick, now(), ri()];
  saveState();
  renderMission();
  if (publishIt) schedulePublish(50);
}

function stampList(day) { return state.stamps[day] || []; }

function renderCalendar() {
  const head = $('calendarHead');
  const grid = $('calendar');
  if (!head || !grid) return;
  const d = viewMonth;
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const today = dayKey();
  const monthLabel = `${year}년 ${month + 1}월`;

  head.innerHTML = `
    <div class="cal-nav">
      <button class="cal-btn" data-month="-1" aria-label="이전 달">‹</button>
      <strong>${monthLabel}</strong>
      <button class="cal-btn" data-month="1" aria-label="다음 달">›</button>
    </div>
    <div class="cal-week">
      ${['일', '월', '화', '수', '목', '금', '토'].map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}
    </div>`;

  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<div class="day empty"></div>';
  for (let day = 1; day <= days; day++) {
    const key = dayKey(new Date(year, month, day));
    const stamps = stampList(key);
    const dots = stamps.map((s) => {
      const m = memberByName(s[0]);
      return `<span class="dot ${m ? m.key : 'mom'}" title="${esc(s[0])} · ${esc(s[1] || '')}">${esc((s[0] || '?')[0])}</span>`;
    }).join('');
    cells += `<div class="day ${key === today ? 'today' : ''}">
      <span class="dnum">${day}</span>
      <div class="dots">${dots}</div>
    </div>`;
  }
  grid.innerHTML = cells;

  let total = 0;
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  Object.keys(state.stamps).forEach((k) => { if (k.startsWith(prefix)) total += state.stamps[k].length; });
  const totalEl = $('stampTotal');
  if (totalEl) totalEl.textContent = `${total}개`;
}

let viewMonth = new Date();

function renderChat() {
  const log = $('chatLog');
  if (!log) return;
  const me = getMe();
  const msgs = Object.keys(state.chat)
    .map((id) => ({ id, d: state.chat[id] }))
    .sort((a, b) => a.d[1] - b.d[1])
    .slice(-40);

  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;

  if (!msgs.length) {
    log.innerHTML = `<div class="chat-empty">아직 대화가 없어요. 첫 인사를 남겨 보세요 💬</div>`;
    return;
  }
  log.innerHTML = msgs.map(({ id, d }) => {
    const [who, ts, text] = d;
    const m = memberByName(who);
    const isMine = who === me;
    const reactions = state.reacts[id] || [];
    const emojiOnly = text.length <= 4 && /\p{Extended_Pictographic}/u.test(text);
    return `<div class="msg ${isMine ? 'mine' : ''}">
      <div class="avatar">${avatarSVG(m ? m.key : 'mom')}</div>
      <div class="msg-body">
        <div class="msg-name">${esc(who)}</div>
        <div class="bubble ${emojiOnly ? 'sticker' : ''}">${esc(text)}</div>
        <div class="msg-foot">
          <span class="msg-time">${hhmm(ts)}</span>
          <button class="react ${reactions.length ? 'on' : ''}" data-react="${id}">❤️${reactions.length ? ' ' + reactions.length : ''}</button>
        </div>
      </div>
    </div>`;
  }).join('');
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function renderSyncInfo() {
  const info = $('syncInfo');
  if (!info) return;
  info.textContent = lastSyncAt
    ? `마지막 동기화 ${hhmm(lastSyncAt)} · 방 코드 ${room}`
    : `방 코드 ${room}`;
}

function pruneCheck() {
  const today = dayKey();
  if (state.stamps[today] && state.stamps[today].length > MEMBERS.length + 2) {
    state.stamps[today] = state.stamps[today].slice(-MEMBERS.length - 2);
  }
}

/* ============================== 소리 ============================== */
let actx = null;
function audio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (e) { return null; }
}
function beep(freq, dur = 0.25, delay = 0, type = 'sine', vol = 0.22) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(a.destination);
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function chime() {
  [880, 1046.5, 1318.5, 1567.98].forEach((f, i) => beep(f, 0.3, i * 0.16));
  beep(1046.5, 0.5, 0.72);
}
function cheer() {
  [784, 988, 1175, 1568].forEach((f, i) => beep(f, 0.22, i * 0.1, 'triangle', 0.18));
}

/* ============================== 알람/축하 ============================== */
let alarmRepeat = null;
function showAlarm(title, sub, emoji) {
  const ov = $('alarmOverlay');
  $('alarmTitle').textContent = title;
  $('alarmSub').textContent = sub;
  $('alarmEmoji').textContent = emoji || '⏰';
  ov.hidden = false;
  chime();
  clearInterval(alarmRepeat);
  alarmRepeat = setInterval(chime, 3200);
  if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {} }
}
function hideAlarm() {
  $('alarmOverlay').hidden = true;
  clearInterval(alarmRepeat);
  alarmRepeat = null;
}

function celebrate(who, sub) {
  const ov = $('highFiveOverlay');
  $('hfTitle').textContent = who ? `${who} 최고! 다 같이 했어요!` : '다 같이 했어요!';
  $('hfSub').textContent = sub || '짝짝짝 👏 도장이 찍혔어요';
  const burst = $('hfBurst');
  burst.textContent = '🙌';
  burst.innerHTML = '';
  const emojis = ['🙌', '👏', '✨', '⭐', '💛', '🎉'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = emojis[i % emojis.length];
    s.style.left = Math.random() * 88 + '%';
    s.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
    s.style.fontSize = (12 + Math.random() * 12).toFixed(0) + 'px';
    burst.appendChild(s);
  }
  ov.hidden = false;
  cheer();
  clearTimeout(celebrate._t);
  celebrate._t = setTimeout(() => { ov.hidden = true; }, 3600);
}

/* ============================== 타이머 ============================== */
const timer = {
  total: Number(store.get(LS.timer, 10)) * 60,
  left: Number(store.get(LS.timer, 10)) * 60,
  running: false,
  endAt: 0,
  id: null,
  fired: false
};

function timerSet(minutes) {
  timer.stop();
  timer.total = Math.max(1, Math.round(minutes)) * 60;
  timer.left = timer.total;
  timer.fired = false;
  store.set(LS.timer, String(Math.round(minutes)));
  timerDraw();
}
timer.stop = function () {
  timer.running = false;
  clearInterval(timer.id);
  timer.id = null;
};

function timerDraw() {
  const el = $('timerDisplay');
  if (!el) return;
  const s = Math.max(0, Math.ceil(timer.left));
  el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  el.classList.toggle('running', timer.running);
}

function timerStart() {
  if (timer.running) return;
  if (timer.left <= 0) timer.left = timer.total;
  audio();
  timer.running = true;
  timer.fired = false;
  timer.endAt = now() + timer.left * 1000;
  timer.id = setInterval(() => {
    timer.left = Math.max(0, (timer.endAt - now()) / 1000);
    timerDraw();
    if (timer.left <= 0) {
      timer.stop();
      timerDraw();
      if (!timer.fired) {
        timer.fired = true;
        showAlarm('⏰ 시간이 다 됐어요!', '타이머가 끝났어요. 같이 정리해 볼까요?', '⏰');
      }
    }
  }, 200);
  timerDraw();
}

function timerPause() {
  if (!timer.running) return;
  timer.left = Math.max(0, (timer.endAt - now()) / 1000);
  timer.stop();
  timerDraw();
}

/* 태블릿 끄는 알람 (이 기기에서만) */
function bedCheck() {
  const on = store.get(LS.bed, '0') === '1';
  if (!on) return;
  const t = store.get(LS.bedTime, '21:30');
  const d = new Date();
  const cur = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = dayKey(d);
  if (cur === t && store.get(LS.bedLast, '') !== today) {
    store.set(LS.bedLast, today);
    showAlarm('🛏️ 태블릿 끌 시간이에요!', `${t} — 오늘은 여기까지. 잘 자요 🌙`, '🛏️');
  }
}

/* ============================== 날씨 ============================== */
let weatherCache = null;
async function loadWeather(force) {
  const city = store.get(LS.city, '대구');
  const cityEl = $('weatherCity');
  if (cityEl) cityEl.textContent = city;
  let coords = CITIES.find((c) => c[0] === city);
  if (!coords) {
    const saved = store.get(LS.city + '_coords', '');
    if (saved) {
      const [la, lo] = saved.split(',').map(Number);
      coords = [city, la, lo];
    }
  }
  if (!coords) coords = CITIES[0];

  if (!force && weatherCache && weatherCache.city === city && now() - weatherCache.at < 15 * 60 * 1000) {
    renderWeather(weatherCache.data, city);
    return;
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords[1]}&longitude=${coords[2]}` +
      `&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=Asia%2FSeoul&forecast_days=1`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    weatherCache = { city, at: now(), data };
    renderWeather(data, city);
  } catch (e) {
    const t = $('weatherSky');
    if (t) t.textContent = '날씨를 불러오지 못했어요';
  }
}

function renderWeather(data, city) {
  const cur = data.current || {};
  const daily = data.daily || {};
  const code = cur.weather_code != null ? cur.weather_code : (daily.weather_code ? daily.weather_code[0] : 0);
  const [label, emoji] = WMO[code] || ['—', '🌈'];
  const t = Math.round(cur.temperature_2m);
  const lo = daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) : null;
  const hi = daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) : null;
  $('weatherEmoji').textContent = emoji;
  $('weatherTemp').textContent = `${t}°`;
  $('weatherSky').textContent = `${label} · ${city}`;
  $('weatherRange').textContent = (lo != null && hi != null) ? `최저 ${lo}° / 최고 ${hi}°` : '';
  $('weatherCity').textContent = city;
}

async function geocodeCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=ko&format=json`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('geocode HTTP ' + r.status);
  const j = await r.json();
  if (!j.results || !j.results.length) throw new Error('not found');
  const g = j.results[0];
  return [g.name || name, g.latitude, g.longitude];
}

/* ============================== 이벤트 ============================== */
function bindEvents() {
  // 기기 사용자
  $('whoPills').addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    setMe(b.dataset.who);
    audio();
    beep(920, 0.12);
  });

  // 별 주기
  $('members').addEventListener('click', (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    const who = b.dataset.star;
    const me = getMe();
    if (!me) { hintWho(); return; }
    state.stars.ev[ri()] = [who, now()];
    saveState();
    renderMembers();
    schedulePublish(50);
    beep(1180, 0.14);
    b.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 220 });
  });

  // 미션
  $('rerollMission').addEventListener('click', () => {
    audio();
    beep(760, 0.1);
    beep(1020, 0.1, 0.08);
    setMissionRandom(true);
    const el = $('missionText');
    el.animate?.([{ transform: 'rotate(-1.5deg)' }, { transform: 'rotate(1.5deg)' }, { transform: 'rotate(0)' }], { duration: 260 });
  });

  $('addMission').addEventListener('click', () => {
    const input = $('customMission');
    const text = input.value.trim();
    if (!text) return;
    const id = ri();
    state.missions[id] = [text, getMe() || '', now()];
    state.cur = [text, now(), id];
    input.value = '';
    saveState();
    renderMission();
    schedulePublish(50);
    beep(980, 0.12);
  });

  $('customMission').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('addMission').click(); }
  });

  $('doneMission').addEventListener('click', () => {
    const me = getMe();
    if (!me) { hintWho(); return; }
    audio();
    const day = dayKey();
    const list = state.stamps[day] || (state.stamps[day] = []);
    const mission = currentMissionText() || '가족 미션';
    const already = list.some((s) => s[0] === me);
    if (!already) list.push([me, mission, now()]);
    saveState();
    renderCalendar();
    schedulePublish(0);
    celebrate(me, already ? '오늘 도장은 이미 찍혔어요. 그래도 최고! 🙌' : '짝짝짝 👏 도장이 찍혔어요');
  });

  // 달력 이동
  $('calendarHead').addEventListener('click', (e) => {
    const b = e.target.closest('[data-month]');
    if (!b) return;
    const n = Number(b.dataset.month);
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + n, 1);
    renderCalendar();
  });

  // 채팅
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('chatInput').value);
  });
  $('stickers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sticker]');
    if (b) sendChat(b.dataset.sticker, true);
  });
  $('chatLog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-react]');
    if (!b) return;
    const me = getMe();
    if (!me) { hintWho(); return; }
    const id = b.dataset.react;
    const list = state.reacts[id] || (state.reacts[id] = []);
    const i = list.indexOf(me);
    if (i >= 0) list.splice(i, 1); else list.push(me);
    if (!list.length) delete state.reacts[id];
    saveState();
    renderChat();
    schedulePublish(50);
    beep(1240, 0.1);
  });

  // 타이머
  document.querySelectorAll('.timer-presets [data-min]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.timer-presets .chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      timerSet(Number(b.dataset.min));
      audio(); beep(880, 0.1);
    });
  });
  $('setCustomMin').addEventListener('click', () => {
    const v = Number($('customMin').value);
    if (!v || v < 1) return;
    timerSet(Math.min(180, v));
    beep(880, 0.1);
  });
  $('timerStart').addEventListener('click', timerStart);
  $('timerPause').addEventListener('click', timerPause);
  $('timerReset').addEventListener('click', () => { timer.stop(); timer.left = timer.total; timer.fired = false; timerDraw(); });

  $('bedToggle').addEventListener('change', (e) => {
    store.set(LS.bed, e.target.checked ? '1' : '0');
    audio(); beep(1000, 0.1);
  });
  $('bedTime').addEventListener('change', (e) => {
    store.set(LS.bedTime, e.target.value || '21:30');
  });

  // 알람/축하 닫기
  $('alarmClose').addEventListener('click', hideAlarm);
  $('hfClose').addEventListener('click', () => { $('highFiveOverlay').hidden = true; });
  $('highFiveOverlay').addEventListener('click', (e) => { if (e.target.id === 'highFiveOverlay') $('highFiveOverlay').hidden = true; });

  // 날씨 도시
  $('weatherCityBtn').addEventListener('click', () => openSheet());

  // 설정
  $('openSettings').addEventListener('click', openSheet);
  document.querySelectorAll('[data-close-sheet]').forEach((el) => el.addEventListener('click', closeSheet));
  $('citySelect').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === '__custom') { $('customCityRow').hidden = false; return; }
    $('customCityRow').hidden = true;
    store.set(LS.city, v);
    store.del(LS.city + '_coords');
    await loadWeather(true);
    closeSheet();
  });
  $('customCitySave').addEventListener('click', async () => {
    const q = $('customCityInput').value.trim();
    if (!q) return;
    try {
      const [name, lat, lon] = await geocodeCity(q);
      store.set(LS.city, name);
      store.set(LS.city + '_coords', `${lat},${lon}`);
      await loadWeather(true);
      closeSheet();
    } catch (err) {
      $('customCityInput').value = '';
      $('customCityInput').placeholder = '찾지 못했어요. 다른 이름으로…';
    }
  });
  $('roomSave').addEventListener('click', () => {
    const v = $('roomInput').value.trim();
    if (!v) return;
    room = v;
    store.set(LS.room, v);
    closeStream(); stopPolling();
    lastMsgTime = 0;
    setStatus('wait');
    startStream();
    pollOnce(true);
    closeSheet();
  });
  $('soundTest').addEventListener('click', () => { audio(); chime(); });
  $('resetDevice').addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 기록과 선택한 사용자를 지울까요? (가족 공용 기록은 그대로 남아요)')) return;
    [LS.state, LS.me, LS.city, LS.city + '_coords', LS.bed, LS.bedTime, LS.bedLast, LS.timer].forEach((k) => store.del(k));
    location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (!sse || sse.readyState !== EventSource.OPEN) pollOnce(false);
      loadWeather(false);
    }
  });
  window.addEventListener('online', () => { if (pendingPublish) schedulePublish(100); });
}

function hintWho() {
  const p = $('whoPills');
  p.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  $('whoHint').textContent = '먼저 위에서 "이 기기에서 쓰는 사람"을 골라 주세요!';
  $('whoPills').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function sendChat(text, isSticker) {
  const t = (text || '').trim();
  if (!t) return;
  const me = getMe();
  if (!me) { hintWho(); return; }
  const id = ri();
  state.chat[id] = [me, now(), t.slice(0, 200)];
  saveState();
  renderChat();
  schedulePublish(0);
  if (!isSticker) $('chatInput').value = '';
  beep(1040, 0.09);
}

function openSheet() {
  const sel = $('citySelect');
  const city = store.get(LS.city, '대구');
  sel.innerHTML = CITIES.map((c) => `<option value="${esc(c[0])}" ${c[0] === city ? 'selected' : ''}>${esc(c[0])}</option>`).join('')
    + `<option value="__custom" ${!CITIES.some((c) => c[0] === city) ? 'selected' : ''}>직접 입력…</option>`;
  $('customCityRow').hidden = CITIES.some((c) => c[0] === city);
  $('roomInput').value = room;
  $('syncInfo').textContent = lastSyncAt ? `마지막 동기화 ${hhmm(lastSyncAt)} · 방 코드 ${room}` : `방 코드 ${room}`;
  $('settingsSheet').hidden = false;
}
function closeSheet() { $('settingsSheet').hidden = true; }

/* ============================== 시작 ============================== */
function boot() {
  bindEvents();

  // 기준 상태
  if (!state.cur) {
    state.cur = [DEFAULT_MISSIONS[Math.floor(Math.random() * DEFAULT_MISSIONS.length)], now(), ri()];
    saveState();
  }
  $('stickers').innerHTML = STICKERS.map((s) => `<button class="sticker-btn" data-sticker="${s}" aria-label="스티커 ${s}">${s}</button>`).join('');

  $('bedToggle').checked = store.get(LS.bed, '0') === '1';
  $('bedTime').value = store.get(LS.bedTime, '21:30');
  document.querySelectorAll('.timer-presets [data-min]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.min) === Math.round(timer.total / 60));
  });

  renderAll();
  timerDraw();
  loadWeather(false);
  setInterval(() => { loadWeather(false); }, 20 * 60 * 1000);
  setInterval(bedCheck, 1000);
  bedCheck();

  // 동기화: 최근 12시간 기록 받아 병합 → 실시간 연결
  setStatus('wait');
  (async () => {
    await pollOnce(true);
    renderAll();
    startStream();
    // 새 기기(기록이 거의 없음)라면 가족에게 상태를 요청
    const sparse = Object.keys(state.chat).length === 0 && Object.keys(state.stamps).length === 0
      && Object.keys(state.stars.ev).length === 0;
    if (sparse) publish({ f: DEVICE, hello: 1 });
    else schedulePublish(1200);
  })();

  // 서비스워커 없이도 홈 화면 추가 안내 없이 동작
  window.addEventListener('pagehide', () => { saveState(); });
}

document.addEventListener('DOMContentLoaded', boot);
