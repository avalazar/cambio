const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createCambioState, getPlayerView } = require('./cambio');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// rooms: Map<roomCode, { code, hostId, players: Map<socketId, {id, name}>, game, phase }>
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getOpenRooms() {
  return [...rooms.values()]
    .filter(r => r.phase === 'lobby')
    .map(r => ({
      code: r.code,
      game: r.game,
      playerCount: r.players.size,
      maxPlayers: 4,
    }));
}

// Broadcast the current open-room list to everyone not yet inside a game room
function broadcastRoomList() {
  io.to('global').emit('rooms:list', getOpenRooms());
}

io.on('connection', (socket) => {
  console.log(`[connect]    ${socket.id}`);
  socket.join('global'); // leave 'global' when entering a game room

  // ── Room list (for join screen) ────────────────────────────────────────────
  socket.on('rooms:get', () => {
    socket.emit('rooms:list', getOpenRooms());
  });

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('room:create', ({ name }) => {
    const trimmedName = (name || '').trim().slice(0, 20) || 'Host';
    const code = generateRoomCode();

    const room = {
      code,
      hostId: socket.id,
      players: new Map([[socket.id, { id: socket.id, name: trimmedName }]]),
      game: 'cambio',
      phase: 'lobby',
    };
    rooms.set(code, room);
    socket.leave('global');
    socket.join(code);

    console.log(`[room:create] ${code} by ${trimmedName}`);
    socket.emit('room:created', { code, playerId: socket.id, name: trimmedName });
    emitRoomUpdate(code);
    broadcastRoomList();
  });

  // ── Join room ───────────────────────────────────────────────────────────────
  socket.on('room:join', ({ code, name }) => {
    const upperCode = (code || '').toUpperCase().trim();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit('room:error', { message: `Room "${upperCode}" not found.` });
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('room:error', { message: 'That game has already started.' });
      return;
    }
    if (room.players.size >= 4) {
      socket.emit('room:error', { message: 'Room is full.' });
      return;
    }

    const trimmedName = (name || '').trim().slice(0, 20) || `Player ${room.players.size + 1}`;
    room.players.set(socket.id, { id: socket.id, name: trimmedName });
    socket.leave('global');
    socket.join(upperCode);

    console.log(`[room:join]   ${upperCode} ← ${trimmedName}`);
    socket.emit('room:joined', { code: upperCode, playerId: socket.id, name: trimmedName });
    emitRoomUpdate(upperCode);
    broadcastRoomList();
  });

  // ── Game selection (host only) ──────────────────────────────────────────────
  socket.on('room:selectGame', ({ code, game }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    if (!['cambio', 'un-solitaire'].includes(game)) return;
    room.game = game;
    emitRoomUpdate(code);
    broadcastRoomList();
  });

  // ── Start game (host only) ─────────────────────────────────────────────────
  socket.on('room:start', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size < 2) return;
    room.phase = 'playing';

    if (room.game === 'cambio') {
      const playerIds = [...room.players.keys()];
      room.cambioState = createCambioState(playerIds);

      const { playerOrder } = room.cambioState;
      const playerList = playerOrder.map(id => ({ id, name: room.players.get(id).name }));

      // Emit privately — each player only receives their own hand (§5.1)
      for (const socketId of playerOrder) {
        const view = getPlayerView(room.cambioState, socketId);
        io.to(socketId).emit('game:started', {
          game: 'cambio',
          playerOrder: playerList,
          myIndex: playerOrder.indexOf(socketId),
          ...view,
        });
      }

      console.log(`[game:start]  ${code} — cambio (${room.players.size}p, ${room.cambioState.deck.length} cards left)`);
    } else {
      io.to(code).emit('game:started', {
        game: room.game,
        players: [...room.players.values()],
      });
      console.log(`[game:start]  ${code} — ${room.game}`);
    }

    broadcastRoomList(); // room no longer open
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    for (const [code, room] of rooms) {
      if (!room.players.has(socket.id)) continue;
      const name = room.players.get(socket.id).name;
      room.players.delete(socket.id);

      if (room.players.size === 0) {
        rooms.delete(code);
        console.log(`[room:empty]  ${code} removed`);
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players.keys().next().value;
        }
        console.log(`[room:leave]  ${code} ← ${name} left`);
        emitRoomUpdate(code);
      }
      break;
    }
    broadcastRoomList();
  });
});

function emitRoomUpdate(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('room:update', {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()],
    game: room.game,
    phase: room.phase,
    canStart: room.players.size >= 2,
  });
}

server.listen(PORT, () => {
  console.log(`Cambio server → http://localhost:${PORT}`);
});
