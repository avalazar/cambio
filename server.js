const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const GAMES = ['cambio', 'un-solitaire'];

// Lobby state
const lobby = {
  players: {},   // socketId -> { id, name }
  maxPlayers: 4,
  hostId: null,
  selectedGame: 'cambio',
};

function broadcastLobbyUpdate() {
  io.emit('lobby:update', {
    players: Object.values(lobby.players),
    canStart: Object.keys(lobby.players).length >= 2,
    hostId: lobby.hostId,
    selectedGame: lobby.selectedGame,
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
    if (!lobby.hostId) lobby.hostId = socket.id;
    console.log(`${trimmed} joined the lobby`);
    socket.emit('lobby:joined', { id: socket.id, name: trimmed });
    broadcastLobbyUpdate();
  });

  socket.on('lobby:selectGame', ({ game }) => {
    if (socket.id !== lobby.hostId) return;
    if (!GAMES.includes(game)) return;
    lobby.selectedGame = game;
    broadcastLobbyUpdate();
  });

  socket.on('game:start', () => {
    if (socket.id !== lobby.hostId) return;
    if (Object.keys(lobby.players).length < 2) return;
    io.emit('game:starting', { players: Object.values(lobby.players), game: lobby.selectedGame });
  });

  socket.on('disconnect', () => {
    const player = lobby.players[socket.id];
    if (player) {
      console.log(`${player.name} left the lobby`);
      delete lobby.players[socket.id];
      // Pass host to the next player if the host left
      if (lobby.hostId === socket.id) {
        const remaining = Object.keys(lobby.players);
        lobby.hostId = remaining.length > 0 ? remaining[0] : null;
      }
      broadcastLobbyUpdate();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Cambio server running at http://localhost:${PORT}`);
});
