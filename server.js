const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Lobby state
const lobby = {
  players: {},   // socketId -> { id, name }
  maxPlayers: 4,
};

function broadcastLobbyUpdate() {
  io.emit('lobby:update', {
    players: Object.values(lobby.players),
    canStart: Object.keys(lobby.players).length >= 2,
  });
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  if (Object.keys(lobby.players).length >= lobby.maxPlayers) {
    socket.emit('lobby:full');
    socket.disconnect(true);
    return;
  }

  socket.on('lobby:join', ({ name }) => {
    const trimmed = (name || '').trim().slice(0, 20) || `Player ${Object.keys(lobby.players).length + 1}`;
    lobby.players[socket.id] = { id: socket.id, name: trimmed };
    console.log(`${trimmed} joined the lobby`);
    socket.emit('lobby:joined', { id: socket.id, name: trimmed });
    broadcastLobbyUpdate();
  });

  socket.on('game:start', () => {
    if (Object.keys(lobby.players).length < 2) return;
    io.emit('game:starting', { players: Object.values(lobby.players) });
  });

  socket.on('disconnect', () => {
    const player = lobby.players[socket.id];
    if (player) {
      console.log(`${player.name} left the lobby`);
      delete lobby.players[socket.id];
      broadcastLobbyUpdate();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Cambio server running at http://localhost:${PORT}`);
});
