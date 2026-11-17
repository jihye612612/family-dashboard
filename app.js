/* 우리 가족 기록장
 * 엄마 · 도완 · 도은을 위한 가족 대시보드
 * 동기화: 가족 비밀번호로 만든 ntfy.sh 채널 — SSE 실시간 수신 + 폴링 폴백 + localStorage
 * 방 이름은 저장소에 적어 두지 않고, 기기에서 가족 비밀번호로 계산해 씁니다.
 */
'use strict';

/* ============================== 설정 ============================== */
const NTFY = 'https://ntfy.sh';
const ROOM_SALT = 'pickle-family-v2:';            // 비밀번호 → 방 이름 (고정 접두어)
const ROOM_PREFIX = 'pkf-';                       // 만들어지는 방 이름 앞부분
const ROOM_KEY_HEX = 28;                          // 방 이름에 쓰는 해시 길이
const MIN_PW_LEN = 4;                             // 가족 비밀번호 최소 길이
const WIRE_MAX_BYTES = 3900;                      // ntfy 메시지 한도(4096B) 여유
const POLL_MS = 6000;                             // 안전망 폴링 간격 (SSE가 붙어 있어도 계속 돌려요)
const PHOTO_MAX_PX = 960;                         // 사진은 긴 쪽 960px까지만 줄여서 올려요
const PHOTO_QUALITY = 0.78;                       // JPEG 품질 (휴대폰 사진도 1초 안에 올라가요)
const PHOTO_TOPIC_TAIL = '-files';                // 사진은 채팅 주제 대신 사진 전용 주제로 올려요
const PHOTO_KEEP_HOURS = 3;                       // ntfy에 사진이 보관되는 시간

const LS = {
  state: 'fd_state_v1',
  me: 'fd_me',
  device: 'fd_device',
  city: 'fd_city',
  bed: 'fd_bed_on',
  bedTime: 'fd_bed_time',
  bedLast: 'fd_bed_last',
  roomKey: 'fd_room_key_v2',                      // 비밀번호로 만든 방 이름만 저장 (비밀번호 원문은 저장하지 않음)
  oldRoom: 'fd_room',                             // 예전 버전의 방 코드 자리 (정리용)
  timer: 'fd_timer_min',
  prepOn: 'fd_prep_on',                           // 등교 준비 도우미 켜기/끄기
  prepStart: 'fd_prep_start',                     // 준비 시작 시각 (기본 07:30)
  prepEnd: 'fd_prep_end',                         // 출발 시각 (기본 08:10)
  prepWeekday: 'fd_prep_weekday',                 // 평일만 볼지 (기본 켜짐)
  prepDismiss: 'fd_prep_dismiss'                  // "잠깐 보기"로 잠시 닫아 둔 때 (그 시간대 끝까지)
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

/* 준비물 요청: 아이가 고르면 엄마 화면에도 바로 뜨는 목록이에요.
   요청 하나는 [누가, 무엇을, 언제까지, 요청 시각, 끝난 시각] 다섯 칸으로 담아요.
   끝난 시각이 0이면 기다리는 중, 양수면 준비 완료, 음수면 지운 요청(되돌리기용 표시)이에요. */
const SUPPLY_TEXT_MAX = 40;                                  // 한 줄에 적을 수 있는 글자 수
const SUPPLY_KEEP_DAYS = 7;                                  // 끝난 요청은 이만큼만 남겨요
const SUPPLY_QUICK = ['색종이', '풀·가위', '색연필', '도화지', '실내화', '체육복', '줄넘기', '물통'];
const SUPPLY_DUES = [
  { key: '내일까지', emoji: '🌤️', cls: 'tomorrow' },
  { key: '이번 주', emoji: '📅', cls: 'week' },
  { key: '급해요', emoji: '🔥', cls: 'urgent' }
];
const SUPPLY_DUE_RANK = { '급해요': 0, '내일까지': 1, '이번 주': 2 };
const SUPPLY_KIDS = [
  { name: '도완', key: 'dowan' },
  { name: '도은', key: 'doeun' }
];
const SUPPLY_HINT = '요청을 남기면 엄마 화면에도 바로 떠요. 엄마가 ✅ 를 누르면 “엄마 준비 완료!”로 바뀌어요.';

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
function anim(el, frames, opts) {
  if (el && typeof el.animate === 'function') { try { el.animate(frames, opts); } catch (e) {} }
}
const memberByName = (n) => MEMBERS.find((m) => m.name === n) || null;
const memberByKey = (k) => MEMBERS.find((m) => m.key === k) || null;
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch (e) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ============================== 아바타 (먼작귀 그림체 이미지) ============================== */
/* 치이카와 · 하치와레 · 우사기 그림체로 그린 정사각형 그림을 assets/ 에 두고 씁니다.
   큰 카드(.avatar), 작은 선택 버튼(.avatar-mini), 말풍선 옆(.msg .avatar)이 같은 그림을 쓰고,
   동그랗게 잘라도 얼굴·귀가 잘리지 않게 여백을 넉넉히 둔 그림이에요. */
const AVATARS = {
  mom: { src: './assets/mom.png?v=6', label: '엄마' },
  dowan: { src: './assets/dowan.png?v=6', label: '도완' },
  doeun: { src: './assets/doeun.png?v=6', label: '도은' }
};

function avatarHTML(key) {
  const a = AVATARS[key] || AVATARS.mom;
  return `<img class="avatar-img" src="${a.src}" alt="${esc(a.label)}" width="320" height="320" decoding="async" draggable="false">`;
}

/* ============================== 상태 ============================== */
function emptyState() {
  return {
    v: 1, chat: {}, reacts: {}, stars: { base: {}, ev: {} }, stamps: {}, missions: {}, cur: null,
    prep: { d: '', dowan: [0, 0, 0, 0], doeun: [0, 0, 0, 0] }, supplies: {}
  };
}

/* 등교 준비: 칸마다 "언제 눌렀는지"를 부호로 담아요 (양수 = 체크, 음수 = 취소, 0 = 아직)
   같은 칸은 숫자가 더 큰 쪽(|값|)이 이겨서, 다른 기기에서 체크를 풀어도 그대로 따라와요. */
function prepArr(v) {
  const out = [0, 0, 0, 0];
  if (Array.isArray(v)) {
    for (let i = 0; i < 4; i++) out[i] = Number(v[i]) || 0;
  }
  return out;
}

let state = loadState();
let suppressSave = false;   // 이 기기 기록을 지우는 중에는 저장하지 않음

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
    cur: Array.isArray(s.cur) ? s.cur : null,
    prep: s.prep && typeof s.prep === 'object'
      ? { d: typeof s.prep.d === 'string' ? s.prep.d : '', dowan: prepArr(s.prep.dowan), doeun: prepArr(s.prep.doeun) }
      : { d: '', dowan: [0, 0, 0, 0], doeun: [0, 0, 0, 0] },
    supplies: supplyMap(s.supplies)
  };
}

function saveState() {
  try { store.set(LS.state, JSON.stringify(pruneForStore(state))); } catch (e) {}
}

function pruneForStore(s) {
  const out = {
    v: 1,
    chat: {}, reacts: {}, stars: { base: { ...s.stars.base }, ev: {} },
    stamps: {}, missions: { ...s.missions }, cur: s.cur,
    supplies: pruneSupplies(s.supplies),
    prep: s.prep
      ? { d: s.prep.d, dowan: prepArr(s.prep.dowan), doeun: prepArr(s.prep.doeun) }
      : { d: '', dowan: [0, 0, 0, 0], doeun: [0, 0, 0, 0] }
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
      const idx = mine.findIndex((m) => m[0] === s[0]);
      if (idx < 0) { mine.push(s); changes++; }
      else if ((s[2] || 0) < (mine[idx][2] || 0)) mine[idx] = s;   // 같은 날 같은 사람은 한 개
    });
  });
  Object.keys(inc.missions).forEach((id) => {
    if (!target.missions[id]) { target.missions[id] = inc.missions[id]; changes++; }
  });
  // 준비물 요청: 없는 요청은 더하고, 이미 있는 요청은 "끝난 시각"이 더 최근(|값|이 큰) 쪽이 이겨요.
  // (다른 기기에서 준비 완료를 눌러도, 지운 것도 이 규칙 하나로 안전하게 합쳐져요.)
  if (!target.supplies) target.supplies = {};
  Object.keys(inc.supplies).forEach((id) => {
    const row = inc.supplies[id];
    const mine = target.supplies[id];
    if (!mine) { target.supplies[id] = row.slice(); changes++; return; }
    const a = Math.abs(Number(mine[4]) || 0);
    const b = Math.abs(Number(row[4]) || 0);
    if (b > a) { mine[4] = row[4]; changes++; }
  });
  if (inc.cur && (!target.cur || (inc.cur[1] || 0) > (target.cur[1] || 0))) {
    if (!target.cur || target.cur[0] !== inc.cur[0]) changes++;
    target.cur = inc.cur;
  }
  // 등교 준비: 더 새로운 날짜가 이기고, 같은 날이면 칸마다 더 최근에 누른 쪽이 이겨요
  const ip = inc.prep;
  if (ip && ip.d) {
    if (!target.prep || !target.prep.d || ip.d > target.prep.d) {
      target.prep = { d: ip.d, dowan: prepArr(ip.dowan), doeun: prepArr(ip.doeun) };
      changes++;
    } else if (ip.d === target.prep.d) {
      ['dowan', 'doeun'].forEach((k) => {
        const mine = target.prep[k] || (target.prep[k] = [0, 0, 0, 0]);
        for (let i = 0; i < 4; i++) {
          const a = Number(mine[i]) || 0;
          const b = Number(ip[k] && ip[k][i]) || 0;
          if (Math.abs(b) > Math.abs(a)) { mine[i] = b; changes++; }
        }
      });
    }
  }
  return changes;
}

