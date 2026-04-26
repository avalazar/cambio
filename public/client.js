const socket = io();

let myId = null;
let myName = null;

// --- Screen helpers ---
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// --- DOM refs ---
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const lobbyStatus = document.getElementById('lobby-status');
const playerList = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');
const gameInfo = document.getElementById('game-info');

// --- Join ---
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  socket.emit('lobby:join', { name });
});

// --- Socket events ---
socket.on('lobby:joined', ({ id, name }) => {
  myId = id;
  myName = name;
  showScreen('lobby-screen');
});

socket.on('lobby:update', ({ players, canStart }) => {
  lobbyStatus.textContent =
    players.length === 1
      ? 'Waiting for at least one more player…'
      : `${players.length} player${players.length !== 1 ? 's' : ''} in lobby`;

  playerList.innerHTML = players
    .map(
      (p) => `
      <li class="${p.id === myId ? 'you' : ''}">
        <span class="dot"></span>
        <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
      </li>`
    )
    .join('');

  startBtn.disabled = !canStart;
});

socket.on('lobby:full', () => {
  alert('The lobby is full. Please try again later.');
});

socket.on('game:starting', ({ players }) => {
  showScreen('game-screen');
  gameInfo.textContent = `Players: ${players.map((p) => p.name).join(', ')}`;
});

socket.on('disconnect', () => {
  alert('Disconnected from server.');
});

// --- Start game ---
startBtn.addEventListener('click', () => {
  socket.emit('game:start');
});

// --- Utility ---
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
