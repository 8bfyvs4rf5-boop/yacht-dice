export { GameRoom } from './game-room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const room = (url.searchParams.get('room') || '').toUpperCase().trim();
      if (!/^[A-Z0-9]{4,8}$/.test(room)) {
        return new Response('invalid room code', { status: 400 });
      }
      const id = env.GAME_ROOM.idFromName(room);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
