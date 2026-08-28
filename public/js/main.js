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

function wsUrl(room, name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}&pid=${encodeURIComponent(pid())}`;
}

function connect(room, name, { silent = false } = {}) {
  if (ws) { try { ws.close(); } catch {} }
  roomCode = room;
  myIndex = null;
  prevState = null;
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
    if (!helloReceived) onConnectFailed(silent);
  });
  ws.addEventListener('error', () => {});
}

function onConnectFailed(silent) {
  sessionStorage.removeItem('yatzy_session');
  if (!silent) {
    $('lobbyMsg').textContent = '방을 찾을 수 없거나 가득 찼습니다.';
  }
  showScreen('lobby');
}

function leaveRoom() {
  if (ws) { try { ws.close(); } catch {} }
  ws = null;
  myIndex = null;
  prevState = null;
  sessionStorage.removeItem('yatzy_session');
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
  const me = prevState && prevState.players[myIndex];
  if (!me || !me.rolled || me.scorecard[catKey] !== null) return;
  send({ type: 'score', category: catKey });
}

// ------------------------------------------------------------------ render

function updateCategoryCell(catKey, playerIdx, players) {
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
  const canScore = isMine && p.rolled;
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
  const { players, status } = msg;
  if (!players[0] || !players[1]) return;

  $('p0Name').textContent = players[0].name;
  $('p1Name').textContent = players[1].name;
  $('p0Score').textContent = players[0].total;
  $('p1Score').textContent = players[1].total;

  for (const c of MINOR) { updateCategoryCell(c.key, 0, players); updateCategoryCell(c.key, 1, players); }
  for (const c of MAJOR_TOP) { updateCategoryCell(c.key, 0, players); updateCategoryCell(c.key, 1, players); }
  updateCategoryCell('chance', 0, players);
  updateCategoryCell('chance', 1, players);

  $('bonusCell0').textContent = `${Math.min(upperSumOf(players[0]), UPPER_BONUS_THRESHOLD)}/${UPPER_BONUS_THRESHOLD}`;
  $('bonusCell1').textContent = `${Math.min(upperSumOf(players[1]), UPPER_BONUS_THRESHOLD)}/${UPPER_BONUS_THRESHOLD}`;

  const me = players[myIndex];
  // A roll actually happened iff rollsLeft just went down (per-die value
  // comparison is wrong: a die that happens to re-land on its old value
  // would silently skip its spin animation).
  const justRolled = !!(prevState && prevState.players[myIndex] && prevState.players[myIndex].rollsLeft > me.rollsLeft);
  me.dice.forEach((v, i) => {
    diceApi[i].setValue(v, { animate: justRolled && !me.held[i] });
    diceApi[i].setHeld(me.held[i]);
  });

  // opponent dice strip (bigger heart-pip tiles, mirrors held state live)
  const oppIdx = myIndex === 0 ? 1 : 0;
  const opp = players[oppIdx];
  const mini = $('oppMiniDice');
  if (mini.childElementCount !== 5) {
    mini.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'mini-die';
      d.appendChild(buildPipGrid(1, 'mini-die-pips'));
      mini.appendChild(d);
    }
  }
  opp.dice.forEach((v, i) => {
    const tile = mini.children[i];
    tile.classList.toggle('held', !!opp.held[i]);
    tile.replaceChild(buildPipGrid(v, 'mini-die-pips'), tile.firstChild);
  });
  $('oppRolls').textContent = opp.connected ? `굴리기 ${opp.rollsLeft}회 남음` : '연결 끊김';

  $('rollCount').textContent = me.rollsLeft;
  const canRoll = status === 'playing' && me.rollsLeft > 0 && !me.finished;
  $('rollBtn').disabled = !canRoll;

  let msgText = '';
  if (status === 'waiting') msgText = '상대방을 기다리는 중…';
  else if (status === 'finished') msgText = '게임 종료!';
  else if (me.finished) msgText = '모든 칸을 채웠어요. 상대방을 기다리는 중…';
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
    showScreen('result');
    sessionStorage.removeItem('yatzy_session');
  }
}

function onState(msg) {
  if (!diceApi.length) buildDice();
  if (!Object.keys(cellRefs[0]).length) buildBoard();
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