/* ============================== 동기화 ============================== */
const DEVICE = (() => {
  let d = store.get(LS.device, '');
  if (!d) { d = ri(); store.set(LS.device, d); }
  return d;
})();
let room = '';                     // 가족 비밀번호를 넣기 전에는 비어 있어요 (그동안 어떤 채널에도 연결하지 않음)

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
let lastPubTry = 0;
let statusMode = 'wait';

/* 두 기기가 같은 방에 있는지 눈으로 대조하는 코드: 방 이름 끝 4자리 (#xxxx) */
function roomTag() {
  return room ? '#' + room.slice(-4) : '';
}

function withRoomTag(text) {
  const tag = roomTag();
  return tag ? `${text} · ${tag}` : text;
}

function setStatus(mode, text) {
  statusMode = mode;
  const el = $('syncStatus');
  if (!el) return;
  el.classList.remove('on', 'off', 'flash');
  if (mode === 'on' || mode === 'flash') el.classList.add('on');
  if (mode === 'off') el.classList.add('off');
  el.textContent = withRoomTag(text || (mode === 'on' ? '가족과 연결됨'
    : mode === 'off' ? '오프라인 — 이 기기에 저장 중'
    : room ? '연결 중…' : '가족 비밀번호를 넣어 주세요'));
  renderSyncInfo();
}

