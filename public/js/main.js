import { CATEGORIES, calculateScore, UPPER_BONUS_THRESHOLD } from './scoring.js';
import { createDie } from './dice3d.js';

const MINOR = [
  { key: 'aces', pips: 1 },
  { key: 'twos', pips: 2 },
  { key: 'threes', pips: 3 },
  { key: 'fours', pips: 4 },
  { key: 'fives', pips: 5 },
  { key: 'sixes', pips: 6 },
];
const MAJOR_TOP = [
  { key: 'threeKind', label: '3x' },
  { key: 'fourKind', label: '4x' },
  { key: 'fullHouse', label: '🏠' },
  { key: 'smallStraight', label: 'SM' },
  { key: 'largeStraight', label: 'LG' },
  { key: 'yatzy', label: 'YAT' },
];
const LABELS = {
  aces: '1', twos: '2', threes: '3', fours: '4', fives: '5', sixes: '6',
  threeKind: '3 of a Kind', fourKind: '4 of a Kind', fullHouse: '풀하우스',
  smallStraight: '스몰 스트레이트', largeStraight: '라지 스트레이트',
  yatzy: 'YATZY!', chance: '찬스',
};

const $ = (id) => document.getElementById(id);
const screens = { lobby: $('lobby'), waiting: $('waiting'), game: $('game'), result: $('result') };

function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle('hidden', key !== name);
}

