import { CATEGORIES, calculateScore, summarizeScorecard, emptyScorecard } from './scoring.js';

const MAX_PLAYERS = 2;

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function freshPlayerState(name, pid) {
  return {
    pid,
    name,
    connected: true,
    dice: [1, 1, 1, 1, 1],
    rolled: false,
    held: [false, false, false, false, false],
    rollsLeft: 3,
    scorecard: emptyScorecard(),
  };
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // WebSocket -> { pid, index }
    this.game = null;
  }

  async loadGame() {
    if (!this.game) {
      this.game = (await this.state.storage.get('game')) || { code: null, players: [], turn: 0 };
      if (this.game.turn == null) this.game.turn = 0;
    }
    return this.game;
  }

  async saveGame() {
    await this.state.storage.put('game', this.game);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = (url.searchParams.get('room') || '').toUpperCase();
    const name = (url.searchParams.get('name') || 'Player').slice(0, 16);
    const pid = url.searchParams.get('pid') || crypto.randomUUID();

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }

    const game = await this.loadGame();
    if (!game.code) game.code = room;

    let index = game.players.findIndex((p) => p && p.pid === pid);
    if (index === -1) {
      const openSlot = game.players.findIndex((p) => !p);
      if (game.players.length < MAX_PLAYERS && openSlot === -1) {
        index = game.players.length;
      } else if (openSlot !== -1) {
        index = openSlot;
      } else {
        return new Response(JSON.stringify({ error: 'room-full' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      game.players[index] = freshPlayerState(name, pid);
    } else {
      game.players[index].connected = true;
      game.players[index].name = name;
    }
    await this.saveGame();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.set(server, { pid, index });

    server.addEventListener('message', (evt) => {
      this.handleMessage(server, evt.data).catch((err) => {
        server.send(JSON.stringify({ type: 'error', message: String(err && err.message || err) }));
      });
    });
    server.addEventListener('close', () => this.handleClose(server));
    server.addEventListener('error', () => this.handleClose(server));

    server.send(JSON.stringify({ type: 'hello', you: index, room: game.code }));
    await this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleClose(ws) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (!session) return;
    const game = await this.loadGame();
    const player = game.players[session.index];
    if (player) player.connected = false;
    await this.saveGame();
    await this.broadcastState();
  }

  status(game) {
    if (game.players.length < MAX_PLAYERS || game.players.some((p) => !p)) return 'waiting';
    const bothFinished = game.players.every((p) => summarizeScorecard(p.scorecard).finished);
    return bothFinished ? 'finished' : 'playing';
  }

  async handleMessage(ws, raw) {
    const session = this.sessions.get(ws);
    if (!session) return;
    const game = await this.loadGame();
    const player = game.players[session.index];
    if (!player) return;
    const status = this.status(game);

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'roll') {
      if (status !== 'playing') return;
      if (game.turn !== session.index) return;
      if (player.rollsLeft <= 0) return;
      for (let i = 0; i < 5; i++) {
        if (!player.held[i]) player.dice[i] = rollDie();
      }
      player.rollsLeft -= 1;
      player.rolled = true;
    } else if (msg.type === 'hold') {
      if (status !== 'playing') return;
      if (game.turn !== session.index) return;
      if (!player.rolled) return;
      const idx = msg.index;
      if (typeof idx !== 'number' || idx < 0 || idx > 4) return;
      player.held[idx] = !player.held[idx];
    } else if (msg.type === 'score') {
      if (status !== 'playing') return;
      if (game.turn !== session.index) return;
      if (!player.rolled) return;
      const cat = CATEGORIES.find((c) => c.key === msg.category);
      if (!cat) return;
      if (player.scorecard[cat.key] !== null) return;
      player.scorecard[cat.key] = calculateScore(cat.key, player.dice);
      player.dice = [1, 1, 1, 1, 1];
      player.held = [false, false, false, false, false];
      player.rollsLeft = 3;
      player.rolled = false;
      game.turn = 1 - game.turn;
    } else {
      return;
    }

    await this.saveGame();
    await this.broadcastState();
  }

  async broadcastState() {
    const game = await this.loadGame();
    const status = this.status(game);
    const players = game.players.map((p) => {
      if (!p) return null;
      const summary = summarizeScorecard(p.scorecard);
      return {
        name: p.name,
        connected: p.connected,
        dice: p.dice,
        held: p.held,
        rolled: p.rolled,
        rollsLeft: p.rollsLeft,
        scorecard: p.scorecard,
        ...summary,
      };
    });
    const payload = JSON.stringify({ type: 'state', room: game.code, status, turn: game.turn, players });
    for (const ws of this.sessions.keys()) {
      try { ws.send(payload); } catch { /* dead socket, will be cleaned up on close */ }
    }
  }
}
