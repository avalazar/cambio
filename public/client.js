const socket = io();

// ── Local state ────────────────────────────────────────────────────────────────
let myId = null;
let myName = null;
let currentRoom = null;
let cambioState = null;

const GAME_LABELS = { 'cambio': 'Cambio', 'un-solitaire': 'Un-Solitaire' };
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS = new Set(['hearts', 'diamonds']);

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
const cambioBoard      = document.getElementById('cambio-board');
const genericGameInfo  = document.getElementById('generic-game-info');

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

socket.on('game:started', (payload) => {
  if (payload.game === 'cambio') {
    cambioState = payload;
    cambioBoard.classList.remove('hidden');
    genericGameInfo.classList.add('hidden');
    renderCambioBoard();
  } else {
    cambioBoard.classList.add('hidden');
    genericGameInfo.classList.remove('hidden');
    gameTitle.textContent = GAME_LABELS[payload.game] ?? payload.game;
    gameInfo.textContent = `Players: ${(payload.players ?? []).map(p => p.name).join(', ')}`;
  }
  showScreen('game-screen');
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

// ── Cambio rendering ───────────────────────────────────────────────────────────

// card is { suit, rank, value } or null (face-down / unknown)
// seen = true adds a gold dot indicating that player has looked at this card
function renderCard(card, slotIndex = -1, seen = false) {
  const slotAttr = slotIndex >= 0 ? ` data-slot="${slotIndex}"` : '';
  if (!card) {
    return `<div class="card face-down"${slotAttr}>
      <div class="card-back-inner"></div>
      ${seen ? '<div class="seen-dot"></div>' : ''}
    </div>`;
  }
  const colorClass = RED_SUITS.has(card.suit) ? 'red' : 'black';
  const sym = SUIT_SYMBOLS[card.suit];
  return `
    <div class="card face-up ${colorClass}"${slotAttr}>
      <span class="card-tl">${card.rank}<br>${sym}</span>
      <span class="card-suit">${sym}</span>
      <span class="card-br">${card.rank}<br>${sym}</span>
    </div>`;
}

function renderCambioBoard() {
  const { hand, discardTop, drawPileCount, playerOrder, myIndex, currentTurnId, phase } = cambioState;
  const isMyTurn = currentTurnId === myId;

  // Turn indicator
  const turnEl = document.getElementById('turn-indicator');
  const currentName = playerOrder.find(p => p.id === currentTurnId)?.name ?? '?';
  turnEl.textContent = isMyTurn ? 'Your turn' : `${escapeHtml(currentName)}'s turn`;
  turnEl.className = `turn-indicator${isMyTurn ? ' my-turn' : ''}`;

  // Phase label
  const phaseEl = document.getElementById('phase-label');
  if (phase === 'peek') {
    phaseEl.textContent = 'Look at your bottom 2 cards before play begins.';
    phaseEl.classList.remove('hidden');
  } else {
    phaseEl.classList.add('hidden');
  }

  // Opponents (everyone except me)
  const opponents = playerOrder.filter((_, i) => i !== myIndex);
  document.getElementById('opponents-area').innerHTML = opponents.map(p => {
    const seenSlots = cambioState.opponentsSeen?.[p.id] ?? [false, false, false, false];
    return `
      <div class="opponent${p.id === currentTurnId ? ' active-turn' : ''}">
        <p class="opponent-name">${escapeHtml(p.name)}</p>
        <div class="opponent-cards">
          ${[2, 3, 0, 1].map(i => renderCard(null, i, seenSlots[i])).join('')}
        </div>
      </div>`;
  }).join('');

  // Center piles
  document.getElementById('draw-pile-count').textContent = `${drawPileCount} left`;
  document.getElementById('discard-pile-card').innerHTML = renderCard(discardTop);

  // My hand: slots 0 & 1 are null (face-down), slots 2 & 3 are the peeked cards
  document.getElementById('my-hand').innerHTML =
    hand.map((card, i) => renderCard(card, i)).join('');
}

// ── Utility ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