function wireState(maxBytes) {
  const s = pruneForStore(state);
  let ids = Object.keys(s.chat).sort((a, b) => s.chat[b][1] - s.chat[a][1]);
  let keepChat = 40;
  let keepEv = 200;
  let keepMissions = 15;
  let keepSupplies = 30;
  let keepPrevMonth = true;
  const thisMonth = dayKey().slice(0, 7);
  const build = () => {
    const stamps = {};
    Object.keys(s.stamps).sort().slice(keepPrevMonth ? 0 : -999).forEach((d) => {
      if (keepPrevMonth || d.slice(0, 7) === thisMonth) stamps[d] = s.stamps[d];
    });
    const supplies = {};
    Object.keys(s.supplies || {})
      .sort((a, b) => {
        const ra = s.supplies[a], rb = s.supplies[b];
        const pa = (Number(ra[4]) || 0) === 0 ? 0 : 1;          // 기다리는 요청을 먼저
        const pb = (Number(rb[4]) || 0) === 0 ? 0 : 1;
        return pa - pb || (Number(rb[3]) || 0) - (Number(ra[3]) || 0);
      })
      .slice(0, keepSupplies)
      .forEach((id) => { supplies[id] = s.supplies[id]; });
    const out = {
      v: 1, chat: {}, reacts: {}, stars: { base: s.stars.base, ev: {} },
      stamps: stamps, missions: {}, cur: s.cur, prep: s.prep, supplies: supplies
    };
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
    else if (keepSupplies > 5) keepSupplies -= 5;
    else if (keepPrevMonth) keepPrevMonth = false;
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
  if (!room) return;                                 // 잠겨 있으면 아무 데도 보내지 않아요
  if (pubBusy) { schedulePublish(600); return; }
  pubBusy = true;
  try {
    const body = payloadExtra
      ? JSON.stringify(payloadExtra)
      : JSON.stringify({ f: DEVICE, t: now(), s: wireState(WIRE_MAX_BYTES) });
    lastPubTry = now();
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
  // 사진은 채팅 주제가 아닌 사진 전용 주제(room + '-files')로 올라갑니다.
  // 채팅 주제에 파일이 그대로 붙어 오는 ntfy 원본 알림은 우리 앱 메시지가 아니라서 조용히 넘겨요.
  if (msg.attachment && msg.attachment.url) return;
  let data = msg.message;
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
    const before = supplyPendingCount();
    const changed = mergeState(state, obj.s);
    if (changed) {
      saveState();
      renderAll();
      flashSync();
      // 다른 기기에서 새 준비물 요청이 왔으면 조용히 알려 줘요 (4초에 한 번까지만)
      if (supplyPendingCount() > before && now() - supplyBeepAt > 4000) {
        supplyBeepAt = now();
        beep(880, 0.12);
        beep(1180, 0.16, 0.13);
      }
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
  if (!room) return;
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
    // 연결이 살아 있으니, 못 올린 기록이 있으면 다시 올려요 (10초에 한 번까지만)
    if (pendingPublish && now() - lastPubTry > 10000) schedulePublish(0);
  } catch (e) {
    setStatus('off');
  }
}

/* 화면이 보이는 동안 계속 도는 안전망 폴링 (이미 돌고 있으면 아무 것도 하지 않아요) */
function keepPollingAlive() {
  if (!room || pollTimer) return;
  pollTimer = setInterval(() => { if (!document.hidden) pollOnce(false); }, POLL_MS);
}

function startPolling() {
  if (!room) return;
  if (pollTimer) return;
  pollOnce(false);
  keepPollingAlive();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startStream() {
  if (!room) return;
  if (!('EventSource' in window)) { startPolling(); return; }
  closeStream();
  const since = lastMsgTime ? String(Math.max(1, Math.floor(lastMsgTime / 1000) - 2)) : '2h';
  try {
    sse = new EventSource(`${NTFY}/${encodeURIComponent(room)}/sse?since=${since}`);
  } catch (e) {
    startPolling();
    return;
  }
  keepPollingAlive();                                  // SSE와 별개로 안전망 폴링을 계속 돌려요
  sse.onopen = () => {
    sseFailures = 0;
    keepPollingAlive();                                // 모바일에서 SSE가 조용히 멈춰도 폴링이 받아와요
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
  renderSupplies();
}

/* ============================== 렌더 ============================== */
function renderAll() {
  renderToday();
  renderWho();
  renderMembers();
  renderMission();
  renderCalendar();
  renderChat();
  renderSupplies();
  pruneCheck();
  if (prepIsOpen()) renderPrep();          // 다른 기기에서 체크한 것이 와도 바로 보여요
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
      <span class="avatar-mini">${avatarHTML(m.key)}</span>${esc(m.name)}
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
      <div class="avatar">${avatarHTML(m.key)}</div>
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
    const who = d[0];
    const ts = d[1];
    const text = typeof d[2] === 'string' ? d[2] : '';
    const photo = safePhotoUrl(d[3]);          // 네 번째 칸: ntfy에 올린 사진 주소
    const voice = safePhotoUrl(d[4]);          // 다섯 번째 칸: ntfy에 올린 음성메시지 주소
    const voiceSec = Math.max(0, Math.round(Number(d[5]) || 0));  // 여섯 번째 칸: 길이(초)
    const m = memberByName(who);
    const isMine = who === me;
    const reactions = state.reacts[id] || [];
    const emojiOnly = !photo && !voice && text.length > 0 && text.length <= 6
      && [...text].every((ch) => ch.codePointAt(0) > 0x2000);
    let bubble;
    if (photo || voice) {
      const parts = [];
      if (photo) {
        parts.push(`<a class="photo-link" href="${esc(photo)}" data-photo="${esc(id)}" target="_blank" rel="noopener">
            <img class="chat-photo" src="${esc(photo)}" alt="${esc(who)}님이 보낸 사진" loading="lazy">
            <span class="photo-gone">만료된 사진이에요 (${PHOTO_KEEP_HOURS}시간 보관)</span>
          </a>`);
      }
      if (voice) {
        parts.push(`<div class="voice-wrap">
            <div class="voice-label">🎙️ 음성메시지 (${voiceSecLabel(voiceSec)})</div>
            <audio class="chat-voice" controls preload="metadata" src="${esc(voice)}"></audio>
            <span class="voice-gone">⏳ ${VOICE_KEEP_HOURS}시간이 지나 만료된 음성메시지예요</span>
          </div>`);
      }
      if (text) parts.push(`<div class="photo-cap">${esc(text)}</div>`);
      bubble = `<div class="bubble media ${photo ? 'photo' : ''}">${parts.join('')}</div>`;
    } else {
      bubble = `<div class="bubble ${emojiOnly ? 'sticker' : ''}">${esc(text)}</div>`;
    }
    return `<div class="msg ${isMine ? 'mine' : ''}">
      <div class="avatar">${avatarHTML(m ? m.key : 'mom')}</div>
      <div class="msg-body">
        <div class="msg-name">${esc(who)}</div>
        ${bubble}
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
  if (!room) { info.textContent = '아직 가족 방에 연결하지 않았어요'; return; }
  const last = lastSyncAt ? `마지막 동기화 ${hhmm(lastSyncAt)}` : '가족 방에 연결하는 중';
  info.textContent = `${last} · 우리 방 ${roomTag()}\n`
    + '가족 기기 모두 이 코드가 같아야 채팅이 함께 보여요. 코드가 다르면 서로 다른 비밀번호로 들어온 거예요.';
}

function pruneCheck() {
  const today = dayKey();
  if (state.stamps[today] && state.stamps[today].length > MEMBERS.length) {
    const seen = [];
    state.stamps[today] = state.stamps[today].filter((s) => {
      if (seen.includes(s[0])) return false;
      seen.push(s[0]);
      return true;
    });
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
  const inner = burst.parentElement;
  burst.innerHTML = '<span class="hf-emoji">🙌</span>';
  inner.querySelectorAll('.confetti').forEach((n) => n.remove());
  const emojis = ['🙌', '👏', '✨', '⭐', '💛', '🎉'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = emojis[i % emojis.length];
    s.style.left = Math.random() * 88 + '%';
    s.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
    s.style.fontSize = (12 + Math.random() * 12).toFixed(0) + 'px';
    inner.appendChild(s);
  }
  ov.hidden = false;
  cheer();
  clearTimeout(celebrate._t);
  celebrate._t = setTimeout(() => {
    ov.hidden = true;
    inner.querySelectorAll('.confetti').forEach((n) => n.remove());
  }, 4200);
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

/* ============================== 등교·등원 준비 도우미 ============================== */
/* 아침 준비 시간이 되면 대시보드 대신 이 화면이 전체를 채워요.
   아이는 자기 탭에서 네 가지를 하나씩 체크하고, 체크는 가족 모두에게 바로 보여요. */
const PREP_ITEMS = [
  { n: 1, title: '아침 먹기',   img: './assets/prep-eat.png?v=7' },
  { n: 2, title: '세수·양치',   img: './assets/prep-wash.png?v=7' },
  { n: 3, title: '옷 입기',     img: './assets/prep-dress.png?v=7' },
  { n: 4, title: '가방 챙기기', img: './assets/prep-bag.png?v=7' }
];
const PREP_KIDS = [
  { key: 'dowan', name: '도완', avatar: 'dowan' },
  { key: 'doeun', name: '도은', avatar: 'doeun' }
];
const PREP_GRACE_MIN = 10;      // 출발 시각이 지나도 이만큼은 "출발할 시간이에요"로 보여 줘요
const PREP_DEFAULT_START = '07:30';
const PREP_DEFAULT_END = '08:10';

let prepKid = '';               // 지금 고른 아이 탭 ('' 이면 이 기기 사용자로 자동 선택)
let prepPreview = false;        // ⚙️ 에서 "지금 미리보기"로 연 상태
const prepCheer = {};           // { 'dowan': 'YYYY-MM-DD' } — 하루에 한 번만 축하 소리

function prepSettings() {
  return {
    on: store.get(LS.prepOn, '1') === '1',
    start: store.get(LS.prepStart, PREP_DEFAULT_START),
    end: store.get(LS.prepEnd, PREP_DEFAULT_END),
    weekday: store.get(LS.prepWeekday, '1') === '1'
  };
}

function hmToMin(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function prepClockLabel(hm) {
  const t = hmToMin(hm);
  if (t == null) return '';
  const h = Math.floor(t / 60), mi = t % 60;
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(mi).padStart(2, '0')}`;
}

/* 지금이 준비 시간대인지 — 시작·끔다음 10분(유예)까지 봐요 */
function prepWindow(d = new Date()) {
  const s = prepSettings();
  const a = hmToMin(s.start), b = hmToMin(s.end);
  if (a == null || b == null || b <= a) return null;
  if (s.weekday && (d.getDay() === 0 || d.getDay() === 6)) return null;
  const cur = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const grace = b + PREP_GRACE_MIN;
  return {
    s, startAt: a, endAt: b, graceEnd: grace, cur,
    active: cur >= a && cur < grace,
    departed: cur >= b
  };
}

/* 그 시간대 끝(절대 시각) — "엄마가 잠깐 닫아 둔" 시간을 여기까지만 기억해요 */
function prepWindowEndAt(d = new Date()) {
  const w = prepWindow(d);
  if (!w) return 0;
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return base.getTime() + w.graceEnd * 60000;
}

function prepIsOpen() {
  const ov = $('prepOverlay');
  return !!(ov && !ov.hidden);
}

/* 날짜가 바뀌면 네 칸을 새로 시작해요 */
function prepRollDay(persist) {
  const today = dayKey();
  if (state.prep && state.prep.d === today
    && Array.isArray(state.prep.dowan) && Array.isArray(state.prep.doeun)) return false;
  state.prep = { d: today, dowan: [0, 0, 0, 0], doeun: [0, 0, 0, 0] };
  prepCheer.dowan = '';
  prepCheer.doeun = '';
  if (persist) saveState();
  return true;
}

function prepArray(kidKey) {
  prepRollDay(false);
  const k = kidKey === 'doeun' ? 'doeun' : 'dowan';
  if (!Array.isArray(state.prep[k])) state.prep[k] = [0, 0, 0, 0];
  return state.prep[k];
}

function prepDone(kidKey) {
  return prepArray(kidKey).filter((v) => Number(v) > 0).length;
}

function prepKidNow() {
  if (prepKid === 'dowan' || prepKid === 'doeun') return prepKid;
  return getMe() === '도은' ? 'doeun' : 'dowan';
}

function renderPrep() {
  const ov = $('prepOverlay');
  if (!ov || ov.hidden) return;
  prepRollDay(true);
  const kid = prepKidNow();
  const tabs = $('prepTabs');
  if (tabs) {
    tabs.innerHTML = PREP_KIDS.map((k) => {
      const done = prepDone(k.key);
      return `<button class="prep-tab ${kid === k.key ? 'on' : ''} ${done === 4 ? 'done' : ''}"
        data-prep-kid="${k.key}" role="tab" aria-selected="${kid === k.key}" aria-pressed="${kid === k.key}">
        <span class="prep-tab-avatar">${avatarHTML(k.avatar)}</span>
        <span>${esc(k.name)}</span>
        <span class="prep-tab-count">${done}/4</span>
      </button>`;
    }).join('');
  }
  const arr = prepArray(kid);
  const wrap = $('prepCards');
  if (wrap) {
    wrap.innerHTML = PREP_ITEMS.map((it, i) => {
      const on = Number(arr[i]) > 0;
      return `<button class="prep-card ${on ? 'checked' : ''}" data-prep-item="${i}" data-kid="${kid}" aria-pressed="${on}">
        <span class="prep-num">${on ? '✓' : it.n}</span>
        <span class="prep-pic"><img src="${it.img}" alt="${esc(it.title)}" width="320" height="320" loading="lazy" decoding="async" draggable="false"></span>
        <span class="prep-title">${esc(it.title)}</span>
        <span class="prep-shine" aria-hidden="true">✨</span>
      </button>`;
    }).join('');
  }
  const badge = $('prepBadge');
  if (badge) {
    const k = PREP_KIDS.find((x) => x.key === kid) || PREP_KIDS[0];
    const all = prepDone(kid) === 4;
    badge.textContent = all ? `🎉 ${k.name}, 네 가지 다 했어요! 최고!` : '';
    badge.hidden = !all;
  }
  const tag = $('prepPreviewTag');
  if (tag) tag.hidden = !prepPreview;
  prepDrawClock();
}

/* 시계·남은 시간·진행 바 — 1초마다 다시 그려요 */
function prepDrawClock() {
  const ov = $('prepOverlay');
  if (!ov || ov.hidden) return;
  const d = new Date();
  const w = prepWindow(d);
  const s = prepSettings();
  const dateEl = $('prepDate');
  if (dateEl) dateEl.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일`;
  const ampm = $('prepAmpm'), clock = $('prepClock');
  if (ampm) ampm.textContent = d.getHours() < 12 ? '오전' : '오후';
  if (clock) clock.textContent = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;

  const a = hmToMin(s.start), b = hmToMin(s.end);
  if (a == null || b == null || b <= a) {
    const left = $('prepLeft');
    if (left) { left.textContent = '시작·출발 시간을 설정에서 정해 주세요'; left.classList.remove('go'); }
    const fill0 = $('prepBarFill');
    if (fill0) fill0.style.width = '6%';
    return;
  }

  let cur = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  // 미리보기는 시간대 밖에서도 볼 수 있게, 시작 직전으로 보고 보여 줘요
  if (prepPreview && !(w && w.active)) cur = a;

  const leftMin = Math.max(0, Math.ceil(b - cur));
  const departed = cur >= b;
  const left = $('prepLeft');
  if (left) {
    left.textContent = departed ? '출발할 시간이에요! 🎒' : `출발까지 ${leftMin}분 남았어요`;
    left.classList.toggle('go', departed);
  }

  const frac = Math.min(1, Math.max(0, (cur - a) / (b - a)));
  const pct = departed ? 100 : Math.max(6, Math.round(frac * 100));
  const fill = $('prepBarFill');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('full', departed);
  }
  const bar = $('prepBar');
  if (bar) bar.setAttribute('aria-valuenow', String(pct));
  const label = $('prepBarLabel');
  if (label) label.textContent = `출발 ${prepClockLabel(s.end)}`;
}

function prepOpen() {
  const ov = $('prepOverlay');
  if (!ov) return;
  ov.hidden = false;
  document.body.classList.add('prep-open');
  renderPrep();
}

function prepClose() {
  const ov = $('prepOverlay');
  if (ov) ov.hidden = true;
  document.body.classList.remove('prep-open');
}

/* "일반 화면 잠깐 보기" — 이 시간대가 끝날 때까지만 닫아 둬요 */
function prepPeek() {
  if (prepPreview) { prepPreview = false; prepClose(); return; }
  store.set(LS.prepDismiss, String(prepWindowEndAt()));
  prepClose();
  beep(660, 0.12);
}

/* 1초마다: 지금 보여야 하나? 보여야 하면 시계도 다시 */
function prepTick() {
  prepRollDay(true);
  const ov = $('prepOverlay');
  if (!ov) return;
  const w = prepWindow();
  const dismissed = Number(store.get(LS.prepDismiss, 0)) > now();
  const want = prepPreview || !!(w && w.s.on && w.active && !dismissed);
  if (want && ov.hidden) prepOpen();
  else if (!want && !ov.hidden) prepClose();
  if (!ov.hidden) prepDrawClock();
}

function prepToggleItem(kidKey, i) {
  const arr = prepArray(kidKey);
  const on = Number(arr[i]) > 0;
  arr[i] = on ? -now() : now();          // 양수 = 체크, 음수 = 취소 (누른 시각을 담아요)
  saveState();
  audio();
  beep(on ? 620 : 990, on ? 0.12 : 0.13, 0, on ? 'sine' : 'triangle');
  renderPrep();
  if (!on) {
    const el = $('prepCards') && $('prepCards').querySelector(`[data-prep-item="${i}"]`);
    if (el) {
      el.classList.add('pop');
      setTimeout(() => { try { el.classList.remove('pop'); } catch (e) {} }, 760);
    }
    prepCheerIfDone(kidKey);
  }
  schedulePublish(60);
}

function prepCheerIfDone(kidKey) {
  const k = PREP_KIDS.find((x) => x.key === kidKey) || PREP_KIDS[0];
  if (prepDone(kidKey) < 4) { prepCheer[kidKey] = ''; return; }
  const today = dayKey();
  if (prepCheer[kidKey] === today) return;
  prepCheer[kidKey] = today;
  cheer();
  if (navigator.vibrate) { try { navigator.vibrate([140, 70, 140, 70, 220]); } catch (e) {} }
  const badge = $('prepBadge');
  if (badge) {
    badge.textContent = `🎉 ${k.name}, 네 가지 다 했어요! 최고!`;
    badge.hidden = false;
  }
  const bar = $('prepBar');
  if (bar) anim(bar, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 380 });
}

/* ============================== 준비물 요청 ============================== */
/* 아이가 빠른 칩이나 직접 입력으로 "이거 필요한데요"를 남기면, 엄마·아이 화면에
   같은 목록이 바로 떠요. 엄마가 ✅ 를 누르면 아이 화면에도 "엄마 준비 완료!"로 바뀝니다. */
let supplyWho = '';             // 지금 고른 아이 ('' 이면 이 기기 사용자로 자동)
let supplyDue = '내일까지';     // 지금 고른 기한
let supplyBeepAt = 0;           // 새 요청 알림음을 너무 자주 울리지 않게

/* 요청 한 칸을 다섯 칸 배열로 다듬기 (망가진 값이면 null) */
function supplyRow(v) {
  if (!Array.isArray(v)) return null;
  const who = String(v[0] || '').slice(0, 10);
  const text = String(v[1] || '').replace(/\s+/g, ' ').trim().slice(0, SUPPLY_TEXT_MAX + 20);
  if (!text) return null;
  const due = SUPPLY_DUES.some((d) => d.key === v[2]) ? v[2] : '내일까지';
  return [who, text, due, Number(v[3]) || 0, Number(v[4]) || 0];
}

function supplyMap(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  Object.keys(src).forEach((id) => {
    const r = supplyRow(src[id]);
    if (r) out[id] = r;
  });
  return out;
}

/* 기기에 저장할 만큼만 남기기: 지운·끝난 요청은 일주일만 기억해요 */
function pruneSupplies(src) {
  const out = {};
  const cut = now() - SUPPLY_KEEP_DAYS * 24 * 3600 * 1000;
  const rows = [];
  Object.keys(src || {}).forEach((id) => {
    const r = supplyRow(src[id]);
    if (!r) return;
    const done = Number(r[4]) || 0;
    if (done !== 0 && Math.abs(done) < cut) return;
    rows.push([id, r]);
  });
  rows
    .sort((a, b) => {
      const pa = (Number(a[1][4]) || 0) === 0 ? 0 : 1;
      const pb = (Number(b[1][4]) || 0) === 0 ? 0 : 1;
      return pa - pb || (Number(b[1][3]) || 0) - (Number(a[1][3]) || 0);
    })
    .slice(0, 80)
    .forEach(([id, r]) => { out[id] = r; });
  return out;
}

function supplyPendingCount() {
  return Object.keys(state.supplies || {})
    .filter((id) => (Number(state.supplies[id][4]) || 0) === 0).length;
}

function supplyRoster() {
  const rows = [];
  Object.keys(state.supplies || {}).forEach((id) => {
    const r = supplyRow(state.supplies[id]);
    if (r) rows.push({ id, r });
  });
  return rows;
}

/* 이 기기 사용자가 아이면 그 아이를, 엄마거나 아직 안 골랐으면 고른 칩을 써요 */
function supplyMe() {
  const me = getMe();
  return me === '도완' || me === '도은' ? me : '';
}
function supplyWhoNow() { return supplyWho || supplyMe(); }

function supplyMemberKey(name) {
  const m = memberByName(name);
  return m ? m.key : 'dowan';
}

function supplyDueMeta(key) {
  return SUPPLY_DUES.find((d) => d.key === key) || SUPPLY_DUES[0];
}

function supplyDayLabel(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const d = new Date(t);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey()) return `오늘 ${hhmm(t)}`;
  if (dayKey(d) === dayKey(y)) return `어제 ${hhmm(t)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(t)}`;
}

function supplySay(text) {
  const el = $('supplyHint');
  if (!el) return;
  el.textContent = text || SUPPLY_HINT;
  clearTimeout(supplySay._t);
  if (text) supplySay._t = setTimeout(() => { el.textContent = SUPPLY_HINT; }, 4000);
}

/* 누구·빠른 칩·기한 칩만 다시 그리기 (글자를 칠 때마다 목록까지 다시 그리지 않도록) */
function renderSupplyChips() {
  const whoWrap = $('supplyWho');
  if (whoWrap) {
    const picked = supplyWhoNow();
    whoWrap.innerHTML = SUPPLY_KIDS.map((k) => `
      <button class="supply-kid ${picked === k.name ? 'on' : ''}" type="button"
        data-supply-who="${esc(k.name)}" aria-pressed="${picked === k.name}">
        <span class="supply-kid-avatar">${avatarHTML(k.key)}</span>${esc(k.name)}
      </button>`).join('');
  }
  const quick = $('supplyQuick');
  if (quick) {
    const typed = (($('supplyInput') || {}).value || '');
    quick.innerHTML = SUPPLY_QUICK.map((q) => `
      <button class="supply-chip ${typed.includes(q) ? 'picked' : ''}" type="button"
        data-supply-quick="${esc(q)}">${esc(q)}</button>`).join('');
  }
  const dueWrap = $('supplyDue');
  if (dueWrap) {
    dueWrap.innerHTML = SUPPLY_DUES.map((d) => `
      <button class="supply-due-chip ${d.cls} ${supplyDue === d.key ? 'on' : ''}" type="button"
        data-supply-due="${esc(d.key)}" aria-pressed="${supplyDue === d.key}">${d.emoji} ${esc(d.key)}</button>`).join('');
  }
}

function renderSupplies() {
  const list = $('supplyList');
  const doneBox = $('supplyDone');
  if (!list || !doneBox) return;
  renderSupplyChips();

  const rows = supplyRoster();
  const pending = rows
    .filter((x) => (Number(x.r[4]) || 0) === 0)
    .sort((a, b) => {
      const ra = SUPPLY_DUE_RANK[a.r[2]] == null ? 1 : SUPPLY_DUE_RANK[a.r[2]];
      const rb = SUPPLY_DUE_RANK[b.r[2]] == null ? 1 : SUPPLY_DUE_RANK[b.r[2]];
      return ra - rb || (b.r[3] || 0) - (a.r[3] || 0);
    });
  const done = rows
    .filter((x) => (Number(x.r[4]) || 0) > 0)
    .sort((a, b) => (b.r[4] || 0) - (a.r[4] || 0));

  const count = $('supplyCount');
  if (count) {
    count.textContent = `${pending.length}개 기다려요`;
    count.hidden = !pending.length;
  }

  list.innerHTML = pending.length
    ? pending.map(({ id, r }) => {
      const due = supplyDueMeta(r[2]);
      return `<div class="supply-item" data-supply="${esc(id)}">
        <div class="avatar supply-avatar">${avatarHTML(supplyMemberKey(r[0]))}</div>
        <div class="supply-body">
          <div class="supply-line">
            <span class="supply-name">${esc(r[0] || '우리 가족')}</span>
            <span class="supply-badge ${due.cls}">${due.emoji} ${esc(r[2])}</span>
          </div>
          <div class="supply-text">${esc(r[1])}</div>
          <div class="supply-time">${supplyDayLabel(r[3])} 요청</div>
        </div>
        <div class="supply-acts">
          <button class="supply-done-btn" type="button" data-supply-done="${esc(id)}">✅ 준비 완료</button>
          <button class="supply-del" type="button" data-supply-del="${esc(id)}" aria-label="요청 지우기">×</button>
        </div>
      </div>`;
    }).join('')
    : '<div class="supply-empty">아직 요청이 없어요. 필요한 게 있으면 위에서 골라 엄마한테 말해요 🎒</div>';

  const head = $('supplyDoneHead');
  if (head) head.hidden = !done.length;
  doneBox.innerHTML = done.map(({ id, r }) => `
    <div class="supply-item done" data-supply="${esc(id)}">
      <div class="avatar supply-avatar">${avatarHTML(supplyMemberKey(r[0]))}</div>
      <div class="supply-body">
        <div class="supply-line">
          <span class="supply-name">${esc(r[0] || '우리 가족')}</span>
          <span class="supply-badge ok">✅ 엄마 준비 완료!</span>
        </div>
        <div class="supply-text">${esc(r[1])}</div>
        <div class="supply-time">${supplyDayLabel(r[3])} 요청 · ${supplyDayLabel(r[4])} 준비</div>
      </div>
      <button class="supply-del" type="button" data-supply-del="${esc(id)}" aria-label="완료된 요청 지우기">×</button>
    </div>`).join('');
}

function supplyShakeWho() {
  const wrap = $('supplyWho');
  if (wrap) anim(wrap, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }
  ], { duration: 320 });
  supplySay('누가 요청하는지 먼저 골라 주세요!');
}

function supplyAdd() {
  const input = $('supplyInput');
  const who = supplyWhoNow();
  if (!who) { supplyShakeWho(); return; }
  const text = ((input && input.value) || '').replace(/\s+/g, ' ').trim().slice(0, SUPPLY_TEXT_MAX);
  if (!text) {
    supplySay('필요한 준비물을 적어 주세요. 아래 칩을 눌러도 돼요!');
    if (input) { try { input.focus(); } catch (e) {} }
    const quick = $('supplyQuick');
    if (quick) anim(quick, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 340 });
    return;
  }
  const id = ri();
  state.supplies[id] = [who, text, supplyDue, now(), 0];
  supplyWho = who;
  if (input) input.value = '';
  saveState();
  renderSupplies();
  schedulePublish(0);
  audio();
  beep(1040, 0.1);
  beep(1320, 0.13, 0.1);
  supplySay(`✅ ${who}의 요청을 엄마한테 보냈어요!`);
  const el = list4Id('supplyList', id);
  if (el) {
    el.classList.add('pop');
    setTimeout(() => { try { el.classList.remove('pop'); } catch (e) {} }, 900);
  }
}

function list4Id(boxId, id) {
  const box = $(boxId);
  if (!box) return null;
  const all = box.querySelectorAll('[data-supply]');
  for (let i = 0; i < all.length; i++) {
    if (all[i].getAttribute('data-supply') === id) return all[i];
  }
  return null;
}

function supplyComplete(id) {
  const r = state.supplies[id];
  if (!r || (Number(r[4]) || 0) !== 0) return;
  r[4] = now();
  saveState();
  renderSupplies();
  schedulePublish(0);
  audio();
  beep(1180, 0.12);
  beep(1480, 0.14, 0.12);
  if (navigator.vibrate) { try { navigator.vibrate([110, 60, 110]); } catch (e) {} }
}

function supplyDelete(id) {
  const r = state.supplies[id];
  if (!r) return;
  r[4] = -now();                    // 지운 표시 — 다른 기기에도 퍼져서 목록에서 사라져요
  saveState();
  renderSupplies();
  schedulePublish(0);
  audio();
  beep(620, 0.1);
}

function supplyClearDone() {
  const rows = supplyRoster().filter((x) => (Number(x.r[4]) || 0) > 0);
  if (!rows.length) return;
  const t = now();
  rows.forEach(({ id }) => { state.supplies[id][4] = -t; });
  saveState();
  renderSupplies();
  schedulePublish(0);
  audio();
  beep(700, 0.12);
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
    anim(b, [{ transform: 'scale(1)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 220 });
  });

  // 미션
  $('rerollMission').addEventListener('click', () => {
    audio();
    beep(760, 0.1);
    beep(1020, 0.1, 0.08);
    setMissionRandom(true);
    const el = $('missionText');
    anim(el, [{ transform: 'rotate(-1.5deg)' }, { transform: 'rotate(1.5deg)' }, { transform: 'rotate(0)' }], { duration: 260 });
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
  // 사진 보내기
  $('photoBtn').addEventListener('click', () => {
    if (!room) return;
    if (!getMe()) { hintWho(); return; }
    photoNote('');
    $('photoInput').click();
  });
  $('photoInput').addEventListener('change', (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = '';                       // 같은 사진을 다시 골라도 동작하도록
    if (file) sendPhotoFile(file);
  });
  // 사진이 만료됐거나 지워졌을 때 안내로 바꿔 줍니다
  $('chatLog').addEventListener('error', (e) => {
    const el = e.target;
    if (!el || !el.classList) return;
    // 음성메시지는 3시간이 지나면 재생 대신 만료 안내로 바뀌어요
    if (el.classList.contains('chat-voice')) {
      const wrap = el.closest ? el.closest('.voice-wrap') : null;
      if (wrap) {
        wrap.classList.add('gone');
        el.removeAttribute('src');
        try { el.load(); } catch (err) {}
      }
      return;
    }
    const img = el;
    if (!img.classList.contains('chat-photo')) return;
    const link = img.closest ? img.closest('.photo-link') : null;
    if (!link) return;
    link.classList.add('gone');
    link.removeAttribute('href');
    link.removeAttribute('data-photo');
  }, true);
  // 음성메시지 녹음·보내기
  $('voiceBtn').addEventListener('click', toggleVoice);
  // 사진 크게 보기 — 열기 / 닫기
  $('photoView').addEventListener('click', (e) => {
    if (e.target.id === 'photoView' || e.target.id === 'photoViewClose') closePhotoView();
  });
  $('chatLog').addEventListener('click', (e) => {
    const ph = e.target.closest('[data-photo]');
    if (ph) {
      e.preventDefault();
      openPhotoView(ph.getAttribute('href'));
      return;
    }
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

  // 등교 준비 도우미
  $('prepToggle').addEventListener('change', (e) => {
    store.set(LS.prepOn, e.target.checked ? '1' : '0');
    audio(); beep(e.target.checked ? 960 : 620, 0.1);
    prepTick();
  });
  $('prepStart').addEventListener('change', (e) => {
    const v = hmToMin(e.target.value) != null ? e.target.value : PREP_DEFAULT_START;
    e.target.value = v;
    store.set(LS.prepStart, v);
    prepTick();
  });
  $('prepEnd').addEventListener('change', (e) => {
    const v = hmToMin(e.target.value) != null ? e.target.value : PREP_DEFAULT_END;
    e.target.value = v;
    store.set(LS.prepEnd, v);
    prepTick();
  });
  $('prepWeekday').addEventListener('change', (e) => {
    store.set(LS.prepWeekday, e.target.checked ? '1' : '0');
    audio(); beep(840, 0.09);
    prepTick();
  });
  $('prepPreviewBtn').addEventListener('click', () => {
    prepPreview = true;
    store.set(LS.prepDismiss, '0');
    audio(); beep(900, 0.1);
    closeSheet();
    prepOpen();
    prepTick();
  });
  $('prepPeekTop').addEventListener('click', prepPeek);
  $('prepPeekBottom').addEventListener('click', prepPeek);
  $('prepTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prep-kid]');
    if (!b) return;
    prepKid = b.dataset.prepKid === 'doeun' ? 'doeun' : 'dowan';
    audio(); beep(880, 0.08);
    renderPrep();
  });
  $('prepCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prep-item]');
    if (!b) return;
    prepToggleItem(b.dataset.kid === 'doeun' ? 'doeun' : 'dowan', Number(b.dataset.prepItem));
  });

  // 준비물 요청
  $('supplyWho').addEventListener('click', (e) => {
    const b = e.target.closest('[data-supply-who]');
    if (!b) return;
    supplyWho = b.dataset.supplyWho === '도은' ? '도은' : '도완';
    audio(); beep(880, 0.08);
    renderSupplyChips();
  });
  $('supplyQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-supply-quick]');
    if (!b) return;
    const label = b.dataset.supplyQuick || '';
    const input = $('supplyInput');
    if (!input || !label) return;
    const cur = input.value.trim();
    if (cur.includes(label)) { audio(); beep(620, 0.08); return; }
    const join = cur ? `${cur}, ${label}` : label;
    input.value = (join.length <= SUPPLY_TEXT_MAX ? join : label).slice(0, SUPPLY_TEXT_MAX);
    audio(); beep(980, 0.08);
    renderSupplyChips();
  });
  $('supplyDue').addEventListener('click', (e) => {
    const b = e.target.closest('[data-supply-due]');
    if (!b) return;
    supplyDue = SUPPLY_DUES.some((d) => d.key === b.dataset.supplyDue) ? b.dataset.supplyDue : '내일까지';
    audio(); beep(920, 0.08);
    renderSupplyChips();
  });
  $('supplyInput').addEventListener('input', renderSupplyChips);
  $('supplyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); supplyAdd(); }
  });
  $('supplySend').addEventListener('click', supplyAdd);
  $('supplyList').addEventListener('click', (e) => {
    const d = e.target.closest('[data-supply-done]');
    if (d) { supplyComplete(d.dataset.supplyDone); return; }
    const x = e.target.closest('[data-supply-del]');
    if (x) supplyDelete(x.dataset.supplyDel);
  });
  $('supplyDone').addEventListener('click', (e) => {
    const x = e.target.closest('[data-supply-del]');
    if (x) supplyDelete(x.dataset.supplyDel);
  });
  $('supplyClear').addEventListener('click', supplyClearDone);

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
  $('relock').addEventListener('click', () => {
    if (!confirm('이 기기를 잠그고 가족 비밀번호를 다시 넣을까요?\n가족 모두 같은 새 비밀번호로 다시 들어가야 해요.')) return;
    closeSheet();
    lockApp('비밀번호를 다시 넣어 주세요');
  });
  $('soundTest').addEventListener('click', () => { audio(); chime(); });
  $('resetDevice').addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 기록과 선택한 사용자, 기억해 둔 가족 비밀번호까지 지울까요? (가족 공용 기록은 그대로 남아요)')) return;
    suppressSave = true;
    [LS.state, LS.me, LS.city, LS.city + '_coords', LS.bed, LS.bedTime, LS.bedLast, LS.timer, LS.roomKey,
      LS.prepOn, LS.prepStart, LS.prepEnd, LS.prepWeekday, LS.prepDismiss].forEach((k) => store.del(k));
    room = '';
    location.replace(location.pathname);   // 잠금 화면으로 돌아갑니다
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // 화면이 다시 보이면 조건 없이 바로 받아오고, 실시간 연결도 새로 맺어요.
    // (모바일은 EventSource가 조용히 멈춰도 readyState가 OPEN으로 남아 있어요.)
    pollOnce(false);
    startStream();
    loadWeather(false);
  });
  window.addEventListener('online', () => {
    pollOnce(false);
    startStream();
    if (pendingPublish) schedulePublish(100);
  });
  const syncBtn = $('syncNow');
  if (syncBtn) syncBtn.addEventListener('click', syncNow);
  const settingsSyncBtn = $('settingsSyncNow');
  if (settingsSyncBtn) settingsSyncBtn.addEventListener('click', syncNow);
}

function hintWho() {
  const p = $('whoPills');
  anim(p, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  $('whoHint').textContent = '먼저 위에서 "이 기기에서 쓰는 사람"을 골라 주세요!';
  $('whoPills').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function sendChat(text, isSticker, photoUrl, voiceUrl, voiceSec) {
  const t = (text || '').trim();
  const photo = safePhotoUrl(photoUrl);
  const voice = safePhotoUrl(voiceUrl);
  if (!t && !photo && !voice) return;
  const me = getMe();
  if (!me) { hintWho(); return; }
  const id = ri();
  const entry = [me, now(), t.slice(0, 200)];
  if (photo) entry[3] = photo;         // 네 번째 칸: 사진 주소 (글 없이 사진만 보낸 경우 text는 빈 문자열)
  if (voice) {                         // 다섯·여섯 번째 칸: 음성메시지 주소와 길이(초)
    entry[4] = voice;
    entry[5] = Math.max(0, Math.round(Number(voiceSec) || 0));
  }
  state.chat[id] = entry;
  saveState();
  renderChat();
  schedulePublish(0);
  if (!isSticker) { const inp = $('chatInput'); if (inp) inp.value = ''; }
  photoNote('');
  beep(1040, 0.09);
}

/* ============================== 채팅 사진 ============================== */
/* 사진은 ① 휴대폰에서 고른 그림을 캔버스로 줄이고 ② ntfy 사진 전용 주제에 PUT으로 올리고
   ③ 돌려받은 주소만 채팅 메시지 네 번째 칸에 넣어 보냅니다.
   ntfy가 3시간만 보관하므로, 그 뒤에 열면 앱이 "만료된 사진" 안내를 보여 줍니다. */
let photoBusy = false;

function safePhotoUrl(u) {
  return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) ? u : '';
}

function photoNote(text) {
  const el = $('photoNote');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

function photoBusyUI(busy) {
  photoBusy = !!busy;
  const btn = $('photoBtn');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.classList.toggle('busy', !!busy);
  btn.textContent = busy ? '⏳' : '📷';
}

/* 고른 사진을 긴 쪽 960px · JPEG 0.78로 줄입니다 */
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!window.URL || !URL.createObjectURL || !document.createElement('canvas').getContext) {
      reject(new Error('unsupported'));
      return;
    }
    const src = URL.createObjectURL(file);
    const img = new Image();
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(src); } catch (e) {}
      fn(v);
    };
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || img.width;
        const h0 = img.naturalHeight || img.height;
        if (!w0 || !h0) { finish(reject, new Error('empty')); return; }
        const scale = Math.min(1, PHOTO_MAX_PX / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { finish(reject, new Error('canvas')); return; }
        ctx.fillStyle = '#FFFFFF';                 // 투명한 그림도 하얀 바탕으로
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        if (!canvas.toBlob) { finish(reject, new Error('blob')); return; }
        canvas.toBlob((blob) => {
          if (blob) finish(resolve, blob);
          else finish(reject, new Error('blob'));
        }, 'image/jpeg', PHOTO_QUALITY);
      } catch (err) {
        finish(reject, err);
      }
    };
    img.onerror = () => finish(reject, new Error('decode'));
    img.src = src;
  });
}

/* 사진 전용 주제에 올리고 주소를 돌려받습니다 */
function putPhoto(blob) {
  return new Promise((resolve, reject) => {
    if (!room) { reject(new Error('locked')); return; }
    const topic = room + PHOTO_TOPIC_TAIL;
    const name = 'photo-' + Date.now().toString(36) + '.jpg';
    fetch(NTFY + '/' + encodeURIComponent(topic), {
      method: 'PUT',
      headers: { 'Filename': name, 'Content-Type': 'image/jpeg' },
      body: blob
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then((obj) => {
      const url = obj && obj.attachment && obj.attachment.url ? String(obj.attachment.url) : '';
      if (!safePhotoUrl(url)) throw new Error('no-url');
      resolve(url);
    }).catch(reject);
  });
}

async function sendPhotoFile(file) {
  if (!file || photoBusy) return;
  if (!room) return;
  const me = getMe();
  if (!me) { hintWho(); return; }
  if (file.type && String(file.type).indexOf('image/') !== 0) {
    photoNote('사진 파일만 보낼 수 있어요');
    return;
  }
  const caption = (($('chatInput') || {}).value || '').trim();
  photoNote('');
  photoBusyUI(true);
  let blob;
  try {
    blob = await shrinkPhoto(file);
  } catch (e) {
    photoBusyUI(false);
    photoNote('이 사진은 보낼 수 없어요. JPG · PNG 사진으로 다시 굴라 주세요');
    return;
  }
  photoNote('사진 올리는 중…');
  try {
    const url = await putPhoto(blob);
    photoBusyUI(false);
    sendChat(caption, false, url);
  } catch (e) {
    photoBusyUI(false);
    photoNote('사진을 올리지 못했어요. 잠시 뒤 다시 해 보세요');
  }
}

/* ============================== 채팅 음성메시지 ============================== */
/* ① 마이크로 그대로 녹음해 ② 사진과 같은 ntfy 파일 주제(`방이름-files`)에 PUT으로 올리고
   ③ 돌려받은 주소만 채팅 다섯 번째 칸에 넣어 보냅니다.
   ntfy가 3시간만 보관하므로, 그 뒤에 열면 앱이 "만료된 음성메시지" 안내를 보여 줍니다. */
const VOICE_MAX_SEC = 60;                            // 한 번에 녹음할 수 있는 최대 길이
const VOICE_KEEP_HOURS = 3;                          // ntfy에 음성이 보관되는 시간
const VOICE_TYPES = [                                // 휴대폰·아이폰·크롬에서 고를 수 있는 형식
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg'
];

const voiceRec = {
  rec: null, stream: null, chunks: [], startedAt: 0, sec: 0,
  timer: null, busy: false, finishing: false
};

function voiceSecLabel(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function voiceSupported() {
  return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/* 기기가 받아 주는 녹음 형식을 찾아 옵니다 (아이폰은 mp4, 안드로이드·크롬은 webm) */
function pickVoiceMime() {
  const MR = window.MediaRecorder;
  if (!MR) return '';
  if (typeof MR.isTypeSupported !== 'function') return '';
  for (let i = 0; i < VOICE_TYPES.length; i++) {
    if (MR.isTypeSupported(VOICE_TYPES[i])) return VOICE_TYPES[i];
  }
  return '';
}

function voiceBtnDraw() {
  const btn = $('voiceBtn');
  if (!btn) return;
  const recording = !!(voiceRec.rec && voiceRec.rec.state === 'recording');
  if (recording) {
    btn.classList.add('rec');
    btn.classList.remove('busy');
    btn.textContent = '⏹️ ' + voiceSecLabel(voiceRec.sec);
    btn.setAttribute('aria-label', '녹음 끝내고 보내기');
    btn.setAttribute('title', '녹음 끝내고 보내기');
  } else if (voiceRec.busy) {
    btn.classList.remove('rec');
    btn.classList.add('busy');
    btn.textContent = '⏳';
    btn.setAttribute('aria-label', '음성메시지 올리는 중');
    btn.setAttribute('title', '음성메시지 올리는 중');
  } else {
    btn.classList.remove('rec');
    btn.classList.remove('busy');
    btn.textContent = '🎙️';
    btn.setAttribute('aria-label', '음성메시지 녹음');
    btn.setAttribute('title', '음성메시지 보내기');
  }
}

function stopVoiceTracks() {
  if (voiceRec.stream) {
    try { voiceRec.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }
  voiceRec.stream = null;
}

async function startVoice() {
  if (!room || voiceRec.busy) return;
  photoNote('');
  if (!voiceSupported()) {
    photoNote('이 브라우저에서는 음성메시지를 녹음할 수 없어요. https 주소로 휴대폰 크롬·사파리에서 열어 주세요');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      photoNote('마이크 사용을 허용해 주세요. 주소창 옆 🔒 에서 마이크를 켜면 녹음할 수 있어요');
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      photoNote('마이크를 찾지 못했어요. 마이크가 있는 기기에서 다시 해 봐요');
    } else {
      photoNote('마이크를 켜지 못했어요. 잠시 뒤 다시 해 보세요');
    }
    return;
  }

  const mime = pickVoiceMime();
  let rec = null;
  try {
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    try { rec = new MediaRecorder(stream); } catch (e2) { rec = null; }
  }
  if (!rec) {
    stopVoiceTracks();
    photoNote('녹음을 시작하지 못했어요. 잠시 뒤 다시 해 보세요');
    return;
  }

  voiceRec.stream = stream;
  voiceRec.rec = rec;
  voiceRec.chunks = [];
  voiceRec.sec = 0;
  voiceRec.startedAt = now();
  rec.ondataavailable = (e) => { if (e.data && e.data.size) voiceRec.chunks.push(e.data); };
  rec.onstop = () => { finishVoice(); };
  try {
    rec.start(250);                                    // 0.25초마다 조각을 모아요
  } catch (e) {
    voiceRec.rec = null;
    stopVoiceTracks();
    photoNote('녹음을 시작하지 못했어요. 잠시 뒤 다시 해 보세요');
    return;
  }

  audio();
  beep(880, 0.08);
  photoNote(`녹음 중… 다 말했으면 🎙️ 를 다시 눌러 주세요 (최대 ${VOICE_MAX_SEC}초)`);
  voiceBtnDraw();
  voiceRec.timer = setInterval(() => {
    voiceRec.sec = (now() - voiceRec.startedAt) / 1000;
    if (voiceRec.sec >= VOICE_MAX_SEC) {
      voiceRec.sec = VOICE_MAX_SEC;
      stopVoice();
      return;
    }
    voiceBtnDraw();
  }, 200);
}

function stopVoice() {
  const rec = voiceRec.rec;
  clearInterval(voiceRec.timer);
  voiceRec.timer = null;
  if (voiceRec.startedAt) {
    voiceRec.sec = Math.min(VOICE_MAX_SEC, (now() - voiceRec.startedAt) / 1000);
  }
  if (!rec) { finishVoice(); return; }
  if (rec.state === 'inactive') { finishVoice(); return; }
  try { rec.stop(); } catch (e) { finishVoice(); }
}

async function finishVoice() {
  if (voiceRec.finishing) return;
  voiceRec.finishing = true;
  try {
    const rec = voiceRec.rec;
    const mime = (rec && rec.mimeType) || 'audio/webm';
    const sec = Math.max(1, Math.round(voiceRec.sec));
    voiceRec.rec = null;
    clearInterval(voiceRec.timer);
    voiceRec.timer = null;
    voiceRec.startedAt = 0;
    stopVoiceTracks();
    const blob = new Blob(voiceRec.chunks, { type: String(mime).split(';')[0] || 'audio/webm' });
    voiceRec.chunks = [];
    if (!blob.size) {
      voiceBtnDraw();
      photoNote('녹음된 소리가 없어요. 다시 한 번 말해 볼까요?');
      return;
    }
    voiceRec.busy = true;
    voiceBtnDraw();
    photoNote('음성메시지 올리는 중…');
    let url;
    try {
      url = await putVoice(blob, mime);
    } catch (e) {
      voiceRec.busy = false;
      voiceBtnDraw();
      photoNote('음성메시지를 올리지 못했어요. 잠시 뒤 다시 해 보세요');
      return;
    }
    voiceRec.busy = false;
    voiceBtnDraw();
    photoNote('');
    sendChat('', false, '', url, sec);
  } finally {
    voiceRec.finishing = false;
  }
}

/* 사진과 같은 파일 주제에 올리고 주소를 돌려받습니다 */
function putVoice(blob, mime) {
  return new Promise((resolve, reject) => {
    if (!room) { reject(new Error('locked')); return; }
    const topic = room + PHOTO_TOPIC_TAIL;
    const base = String(mime || '').split(';')[0].trim().toLowerCase();
    const ext = base === 'audio/mp4' ? 'm4a'
      : base === 'audio/ogg' ? 'ogg'
      : base === 'audio/mpeg' ? 'mp3'
      : 'webm';
    const type = base || 'audio/webm';
    const name = 'voice-' + Date.now().toString(36) + '.' + ext;
    fetch(NTFY + '/' + encodeURIComponent(topic), {
      method: 'PUT',
      headers: { 'Filename': name, 'Content-Type': type },
      body: blob
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then((obj) => {
      const url = obj && obj.attachment && obj.attachment.url ? String(obj.attachment.url) : '';
      if (!safePhotoUrl(url)) throw new Error('no-url');
      resolve(url);
    }).catch(reject);
  });
}

/* 🎙️ 한 번: 녹음 시작 / 다시 한 번: 녹음 끝내고 바로 보내기 */
function toggleVoice() {
  if (!room) return;
  if (!getMe()) { hintWho(); return; }
  if (voiceRec.rec && voiceRec.rec.state === 'recording') stopVoice();
  else if (!voiceRec.busy) startVoice();
}

/* 시진 크게 보기 */
function openPhotoView(url) {
  const view = $('photoView');
  const img = $('photoViewImg');
  if (!view || !img || !safePhotoUrl(url)) return;
  img.src = url;
  view.hidden = false;
}

function closePhotoView() {
  const view = $('photoView');
  const img = $('photoViewImg');
  if (view) view.hidden = true;
  if (img) img.removeAttribute('src');
}

function openSheet() {
  const sel = $('citySelect');
  const city = store.get(LS.city, '대구');
  sel.innerHTML = CITIES.map((c) => `<option value="${esc(c[0])}" ${c[0] === city ? 'selected' : ''}>${esc(c[0])}</option>`).join('')
    + `<option value="__custom" ${!CITIES.some((c) => c[0] === city) ? 'selected' : ''}>직접 입력…</option>`;
  $('customCityRow').hidden = CITIES.some((c) => c[0] === city);
  const lockState = $('lockState');
  if (lockState) lockState.textContent = room ? '🔒 잠금 켜짐' : '잠김';
  const ps = prepSettings();
  if ($('prepToggle')) $('prepToggle').checked = ps.on;
  if ($('prepStart')) $('prepStart').value = ps.start;
  if ($('prepEnd')) $('prepEnd').value = ps.end;
  if ($('prepWeekday')) $('prepWeekday').checked = ps.weekday;
  if ($('syncInfo')) renderSyncInfo();
  $('settingsSheet').hidden = false;
}
function closeSheet() { $('settingsSheet').hidden = true; }

/* ============================== 가족 비밀번호 잠금 ============================== */
/* 가족 비밀번호를 그대로 보내지 않고, 정해진 규칙으로 방 이름을 계산해 씁니다. */
function hexOf(buf) {
  return Array.prototype.map.call(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function canCrypto() {
  return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
}

async function deriveRoom(password) {
  const data = new TextEncoder().encode(ROOM_SALT + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return ROOM_PREFIX + hexOf(digest).slice(0, ROOM_KEY_HEX);
}

let appStarted = false;

function lockError(text) {
  const err = $('lockError');
  if (err) { err.textContent = text; err.hidden = false; }
  const card = $('lockCard');
  anim(card, [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-7px)' },
    { transform: 'translateX(7px)' },
    { transform: 'translateX(0)' }
  ], { duration: 300 });
}

function showLock(message) {
  const el = $('lockScreen');
  if (!el) return;
  el.hidden = false;
  document.body.classList.add('locked');
  const input = $('lockInput');
  if (input) { input.value = ''; input.type = 'password'; }
  const eye = $('lockEye');
  if (eye) { eye.textContent = '👁️'; eye.setAttribute('aria-label', '비밀번호 보기'); }
  const note = $('lockNote');
  if (note) note.textContent = message || '가족 모두 같은 비밀번호를 넣어야 함께 보여요\n한 번 넣으면 이 기기는 기억해요 💛';
  const err = $('lockError');
  if (err) { err.hidden = true; err.textContent = ''; }
  setTimeout(() => { try { input.focus(); } catch (e) {} }, 80);
}

function hideLock() {
  const el = $('lockScreen');
  if (el) el.hidden = true;
  document.body.classList.remove('locked');
}

function setLockBusy(busy) {
  const btn = $('lockGo');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? '들어가는 중…' : '들어가기';
}

async function tryUnlock() {
  const input = $('lockInput');
  const raw = ((input && input.value) || '').trim();
  if (raw.length < MIN_PW_LEN) {
    lockError(`가족끼리 정한 비밀번호를 ${MIN_PW_LEN}글자 이상 넣어 주세요`);
    return;
  }
  if (!canCrypto()) {
    lockError('이 브라우저에서는 잠금 화면을 쓸 수 없어요. https 주소로 열어 주세요.');
    return;
  }
  setLockBusy(true);
  try {
    const key = await deriveRoom(raw);
    room = key;
    store.set(LS.roomKey, key);
    if (input) input.value = '';
    hideLock();
    if (!appStarted) { appStarted = true; startApp(); }
    restartSync();
  } catch (e) {
    lockError('비밀번호를 확인하지 못했어요. 다시 한 번 눌러 주세요');
  } finally {
    setLockBusy(false);
  }
}

function lockApp(message) {
  closeStream();
  stopPolling();
  clearTimeout(pubTimer);
  clearTimeout(sseRetryTimer);
  room = '';
  store.del(LS.roomKey);
  lastMsgTime = 0;
  lastSyncAt = 0;
  setStatus('wait');
  showLock(message);
}

function bindLock() {
  const form = $('lockForm');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); tryUnlock(); });
  const eye = $('lockEye');
  if (eye) eye.addEventListener('click', () => {
    const input = $('lockInput');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.textContent = show ? '🙈' : '👁️';
    eye.setAttribute('aria-label', show ? '비밀번호 가리기' : '비밀번호 보기');
    try { input.focus(); } catch (e) {}
  });
}

/* ============================== 시작 ============================== */
function startApp() {
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
  setInterval(prepTick, 1000);              // 등교 준비 시간이면 화면을 바꿔요
  prepTick();
}

/* 지금 동기화: 한 번 받아오고(pollOnce) 가족에게 "지금 상태 알려줘"를 보내요 */
async function syncNow() {
  if (!room) { setStatus('wait', '가족 비밀번호를 넣어 주세요'); return; }
  const buttons = [$('syncNow'), $('settingsSyncNow')].filter(Boolean);
  buttons.forEach((b) => { b.classList.add('spin'); b.disabled = true; });
  setStatus('wait', '지금 동기화 중…');
  try {
    await pollOnce(false);
    await publish({ f: DEVICE, hello: 1 });
    startStream();                                     // 실시간 연결도 새로 맺어 둬요
  } catch (e) {}
  buttons.forEach((b) => { b.classList.remove('spin'); b.disabled = false; });
}

/* 동기화 시작: 최근 12시간 기록 받아 병합 → 실시간 연결 */
function restartSync() {
  if (!room) return;
  closeStream();
  stopPolling();
  lastMsgTime = 0;
  setStatus('wait');
  (async () => {
    await pollOnce(true);
    renderAll();
    startStream();
    // 켤 때는 상태를 올리지 않고 가족에게 "지금 상태 알려줘"만 보냅니다.
    publish({ f: DEVICE, hello: 1 });
  })();
}

function boot() {
  bindEvents();
  bindLock();

  store.del(LS.oldRoom);                 // 예전 버전의 방 코드는 더 쓰지 않아요

  window.addEventListener('pagehide', () => { if (!suppressSave) saveState(); });

  const saved = store.get(LS.roomKey, '');
  if (saved) {
    room = saved;
    hideLock();
    appStarted = true;
    startApp();
    restartSync();
  } else {
    room = '';
    setStatus('wait', '가족 비밀번호를 넣어 주세요');
    showLock();
  }
}

document.addEventListener('DOMContentLoaded', boot);
