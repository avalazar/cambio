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

// ── Client-side game state ─────────────────────────────────────────────────────
// Slots the player has voluntarily hidden after peeking. The server still tracks
// what was seen (knownTo), but the client hides them so the player must remember.
let locallyHiddenSlots = new Set();

// Card currently drawn by this player, pending a discard or swap decision.
let localDrawnCard = null;

// True when the player has clicked "Swap" and is selecting a hand slot to replace.
let swapMode = false;

// ── Game started ───────────────────────────────────────────────────────────────
socket.on('game:started', (payload) => {
  if (payload.game === 'cambio') {
    cambioState = payload;
    locallyHiddenSlots = new Set();
    localDrawnCard = null;
    swapMode = false;
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

// ── Peek phase controls ────────────────────────────────────────────────────────
document.getElementById('done-peeking-btn').addEventListener('click', () => {
  // Locally hide the two peeked slots so they appear face-down again.
  locallyHiddenSlots.add(2);
  locallyHiddenSlots.add(3);

  // Swap to the "waiting" state before the server confirms everyone is ready.
  document.getElementById('done-peeking-btn').classList.add('hidden');
  document.getElementById('peek-wait-text').classList.remove('hidden');

  renderMyHand();
  socket.emit('playerReady', { code: currentRoom });
});

// Server fires this once every player has clicked Done Peeking.
socket.on('beginTurns', ({ currentTurnId }) => {
  cambioState.phase      = 'playing';
  cambioState.currentTurnId = currentTurnId;

  // Hide all peek-phase UI.
  document.getElementById('done-peeking-btn').classList.add('hidden');
  document.getElementById('peek-wait-text').classList.add('hidden');

  renderCambioBoard();
});

// ── Drawing from the deck ──────────────────────────────────────────────────────
document.getElementById('draw-pile-el').addEventListener('click', () => {
  if (cambioState?.phase !== 'playing') return;
  if (cambioState.currentTurnId !== myId) return;
  if (localDrawnCard) return; // already holding a card
  socket.emit('deck:draw', { code: currentRoom });
});

// Server sends the drawn card privately only to the drawing player.
socket.on('card:drawn', ({ card }) => {
  localDrawnCard = card;
  renderDrawnArea();
  // Make draw pile non-clickable while holding a card.
  document.getElementById('draw-pile-el').classList.add('inactive');
});

// Deck count updated for everyone when any player draws.
socket.on('deck:update', ({ drawPileCount }) => {
  cambioState.drawPileCount = drawPileCount;
  document.getElementById('draw-pile-count').textContent = `${drawPileCount} left`;
});

// ── Drawn card actions ─────────────────────────────────────────────────────────
document.getElementById('discard-drawn-btn').addEventListener('click', () => {
  if (!localDrawnCard) return;
  socket.emit('draw:discard', { code: currentRoom });
  localDrawnCard = null;
  swapMode = false;
  renderDrawnArea();
  renderMyHand();
  document.getElementById('draw-pile-el').classList.remove('inactive');
});

document.getElementById('swap-drawn-btn').addEventListener('click', () => {
  swapMode = !swapMode;
  const btn = document.getElementById('swap-drawn-btn');
  btn.textContent = swapMode ? 'Cancel' : 'Swap';
  btn.classList.toggle('active', swapMode);
  renderMyHand();
});

// Clicking a highlighted hand card while in swap mode performs the swap.
document.getElementById('my-hand').addEventListener('click', (e) => {
  if (!swapMode) return;
  const card = e.target.closest('.card[data-slot]');
  if (!card) return;
  const slotIndex = parseInt(card.dataset.slot, 10);
  socket.emit('draw:swap', { code: currentRoom, slotIndex });

  // The swapped-in card is unknown — remove it from the locally-hidden set.
  locallyHiddenSlots.delete(slotIndex);
  localDrawnCard = null;
  swapMode = false;
  renderDrawnArea();
  renderMyHand();
  document.getElementById('draw-pile-el').classList.remove('inactive');
});

// ── Turn progression ───────────────────────────────────────────────────────────
socket.on('turn:advance', ({ discardTop, currentTurnId, drawPileCount }) => {
  cambioState.discardTop    = discardTop;
  cambioState.currentTurnId = currentTurnId;
  cambioState.drawPileCount = drawPileCount;
  renderCambioBoard();
});

// Server sends the swapping player their updated hand after a swap.
socket.on('hand:update', ({ hand }) => {
  cambioState.hand = hand;
  renderMyHand();
});

// ── Back to menu ───────────────────────────────────────────────────────────────
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

function renderMyHand() {
  const { hand, phase } = cambioState;
  const isMyTurn = cambioState.currentTurnId === myId;

  // A slot is shown face-up only if the server sent a card value AND
  // the player hasn't chosen to hide it (locallyHiddenSlots).
  document.getElementById('my-hand').innerHTML = hand.map((card, i) => {
    const visible = card && !locallyHiddenSlots.has(i);
    // In swap mode, hand slots are active targets — highlight them.
    const swappable = swapMode ? ' swappable' : '';
    return renderCard(visible ? card : null, i) .replace('class="card', `class="card${swappable}`);
  }).join('');

  // Done Peeking button: show if we're in peek phase and haven't clicked yet.
  const donePeekingBtn  = document.getElementById('done-peeking-btn');
  const peekWaitText    = document.getElementById('peek-wait-text');
  const handLabel       = document.getElementById('hand-label-text');
  const playerNotReady  = phase === 'peek' && !locallyHiddenSlots.has(2);

  donePeekingBtn.classList.toggle('hidden', !playerNotReady);
  peekWaitText.classList.toggle('hidden', !(phase === 'peek' && locallyHiddenSlots.has(2)));
  handLabel.textContent = phase === 'peek' && !locallyHiddenSlots.has(2)
    ? 'Your Cards — bottom row peeked'
    : 'Your Cards';
}

function renderDrawnArea() {
  const area = document.getElementById('drawn-card-area');
  if (!localDrawnCard || cambioState?.currentTurnId !== myId) {
    area.classList.add('hidden');
    // Reset swap button state whenever the held card goes away.
    const swapBtn = document.getElementById('swap-drawn-btn');
    swapBtn.textContent = 'Swap';
    swapBtn.classList.remove('active');
    return;
  }
  area.classList.remove('hidden');
  document.getElementById('drawn-card-display').innerHTML = renderCard(localDrawnCard);
}

function renderCambioBoard() {
  const { hand, discardTop, drawPileCount, playerOrder, myIndex, currentTurnId, phase } = cambioState;
  const isMyTurn = currentTurnId === myId;

  // Turn indicator
  const turnEl = document.getElementById('turn-indicator');
  if (phase === 'peek') {
    turnEl.textContent = 'Initial Peek';
    turnEl.className   = 'turn-indicator';
  } else {
    const currentName = playerOrder.find(p => p.id === currentTurnId)?.name ?? '?';
    turnEl.textContent = isMyTurn ? 'Your turn — draw a card' : `${escapeHtml(currentName)}'s turn`;
    turnEl.className   = `turn-indicator${isMyTurn ? ' my-turn' : ''}`;
  }

  // Phase label
  const phaseEl = document.getElementById('phase-label');
  if (phase === 'peek') {
    phaseEl.textContent = 'Look at your bottom 2 cards, then click Done Peeking.';
    phaseEl.classList.remove('hidden');
  } else {
    phaseEl.classList.add('hidden');
  }

  // Draw pile — clickable only on your turn in playing phase with no card held
  const drawPileEl = document.getElementById('draw-pile-el');
  const drawable   = phase === 'playing' && isMyTurn && !localDrawnCard;
  drawPileEl.classList.toggle('drawable', drawable);

  // Opponents
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

  renderMyHand();
  renderDrawnArea();
}

// ── Utility ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