function pid() {
  let v = localStorage.getItem('yatzy_pid');
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem('yatzy_pid', v);
  }
  return v;
}

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function toast(msg) {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------------------------------------------------------------- app state

let ws = null;
let myIndex = null;
let roomCode = null;
let prevState = null;
let diceApi = [];
let cellRefs = { 0: {}, 1: {} };
let chatRenderedCount = 0;
let chatOpen = false;
let chatUnread = 0;
let chatFirstRender = true; // avoid a toast storm when catching up on reconnect
let achieveHideTimer = null;
let intentionalDisconnect = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

function wsUrl(room, name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}&pid=${encodeURIComponent(pid())}`;
}

function connect(room, name, { silent = false, isReconnect = false } = {}) {
  if (ws) { try { ws.close(); } catch {} }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  intentionalDisconnect = false;
  roomCode = room;
  if (!isReconnect) {
    myIndex = null;
    prevState = null;
    resetChat();
  }
  ws = new WebSocket(wsUrl(room, name));
  let helloReceived = false;

  const failTimer = setTimeout(() => {
    if (!helloReceived) {
      ws.close();
      onConnectFailed(silent);
    }
  }, 5000);

  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'hello') {
      helloReceived = true;
      reconnectAttempts = 0;
      clearTimeout(failTimer);
      myIndex = msg.you;
      sessionStorage.setItem('yatzy_session', JSON.stringify({ room, name }));
    } else if (msg.type === 'state') {
      onState(msg);
    } else if (msg.type === 'error') {
      toast(msg.message || '오류가 발생했습니다');
    }
  });
  ws.addEventListener('close', () => {
    clearTimeout(failTimer);
    if (!helloReceived) {
      onConnectFailed(silent);
      return;
    }
    // The socket died mid-session (mobile tab backgrounded, brief network
    // drop, etc). Reconnect automatically instead of leaving the room stuck
    // showing the other player as permanently disconnected.
    if (!intentionalDisconnect) scheduleReconnect(room, name);
  });
  ws.addEventListener('error', () => {});
}

function scheduleReconnect(room, name) {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 8000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (intentionalDisconnect) return;
    connect(room, name, { silent: true, isReconnect: true });
  }, delay);
}

function onConnectFailed(silent) {
  sessionStorage.removeItem('yatzy_session');
  if (!silent) {
    $('lobbyMsg').textContent = '방을 찾을 수 없거나 가득 찼습니다.';
  }
  showScreen('lobby');
}

function leaveRoom() {
  intentionalDisconnect = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) { try { ws.close(); } catch {} }
  ws = null;
  myIndex = null;
  prevState = null;
  sessionStorage.removeItem('yatzy_session');
  closeChat();
  stopHeartRain();
  $('achieveFx').classList.remove('play');
  clearTimeout(achieveHideTimer);
  $('consentModal').classList.remove('open');
  $('consentBackdrop').classList.remove('open');
  showScreen('lobby');
}

// ------------------------------------------------------------------ board

const PIP_ON = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function buildPipGrid(n, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = 'pip-mini' + (extraClass ? ' ' + extraClass : '');
  const on = PIP_ON[n] || [];
  for (let i = 1; i <= 9; i++) {
    const s = document.createElement('span');
    s.className = 'pip' + (on.includes(i) ? ' on' : '');
    wrap.appendChild(s);
  }
  return wrap;
}

function makeScoreCell(catKey, playerIdx) {
  const el = document.createElement('div');
  el.className = 'score-cell';
  el.textContent = '';
  if (playerIdx === 0 || playerIdx === 1) {
    cellRefs[playerIdx][catKey] = el;
    el.addEventListener('click', () => attemptScore(catKey, playerIdx));
  }
  return el;
}

function buildBoard() {
  const rows = $('boardRows');
  rows.innerHTML = '';
  cellRefs = { 0: {}, 1: {} };

  for (let i = 0; i < 6; i++) {
    const row = document.createElement('div');
    row.className = 'board-row';

    const minorIcon = document.createElement('div');
    minorIcon.className = 'cat-icon';
    minorIcon.appendChild(buildPipGrid(MINOR[i].pips));
    row.appendChild(minorIcon);
    row.appendChild(makeScoreCell(MINOR[i].key, 0));
    row.appendChild(makeScoreCell(MINOR[i].key, 1));

    const majorIcon = document.createElement('div');
    majorIcon.className = 'cat-icon';
    majorIcon.textContent = MAJOR_TOP[i].label;
    row.appendChild(majorIcon);
    row.appendChild(makeScoreCell(MAJOR_TOP[i].key, 0));
    row.appendChild(makeScoreCell(MAJOR_TOP[i].key, 1));

    rows.appendChild(row);
  }

  // bonus / chance row
  const row = document.createElement('div');
  row.className = 'board-row';
  const bonusLabel = document.createElement('div');
  bonusLabel.className = 'bonus-label';
  bonusLabel.innerHTML = `BONUS<br><span>+35</span>`;
  row.appendChild(bonusLabel);
  const b0 = document.createElement('div');
  b0.className = 'bonus-cell';
  b0.id = 'bonusCell0';
  row.appendChild(b0);
  const b1 = document.createElement('div');
  b1.className = 'bonus-cell';
  b1.id = 'bonusCell1';
  row.appendChild(b1);

  const chanceIcon = document.createElement('div');
  chanceIcon.className = 'cat-icon';
  chanceIcon.textContent = '?';
  row.appendChild(chanceIcon);
  row.appendChild(makeScoreCell('chance', 0));
  row.appendChild(makeScoreCell('chance', 1));
  rows.appendChild(row);
}

function buildDice() {
  const host = $('diceRow');
  host.innerHTML = '';
  diceApi = [];
  for (let i = 0; i < 5; i++) {
    const wrap = document.createElement('div');
    host.appendChild(wrap);
    const api = createDie(wrap);
    api.setValue(1, { animate: false });
    api.el.addEventListener('click', () => toggleHold(i));
    diceApi.push(api);
  }
}

// ------------------------------------------------------------------ actions

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function rollDice() { send({ type: 'roll' }); }
function toggleHold(i) { send({ type: 'hold', index: i }); }
function attemptScore(catKey, playerIdx) {
  if (playerIdx !== myIndex) return;
  if (!prevState || prevState.turn !== myIndex) return;
  if (prevState.pendingExtraRoll && prevState.pendingExtraRoll.by === myIndex) return;
  const me = prevState.players[myIndex];
  if (!me || !me.rolled || me.scorecard[catKey] !== null) return;
  send({ type: 'score', category: catKey });
}

function requestExtraRoll() { send({ type: 'extraRollRequest' }); }
function respondExtraRoll(approve) { send({ type: 'extraRollRespond', approve }); }

// ------------------------------------------------------------------ chat

function resetChat() {
  chatRenderedCount = 0;
  chatUnread = 0;
  chatFirstRender = true;
  $('chatMessages').innerHTML = '';
  updateChatBadge();
  closeChat();
}

function renderChat(chat) {
  if (!chat) return;
  const host = $('chatMessages');
  const isCatchUp = chatFirstRender; // don't toast-storm old history on (re)join
  for (let i = chatRenderedCount; i < chat.length; i++) {
    const m = chat[i];
    const mine = m.idx === myIndex;
    const el = document.createElement('div');
    el.className = 'chat-msg ' + (mine ? 'me' : 'opp');
    const nameEl = document.createElement('span');
    nameEl.className = 'chat-msg-name';
    nameEl.textContent = mine ? '나' : m.name;
    const textEl = document.createElement('span');
    textEl.textContent = m.text;
    el.appendChild(nameEl);
    el.appendChild(textEl);
    host.appendChild(el);
    if (!mine) {
      if (!chatOpen) chatUnread++;
      if (!isCatchUp) toast(`💬 ${m.name}: ${m.text}`);
    }
  }
  chatRenderedCount = chat.length;
  chatFirstRender = false;
  updateChatBadge();
  if (chatOpen) host.scrollTop = host.scrollHeight;
}

function updateChatBadge() {
  const badge = $('chatBadge');
  badge.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
  badge.classList.toggle('hidden', chatUnread === 0);
}

function openChat() {
  chatOpen = true;
  chatUnread = 0;
  updateChatBadge();
  $('chatPanel').classList.add('open');
  $('chatBackdrop').classList.add('open');
  const host = $('chatMessages');
  host.scrollTop = host.scrollHeight;
  setTimeout(() => $('chatInput').focus(), 150);
}

function closeChat() {
  chatOpen = false;
  $('chatPanel').classList.remove('open');
  $('chatBackdrop').classList.remove('open');
}

function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  input.value = '';
}

// ------------------------------------------------------------------ fx

function stopHeartRain() {
  $('heartRain').innerHTML = '';
}

function startHeartRain() {
  const host = $('heartRain');
  if (host.childElementCount) return; // already raining
  const emojis = ['💗', '🩷', '💕'];
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('span');
    el.className = 'heart-drop';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.left = `${Math.random() * 100}%`;
    el.style.fontSize = `${14 + Math.random() * 18}px`;
    el.style.animationDuration = `${3 + Math.random() * 3}s`;
    el.style.animationDelay = `-${Math.random() * 5}s`;
    el.style.setProperty('--drift', `${Math.round(Math.random() * 60 - 30)}px`);
    host.appendChild(el);
  }
}

const ACHIEVEMENTS = {
  yatzy: { icon: '⛵', label: '요트(YACHT)', cls: 'type-yatzy', duration: 2700 },
  smallStraight: { icon: '🔥', label: '스몰 스트레이트', cls: 'type-small', duration: 2100 },
  largeStraight: { icon: '🌈', label: '라지 스트레이트', cls: 'type-large', duration: 2500 },
  fullHouse: { icon: '🏠', label: '풀하우스', cls: 'type-house', duration: 2500 },
};

function playAchieveEffect(catKey, name) {
  const conf = ACHIEVEMENTS[catKey];
  if (!conf) return;
  const fx = $('achieveFx');
  $('achieveIcon').textContent = conf.icon;
  $('achieveCaption').textContent = `🎉 ${name}님 ${conf.label}!! 🎉`;
  fx.className = 'achieve-fx ' + conf.cls;
  void fx.offsetWidth; // force reflow so the animation restarts on back-to-back achievements
  fx.classList.add('play');
  clearTimeout(achieveHideTimer);
  achieveHideTimer = setTimeout(() => fx.classList.remove('play'), conf.duration);
}

// ------------------------------------------------------------------ render

function updateCategoryCell(catKey, playerIdx, players, turn) {
  const el = cellRefs[playerIdx][catKey];
  if (!el) return;
  const p = players[playerIdx];
  const filled = p.scorecard[catKey];
  el.classList.remove('mine', 'available', 'preview', 'filled', 'empty-locked');
  if (filled !== null && filled !== undefined) {
    el.textContent = filled;
    el.classList.add('filled');
    return;
  }
  const isMine = playerIdx === myIndex;
  const canScore = isMine && p.rolled && turn === myIndex;
  if (canScore) {
    el.textContent = calculateScore(catKey, p.dice);
    el.classList.add('mine', 'available', 'preview');
  } else {
    el.textContent = '';
    el.classList.add('empty-locked');
  }
}

function upperSumOf(p) {
  let s = 0;
  for (const c of CATEGORIES) if (c.section === 'minor' && p.scorecard[c.key] != null) s += p.scorecard[c.key];
  return s;
}

function renderState(msg) {
  const { players, status, turn, pendingExtraRoll } = msg;
  if (!players[0] || !players[1]) return;

  $('p0Name').textContent = players[0].name;
  $('p1Name').textContent = players[1].name;
  $('p0Score').textContent = players[0].total;
  $('p1Score').textContent = players[1].total;

  const isMyTurn = status === 'playing' && turn === myIndex;
  $('p0Chip').classList.toggle('active', status === 'playing' && turn === 0);
  $('p1Chip').classList.toggle('active', status === 'playing' && turn === 1);

  for (const c of MINOR) { updateCategoryCell(c.key, 0, players, turn); updateCategoryCell(c.key, 1, players, turn); }
  for (const c of MAJOR_TOP) { updateCategoryCell(c.key, 0, players, turn); updateCategoryCell(c.key, 1, players, turn); }
  updateCategoryCell('chance', 0, players, turn);
  updateCategoryCell('chance', 1, players, turn);

  $('bonusCell0').textContent = `${Math.min(upperSumOf(players[0]), UPPER_BONUS_THRESHOLD)}/${UPPER_BONUS_THRESHOLD}`;
  $('bonusCell1').textContent = `${Math.min(upperSumOf(players[1]), UPPER_BONUS_THRESHOLD)}/${UPPER_BONUS_THRESHOLD}`;

  const me = players[myIndex];
  const oppIdx = myIndex === 0 ? 1 : 0;
  const opp = players[oppIdx];

  // Unified dice display: the single 3D dice row always shows whichever
  // player currently has the turn, roll animation included, so I watch my
  // opponent's roll live in the same place I roll my own (and vice versa)
  // instead of a separate mini-dice strip.
  const active = players[turn];
  const prevActive = prevState && prevState.turn === turn ? prevState.players[turn] : null;
  const justRolled = !!(prevActive && prevActive.rollsLeft > active.rollsLeft);
  active.dice.forEach((v, i) => {
    diceApi[i].setValue(v, { animate: justRolled && !active.held[i] });
    diceApi[i].setHeld(active.held[i]);
    diceApi[i].el.classList.toggle('readonly', !isMyTurn);
  });

  $('diceStatusName').textContent = isMyTurn ? '내 차례' : `${active.name}님 차례`;
  $('diceStatusRolls').textContent = !active.connected
    ? '연결 끊김'
    : `굴리기 ${active.rollsLeft}/3 남음`;
  $('diceStatus').classList.toggle('my-turn', isMyTurn);

  $('rollCount').textContent = me.rollsLeft;
  const canRoll = isMyTurn && me.rollsLeft > 0 && !me.finished;
  $('rollBtn').disabled = !canRoll;

  // mutual-consent extra roll: request button on the roller's side, a
  // consent modal on the other side
  const myPendingRequest = !!(pendingExtraRoll && pendingExtraRoll.by === myIndex);
  const oppPendingRequest = !!(pendingExtraRoll && pendingExtraRoll.by === oppIdx);
  const canRequestExtra = isMyTurn && me.rollsLeft === 0 && !me.finished && !pendingExtraRoll;
  const extraBtn = $('extraRollBtn');
  extraBtn.disabled = !canRequestExtra;
  extraBtn.classList.toggle('pending', myPendingRequest);
  let extraLabel = '🙏 +1 요청';
  if (myPendingRequest) extraLabel = '⏳ 응답 대기 중';
  else if (isMyTurn && !me.finished && me.rollsLeft > 0) extraLabel = '🙏 +1 요청\n(다 굴린 후)';
  $('extraRollBtnText').textContent = extraLabel;

  const consentOpen = status === 'playing' && oppPendingRequest;
  $('consentModal').classList.toggle('open', consentOpen);
  $('consentBackdrop').classList.toggle('open', consentOpen);
  if (consentOpen) {
    $('consentText').textContent = `${players[pendingExtraRoll.by].name}님이 주사위를 한 번 더 굴리고 싶어해요. 허락할까요?`;
  }

  let msgText = '';
  if (status === 'waiting') msgText = '상대방을 기다리는 중…';
  else if (status === 'finished') msgText = '게임 종료!';
  else if (me.finished) msgText = '모든 칸을 채웠어요. 상대방을 기다리는 중…';
  else if (!isMyTurn) msgText = `${opp.name}님의 차례입니다. 잠시만 기다려주세요…`;
  else if (myPendingRequest) msgText = '상대방에게 추가 굴리기를 요청했어요. 응답을 기다리는 중…';
  else if (!me.rolled) msgText = 'ROLL을 눌러 시작하세요';
  else msgText = `점수를 선택하거나 다시 굴리세요 (남은 굴리기 ${me.rollsLeft}회)`;
  $('turnMsg').textContent = msgText;

  // toast when opponent scores a new category
  if (prevState) {
    const prevOpp = prevState.players[oppIdx];
    for (const c of CATEGORIES) {
      const before = prevOpp.scorecard[c.key];
      const after = opp.scorecard[c.key];
      if (before === null && after !== null) {
        toast(`${opp.name}님이 ${LABELS[c.key]}에 ${after}점 기록!`);
      }
    }
    // full-screen effect whenever either player actually lands a tracked achievement
    for (let idx = 0; idx < 2; idx++) {
      for (const key of Object.keys(ACHIEVEMENTS)) {
        const before = prevState.players[idx].scorecard[key];
        const after = players[idx].scorecard[key];
        if (before === null && after) {
          playAchieveEffect(key, players[idx].name);
        }
      }
    }
  }

  prevState = msg;

  if (status === 'waiting') {
    showScreen('waiting');
    $('roomCodeDisplay').textContent = roomCode;
  } else if (status === 'playing') {
    showScreen('game');
  } else if (status === 'finished') {
    const myName = players[myIndex].name;
    const myTotal = players[myIndex].total;
    const oppTotal = players[oppIdx].total;
    const diff = Math.abs(myTotal - oppTotal);
    const card = $('resultCard');
    card.classList.remove('win', 'lose', 'draw');
    if (myTotal === oppTotal) {
      card.classList.add('draw');
      $('resultTitle').textContent = `💗 운명의 무승부! 💗`;
      $('resultDetail').textContent = `${myName}님과 ${opp.name}님, 한 치도 물러서지 않고 나란히 ${myTotal}점! 서로가 서로의 라이벌입니다.`;
    } else if (myTotal > oppTotal) {
      card.classList.add('win');
      $('resultTitle').innerHTML = `👑 ${myName}의 압승! 👑`;
      $('resultDetail').textContent = `${myName}님이 ${opp.name}님을 무려 ${diff}점 차이로 완전히 무너뜨렸습니다! (${myTotal} : ${oppTotal}) 전설의 승리입니다! 🎉🎉🎉`;
    } else {
      card.classList.add('lose');
      $('resultTitle').innerHTML = `💔 ${opp.name}에게 참패 💔`;
      $('resultDetail').textContent = `${myName}님, ${opp.name}님에게 ${diff}점 차이로 처참하게 무너졌습니다... (${myTotal} : ${oppTotal}) 하지만 다음엔 반드시 설욕할 수 있어요!`;
    }
    if (myTotal > oppTotal) startHeartRain(); else stopHeartRain();
    showScreen('result');
    sessionStorage.removeItem('yatzy_session');
  }
}

function onState(msg) {
  if (!diceApi.length) buildDice();
  if (!Object.keys(cellRefs[0]).length) buildBoard();
  renderChat(msg.chat);
  renderState(msg);
}

// ------------------------------------------------------------------ wiring

$('createBtn').addEventListener('click', () => {
  const name = $('nameInput').value.trim() || '플레이어';
  const code = genCode();
  roomCode = code;
  $('roomCodeDisplay').textContent = code;
  showScreen('waiting');
  connect(code, name);
});

$('joinBtn').addEventListener('click', () => {
  const name = $('nameInput').value.trim() || '플레이어';
  const code = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    $('lobbyMsg').textContent = '올바른 초대 코드를 입력하세요.';
    return;
  }
  $('lobbyMsg').textContent = '';
  connect(code, name);
});

$('cancelWaitBtn').addEventListener('click', leaveRoom);
$('backBtn').addEventListener('click', leaveRoom);
$('menuBtn').addEventListener('click', () => {
  alert('Minor: 같은 눈 합산 + 63점 이상 시 보너스 35점\nMajor: 3x/4x(전체 합), 풀하우스 25, 스몰 30, 라지 40, YATZY 50, 찬스(전체 합)');
});
$('restartBtn').addEventListener('click', leaveRoom);
$('rollBtn').addEventListener('click', rollDice);
$('extraRollBtn').addEventListener('click', requestExtraRoll);
$('consentAcceptBtn').addEventListener('click', () => respondExtraRoll(true));
$('consentDeclineBtn').addEventListener('click', () => respondExtraRoll(false));

$('chatBtn').addEventListener('click', () => { chatOpen ? closeChat() : openChat(); });
$('chatCloseBtn').addEventListener('click', closeChat);
$('chatBackdrop').addEventListener('click', closeChat);
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });

// If a tab was backgrounded (mobile OS suspending the page to, say, send
// the invite code over a messenger app) the WebSocket can die silently.
// Nudge a reconnect as soon as the tab/network comes back, instead of
// waiting on the close event that may never fire while suspended.
function reconnectIfStale() {
  if (intentionalDisconnect || !roomCode) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const raw = sessionStorage.getItem('yatzy_session');
  if (!raw) return;
  try {
    const { room, name } = JSON.parse(raw);
    connect(room, name, { silent: true, isReconnect: true });
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnectIfStale();
});
window.addEventListener('online', reconnectIfStale);

// auto-rejoin after refresh
(function init() {
  const raw = sessionStorage.getItem('yatzy_session');
  if (raw) {
    try {
      const { room, name } = JSON.parse(raw);
      showScreen('waiting');
      $('roomCodeDisplay').textContent = room;
      connect(room, name, { silent: true });
      return;
    } catch {}
  }
  showScreen('lobby');
})();
