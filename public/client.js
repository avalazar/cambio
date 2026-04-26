const socket = io();

// ── Local state ────────────────────────────────────────────────────────────────
let myId = null;
let myName = null;
let currentRoom = null;

const GAME_LABELS = { 'cambio': 'Cambio', 'un-solitaire': 'Un-Solitaire' };

// ── DOM refs ───────────────────────────────────────────────────────────────────
const connectionStatus = document.getElementById('connection-status');
const nameInput        = document.getElementById('name-input');
const codeInput        = document.getElementById('code-input');
const createBtn        = document.getElementById('create-btn');
const joinBtn          = document.getElementById('join-btn');
const homeError        = document.getElementById('home-error');

const roomCodeDisplay  = document.getElementById('room-code-display');
const lobbyStatus      = document.getElementById('lobby-status');
const playerList       = document.getElementById('player-list');
const gameOptions      = document.querySelectorAll('.game-option');
const hostNote         = document.getElementById('host-note');
const startBtn         = document.getElementById('start-btn');
const leaveBtn         = document.getElementById('leave-btn');

const gameTitle        = document.getElementById('game-title');
const gameInfo         = document.getElementById('game-info');
const backBtn          = document.getElementById('back-btn');

// ── Screen helper ──────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function showHomeError(msg) {
  homeError.textContent = msg;
  homeError.classList.remove('hidden');
}

function clearHomeError() {
  homeError.textContent = '';
  homeError.classList.add('hidden');
}

// ── Connection status ──────────────────────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id;
  connectionStatus.textContent = 'Connected';
  connectionStatus.className = 'status-badge connected';
  createBtn.disabled = false;
  joinBtn.disabled = false;
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.className = 'status-badge disconnected';
  createBtn.disabled = true;
  joinBtn.disabled = true;
});

// ── Create room ────────────────────────────────────────────────────────────────
createBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { showHomeError('Please enter your name.'); return; }
  clearHomeError();
  socket.emit('room:create', { name });
});

socket.on('room:created', ({ code, playerId, name }) => {
  myId = playerId;
  myName = name;
  currentRoom = code;
  roomCodeDisplay.textContent = code;
  showScreen('lobby-screen');
});

// ── Join room ──────────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) { showHomeError('Please enter your name.'); return; }
  if (code.length !== 4) { showHomeError('Room code must be 4 letters.'); return; }
  clearHomeError();
  socket.emit('room:join', { name, code });
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase();
});

socket.on('room:joined', ({ code, playerId, name }) => {
  myId = playerId;
  myName = name;
  currentRoom = code;
  roomCodeDisplay.textContent = code;
  showScreen('lobby-screen');
});

socket.on('room:error', ({ message }) => {
  showHomeError(message);
});

// ── Room updates ───────────────────────────────────────────────────────────────
socket.on('room:update', ({ hostId, players, game, canStart }) => {
  const isHost = myId === hostId;

  lobbyStatus.textContent =
    players.length === 1
      ? 'Waiting for at least one more player…'
      : `${players.length} players in lobby`;

  playerList.innerHTML = players.map((p) => `
    <li class="${p.id === myId ? 'you' : ''}">
      <span class="dot"></span>
      <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}${p.id === hostId ? ' ★' : ''}</span>
    </li>`
  ).join('');

  gameOptions.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.game === game);
    btn.disabled = !isHost;
  });
  hostNote.classList.toggle('hidden', isHost);
  startBtn.disabled = !canStart || !isHost;
});

// ── Game selection (host only) ─────────────────────────────────────────────────
gameOptions.forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('room:selectGame', { code: currentRoom, game: btn.dataset.game });
  });
});

// ── Start game ─────────────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  socket.emit('room:start', { code: currentRoom });
});

socket.on('game:starting', ({ game, players }) => {
  showScreen('game-screen');
  gameTitle.textContent = GAME_LABELS[game] ?? game;
  gameInfo.textContent = `Players: ${players.map((p) => p.name).join(', ')}`;
});

// ── Leave lobby ────────────────────────────────────────────────────────────────
leaveBtn.addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  currentRoom = null;
  clearHomeError();
  showScreen('home-screen');
});

backBtn.addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  currentRoom = null;
  showScreen('home-screen');
});

// ── Utility ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
