const socket = io();

// ── Local state ────────────────────────────────────────────────────────────────
let myId        = null;
let myName      = null;
let currentRoom = null;
let cambioState = null;
let isConnected = false;

const GAME_LABELS = { 'cambio': 'Cambio', 'un-solitaire': 'Un-Solitaire' };
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS    = new Set(['hearts', 'diamonds']);

// ── DOM refs ───────────────────────────────────────────────────────────────────

// Home
const connectionStatus = document.getElementById('connection-status');
const gotoCreateBtn    = document.getElementById('goto-create-btn');
const gotoJoinBtn      = document.getElementById('goto-join-btn');

// Create
const backFromCreate   = document.getElementById('back-from-create');
const createForm       = document.getElementById('create-form');
const createNameInput  = document.getElementById('create-name-input');
const createError      = document.getElementById('create-error');

// Join
const backFromJoin     = document.getElementById('back-from-join');
const joinNameInput    = document.getElementById('join-name-input');
const roomsList        = document.getElementById('rooms-list');
const joinCodeInput    = document.getElementById('join-code-input');
const joinCodeBtn      = document.getElementById('join-code-btn');
const joinError        = document.getElementById('join-error');

// Lobby
const roomCodeDisplay  = document.getElementById('room-code-display');
const lobbyStatus      = document.getElementById('lobby-status');
const playerList       = document.getElementById('player-list');
const gameOptions      = document.querySelectorAll('.game-option');
const hostNote         = document.getElementById('host-note');
const startBtn         = document.getElementById('start-btn');
const leaveBtn         = document.getElementById('leave-btn');

// Game
const gameTitle        = document.getElementById('game-title');
const gameInfo         = document.getElementById('game-info');
const backBtn          = document.getElementById('back-btn');
const cambioBoard      = document.getElementById('cambio-board');
const genericGameInfo  = document.getElementById('generic-game-info');

// ── Screen helper ──────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

// ── Connection ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id;
  isConnected = true;
  connectionStatus.textContent = 'Connected';
  connectionStatus.className = 'status-badge connected';
  gotoCreateBtn.disabled = false;
  gotoJoinBtn.disabled = false;
});

socket.on('disconnect', () => {
  isConnected = false;
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.className = 'status-badge disconnected';
  gotoCreateBtn.disabled = true;
  gotoJoinBtn.disabled = true;
});

// ── Home navigation ────────────────────────────────────────────────────────────
gotoCreateBtn.addEventListener('click', () => {
  clearError(createError);
  showScreen('create-screen');
  createNameInput.focus();
});

gotoJoinBtn.addEventListener('click', () => {
  clearError(joinError);
  showScreen('join-screen');
  socket.emit('rooms:get');
  joinNameInput.focus();
});

backFromCreate.addEventListener('click', () => showScreen('home-screen'));
backFromJoin.addEventListener('click', () => showScreen('home-screen'));

// ── Create room ────────────────────────────────────────────────────────────────
createForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = createNameInput.value.trim();
  if (!name) { showError(createError, 'Please enter your name.'); return; }
  clearError(createError);
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
function doJoin(code) {
  const name = joinNameInput.value.trim();
  if (!name) { showError(joinError, 'Please enter your name first.'); return; }
  clearError(joinError);
  socket.emit('room:join', { name, code });
}

// Join via the live room list
roomsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-join-btn');
  if (btn) doJoin(btn.dataset.code);
});

// Join via manual code entry
joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase();
});

joinCodeBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) { showError(joinError, 'Room code must be 4 letters.'); return; }
  doJoin(code);
});

socket.on('room:joined', ({ code, playerId, name }) => {
  myId = playerId;
  myName = name;
  currentRoom = code;
  roomCodeDisplay.textContent = code;
  showScreen('lobby-screen');
});

socket.on('room:error', ({ message }) => {
  // Show error on whichever screen is currently visible
  const joinVisible = !document.getElementById('join-screen').classList.contains('hidden');
  showError(joinVisible ? joinError : createError, message);
});

// ── Live room list ─────────────────────────────────────────────────────────────
socket.on('rooms:list', (openRooms) => {
  if (openRooms.length === 0) {
    roomsList.innerHTML = '<p class="rooms-empty">No open rooms yet.</p>';
    return;
  }
  roomsList.innerHTML = openRooms.map(r => `
    <div class="room-item">
      <span class="room-code-label">${r.code}</span>
      <div class="room-details">
        <span class="room-game">${GAME_LABELS[r.game] ?? r.game}</span>
        <span class="room-players">${r.playerCount} / ${r.maxPlayers} players</span>
      </div>
      <button class="room-join-btn" data-code="${r.code}">Join</button>
    </div>`
  ).join('');
});

// ── Lobby ──────────────────────────────────────────────────────────────────────
socket.on('room:update', ({ hostId, players, game, canStart }) => {
  const isHost = myId === hostId;

  lobbyStatus.textContent =
    players.length === 1
      ? 'Waiting for at least one more player…'
      : `${players.length} players in lobby`;

  playerList.innerHTML = players.map(p => `
    <li class="${p.id === myId ? 'you' : ''}">
      <span class="dot"></span>
      <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}${p.id === hostId ? ' ★' : ''}</span>
    </li>`
  ).join('');

  gameOptions.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.game === game);
    btn.disabled = !isHost;
  });
  hostNote.classList.toggle('hidden', isHost);
  startBtn.disabled = !canStart || !isHost;
});

gameOptions.forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('room:selectGame', { code: currentRoom, game: btn.dataset.game });
  });
});

startBtn.addEventListener('click', () => {
  socket.emit('room:start', { code: currentRoom });
});

leaveBtn.addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  currentRoom = null;
  showScreen('home-screen');
});

// ── Game started ───────────────────────────────────────────────────────────────
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

  const turnEl = document.getElementById('turn-indicator');
  const currentName = playerOrder.find(p => p.id === currentTurnId)?.name ?? '?';
  turnEl.textContent = isMyTurn ? 'Your turn' : `${escapeHtml(currentName)}'s turn`;
  turnEl.className = `turn-indicator${isMyTurn ? ' my-turn' : ''}`;

  const phaseEl = document.getElementById('phase-label');
  if (phase === 'peek') {
    phaseEl.textContent = 'Look at your bottom 2 cards before play begins.';
    phaseEl.classList.remove('hidden');
  } else {
    phaseEl.classList.add('hidden');
  }

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

  document.getElementById('draw-pile-count').textContent = `${drawPileCount} left`;
  document.getElementById('discard-pile-card').innerHTML = renderCard(discardTop);
  document.getElementById('my-hand').innerHTML = hand.map((card, i) => renderCard(card, i)).join('');
}

// ── Utility ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
