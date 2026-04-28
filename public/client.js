const socket = io();

// ── Local state ────────────────────────────────────────────────────────────────
let myId        = null;
let myName      = null;
let currentRoom = null;
let cambioState = null;
let isConnected = false;

// Client-side voluntary hide after initial peek (server still tracks knownTo).
let locallyHiddenSlots = new Set();

// Card currently drawn this turn, awaiting discard or swap.
let localDrawnCard = null;

// True when Swap button was clicked and player is selecting a hand slot.
let swapMode = false;

// Tracks the current action the player is performing.
// null | { type, step, data: {} }
let pendingAction = null;

// Action type currently in progress (for turn indicator hint, shown to everyone).
let activeActionType  = null;
let activeActionActor = null;

// Match-discard mode (§3.5).
// 'off' | 'choose-card' | 'choose-give'
let matchMode = 'off';
// Stores the opponent's card selected in step 1 of an opponent match.
let matchOpponentTarget = null; // { targetId, targetSlot }

// Broadcast highlight: which cards are being targeted by the current action.
// Clears after the turn following the action ends (2 turn:advance events).
let actionBroadcast = null; // { actorId, type, targets: [{playerId, slot}] }
let actionBroadcastTurnCount = 0;

// Game log — entries appended on action:broadcast, match, and cambio events.
let gameLog    = [];
let logVisible = false;

// True while the player has clicked "Call Cambio" but not yet confirmed or cancelled.
let cambioConfirmPending = false;

const GAME_LABELS  = { cambio: 'Cambio', 'un-solitaire': 'Un-Solitaire' };
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS    = new Set(['hearts', 'diamonds']);

const ACTION_LABELS = {
  peek:              'Peek',
  spy:               'Spy',
  'blind-swap':      'Blind Swap',
  'look-swap':       'Look & Swap',
  'look-swap-peek':  'Look & Swap',
  swap:              'Swap',
};
const ACTION_TURN_HINTS = {
  peek:         'peeking at their own card',
  spy:          'spying on a player',
  'blind-swap': 'doing a blind swap',
  'look-swap':  'looking at an opponent\'s card',
};

// ── DOM refs ───────────────────────────────────────────────────────────────────
const connectionStatus = document.getElementById('connection-status');
const gotoCreateBtn    = document.getElementById('goto-create-btn');
const gotoJoinBtn      = document.getElementById('goto-join-btn');

const backFromName     = document.getElementById('back-from-name');
const nameForm         = document.getElementById('name-form');
const nameInput        = document.getElementById('name-input');
const nameError        = document.getElementById('name-error');
const nameScreenHeading  = document.getElementById('name-screen-heading');
const nameScreenSubtitle = document.getElementById('name-screen-subtitle');
const nameSubmitBtn    = document.getElementById('name-submit-btn');

const backFromJoin     = document.getElementById('back-from-join');
const roomsList        = document.getElementById('rooms-list');
const joinCodeInput    = document.getElementById('join-code-input');
const joinCodeBtn      = document.getElementById('join-code-btn');
const joinError        = document.getElementById('join-error');

let pendingRoomAction = null; // { type: 'create' } | { type: 'join', code: 'XXXX' }

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

// Action panel
const actionPanel          = document.getElementById('action-panel');
const actionLabelEl        = document.getElementById('action-label');
const actionInstruction    = document.getElementById('action-instruction');
const actionResultArea     = document.getElementById('action-result-area');
const actionResultCard     = document.getElementById('action-result-card');
const actionResultText     = document.getElementById('action-result-text');
const actionLookSwapBtn    = document.getElementById('action-look-swap-btn');
const actionLookSwapSkip   = document.getElementById('action-look-swap-skip-btn');
const actionDoneBtn        = document.getElementById('action-done-btn');
const actionSkipBtn        = document.getElementById('action-skip-btn');
const callCambioBtn        = document.getElementById('call-cambio-btn');
const cambioConfirmEl      = document.getElementById('cambio-confirm');
const confirmCambioBtn     = document.getElementById('confirm-cambio-btn');
const undoCambioBtn        = document.getElementById('undo-cambio-btn');

// Match row
const matchRow             = document.getElementById('match-row');
const matchModeText        = document.getElementById('match-mode-text');
const matchBtn             = document.getElementById('match-btn');

// Resolution
const resolutionOverlay    = document.getElementById('resolution-overlay');
const resolutionSubtitle   = document.getElementById('resolution-subtitle');
const resolutionPlayers    = document.getElementById('resolution-players');
const playAgainBtn         = document.getElementById('play-again-btn');

// Toast
const toastEl              = document.getElementById('toast');
let toastTimer    = null;
let toastIsSticky = false; // sticky toasts persist until turn:advance clears them

// ── Screen helper ──────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function clearError(el)     { el.textContent = ''; el.classList.add('hidden'); }

function showToast(msg, type = '', sticky = false) {
  clearTimeout(toastTimer);
  toastIsSticky = sticky;
  toastEl.textContent = msg;
  toastEl.className   = `toast${type ? ' ' + type : ''}${sticky ? ' action-msg' : ''}`;
  toastEl.classList.remove('hidden');
  if (!sticky) {
    toastTimer = setTimeout(() => { toastEl.classList.add('hidden'); toastIsSticky = false; }, 2800);
  }
}

// ── Connection ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id; isConnected = true;
  connectionStatus.textContent = 'Connected';
  connectionStatus.className = 'status-badge connected';
  gotoCreateBtn.disabled = false; gotoJoinBtn.disabled = false;
});
socket.on('disconnect', () => {
  isConnected = false;
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.className = 'status-badge disconnected';
  gotoCreateBtn.disabled = true; gotoJoinBtn.disabled = true;
});

// ── Name screen helpers ────────────────────────────────────────────────────────
function showNameScreen(action) {
  pendingRoomAction = action;
  clearError(nameError);
  nameInput.value = '';
  if (action.type === 'create') {
    nameScreenHeading.textContent  = 'Create a Room';
    nameScreenSubtitle.textContent = 'Choose a name to display to other players.';
    nameSubmitBtn.textContent      = 'Create Room';
  } else {
    nameScreenHeading.textContent  = 'Join Room ' + action.code;
    nameScreenSubtitle.textContent = 'Choose a name to display to other players.';
    nameSubmitBtn.textContent      = 'Join Room';
  }
  showScreen('name-screen');
  nameInput.focus();
}

// ── Home navigation ────────────────────────────────────────────────────────────
gotoCreateBtn.addEventListener('click', () => showNameScreen({ type: 'create' }));
gotoJoinBtn.addEventListener('click',   () => { clearError(joinError); showScreen('join-screen'); socket.emit('rooms:get'); });
backFromName.addEventListener('click',  () => {
  if (pendingRoomAction?.type === 'join') showScreen('join-screen');
  else showScreen('home-screen');
});
backFromJoin.addEventListener('click',  () => showScreen('home-screen'));

// ── Name form submit (handles both create and join) ────────────────────────────
nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) { showError(nameError, 'Please enter your name.'); return; }
  clearError(nameError);
  if (pendingRoomAction?.type === 'create') {
    socket.emit('room:create', { name });
  } else if (pendingRoomAction?.type === 'join') {
    socket.emit('room:join', { name, code: pendingRoomAction.code });
  }
});
socket.on('room:created', ({ code, playerId, name }) => {
  myId = playerId; myName = name; currentRoom = code;
  roomCodeDisplay.textContent = code; showScreen('lobby-screen');
});
socket.on('room:joined', ({ code, playerId, name }) => {
  myId = playerId; myName = name; currentRoom = code;
  roomCodeDisplay.textContent = code; showScreen('lobby-screen');
});
socket.on('room:error', ({ message }) => {
  showError(nameError, message);
});

// ── Join room ──────────────────────────────────────────────────────────────────
function goToNameForJoin(code) {
  clearError(joinError);
  showNameScreen({ type: 'join', code });
}
roomsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-join-btn');
  if (btn) goToNameForJoin(btn.dataset.code);
});
joinCodeInput.addEventListener('input', () => { joinCodeInput.value = joinCodeInput.value.toUpperCase(); });
joinCodeBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) { showError(joinError, 'Room code must be 4 letters.'); return; }
  goToNameForJoin(code);
});

// ── Live room list ─────────────────────────────────────────────────────────────
socket.on('rooms:list', (openRooms) => {
  if (openRooms.length === 0) { roomsList.innerHTML = '<p class="rooms-empty">No open rooms yet.</p>'; return; }
  roomsList.innerHTML = openRooms.map(r => `
    <div class="room-item">
      <span class="room-code-label">${r.code}</span>
      <div class="room-details">
        <span class="room-game">${GAME_LABELS[r.game] ?? r.game}</span>
        <span class="room-players">${r.playerCount} / ${r.maxPlayers} players</span>
      </div>
      <button class="room-join-btn" data-code="${r.code}">Join</button>
    </div>`).join('');
});

// ── Lobby ──────────────────────────────────────────────────────────────────────
socket.on('room:update', ({ hostId, players, game, canStart }) => {
  const isHost = myId === hostId;
  lobbyStatus.textContent = players.length === 1 ? 'Waiting for at least one more player…' : `${players.length} players in lobby`;
  playerList.innerHTML = players.map(p => `
    <li class="${p.id === myId ? 'you' : ''}">
      <span class="dot"></span>
      <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}${p.id === hostId ? ' ★' : ''}</span>
    </li>`).join('');
  gameOptions.forEach(btn => { btn.classList.toggle('active', btn.dataset.game === game); btn.disabled = !isHost; });
  hostNote.classList.toggle('hidden', isHost);
  startBtn.disabled = !canStart || !isHost;
});
gameOptions.forEach(btn => { btn.addEventListener('click', () => { socket.emit('room:selectGame', { code: currentRoom, game: btn.dataset.game }); }); });
startBtn.addEventListener('click', () => { socket.emit('room:start', { code: currentRoom }); });
leaveBtn.addEventListener('click', () => { socket.disconnect(); socket.connect(); currentRoom = null; showScreen('home-screen'); });

// ── Game state reset ───────────────────────────────────────────────────────────
function resetGameState() {
  locallyHiddenSlots  = new Set();
  localDrawnCard      = null;
  swapMode            = false;
  pendingAction       = null;
  activeActionType    = null;
  activeActionActor   = null;
  matchMode           = 'off';
  matchOpponentTarget = null;
  actionBroadcast          = null;
  actionBroadcastTurnCount = 0;
  gameLog                  = [];
  logVisible               = false;
  clearTimeout(toastTimer);
  toastIsSticky = false;
  toastEl.classList.add('hidden');
  cambioConfirmPending = false;
}

const usBoard = document.getElementById('unsolitaire-board');

// ── Un-Solitaire state ─────────────────────────────────────────────────────────
let usState        = null; // latest view from server
let usPlayerOrder  = [];   // [{id, name}, ...]
let usMyId         = null;
let usOriginalHand = [];   // deal order — sort indices always reference this, never the server-reordered hand
let usSortOrder    = [];   // permutation of usOriginalHand indices
let usSelected     = null; // { type: 'tableau'|'hand'|'discard', colIndex?, cardIndex? }
let usDragSrc      = null; // { colIdx, cardIdx } during tableau drag

const SUIT_SYMBOLS_US = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS_US    = new Set(['hearts', 'diamonds']);
const RANKS_US        = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function canStackOnTableau(card, targetCard) {
  if (!targetCard) return card.rank === 'K';
  if (RANKS_US.indexOf(card.rank) !== RANKS_US.indexOf(targetCard.rank) - 1) return false;
  return RED_SUITS_US.has(card.suit) !== RED_SUITS_US.has(targetCard.suit);
}

function canPlaceOnFoundation(card, foundationPile) {
  if (foundationPile.length === 0) return card.rank === 'A';
  return card.suit === foundationPile.at(-1).suit &&
    RANKS_US.indexOf(card.rank) === RANKS_US.indexOf(foundationPile.at(-1).rank) + 1;
}

// ── Game started ───────────────────────────────────────────────────────────────
socket.on('game:started', (payload) => {
  if (payload.game === 'cambio') {
    cambioState = payload;
    resetGameState();
    cambioBoard.classList.remove('hidden');
    usBoard.classList.add('hidden');
    genericGameInfo.classList.add('hidden');
    resolutionOverlay.classList.add('hidden');
    renderCambioBoard();
  } else if (payload.game === 'un-solitaire') {
    usState        = payload;
    usMyId         = payload.myId;
    usPlayerOrder  = payload.playerOrder ?? [];
    usOriginalHand = [...payload.myHand];
    usSortOrder    = payload.myHand.map((_, i) => i);
    usSelected     = null;
    cambioBoard.classList.add('hidden');
    usBoard.classList.remove('hidden');
    genericGameInfo.classList.add('hidden');
    resolutionOverlay.classList.add('hidden');
    renderUSBoard();
  } else {
    cambioBoard.classList.add('hidden');
    usBoard.classList.add('hidden');
    genericGameInfo.classList.remove('hidden');
    gameTitle.textContent = GAME_LABELS[payload.game] ?? payload.game;
    gameInfo.textContent  = `Players: ${(payload.players ?? []).map(p => p.name).join(', ')}`;
  }
  showScreen('game-screen');
});

// ── Peek phase ─────────────────────────────────────────────────────────────────
document.getElementById('done-peeking-btn').addEventListener('click', () => {
  locallyHiddenSlots.add(2); locallyHiddenSlots.add(3);
  document.getElementById('done-peeking-btn').classList.add('hidden');
  document.getElementById('peek-wait-text').classList.remove('hidden');
  renderMyHand();
  socket.emit('playerReady', { code: currentRoom });
});
socket.on('beginTurns', ({ currentTurnId }) => {
  cambioState.phase = 'playing'; cambioState.currentTurnId = currentTurnId;
  document.getElementById('done-peeking-btn').classList.add('hidden');
  document.getElementById('peek-wait-text').classList.add('hidden');
  renderCambioBoard();
});

// ── Draw from deck ─────────────────────────────────────────────────────────────
document.getElementById('draw-pile-el').addEventListener('click', () => {
  if (!['playing', 'final-round'].includes(cambioState?.phase)) return;
  if (cambioState.currentTurnId !== myId) return;
  if (localDrawnCard || pendingAction || matchMode !== 'off') return;
  socket.emit('deck:draw', { code: currentRoom });
});
socket.on('card:drawn', ({ card }) => {
  localDrawnCard = card;
  renderDrawnArea();
  document.getElementById('draw-pile-el').classList.add('inactive');
});
socket.on('deck:update', ({ drawPileCount }) => {
  cambioState.drawPileCount = drawPileCount;
  document.getElementById('draw-pile-count').textContent = `${drawPileCount} left`;
});

// ── Drawn card actions ─────────────────────────────────────────────────────────
document.getElementById('discard-drawn-btn').addEventListener('click', () => {
  if (!localDrawnCard) return;
  socket.emit('draw:discard', { code: currentRoom });
  localDrawnCard = null; swapMode = false;
  renderDrawnArea(); renderMyHand();
  document.getElementById('draw-pile-el').classList.remove('inactive');
});
document.getElementById('swap-drawn-btn').addEventListener('click', () => {
  swapMode = !swapMode;
  const btn = document.getElementById('swap-drawn-btn');
  btn.textContent = swapMode ? 'Cancel' : 'Swap';
  btn.classList.toggle('active', swapMode);
  renderMyHand();
});

// ── Hand card clicks ───────────────────────────────────────────────────────────
document.getElementById('my-hand').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-slot]');
  if (!card) return;
  if (card.classList.contains('empty-slot')) return;
  const slotIndex = parseInt(card.dataset.slot, 10);

  // Swap mode: swap drawn card into this slot.
  if (swapMode && localDrawnCard) {
    socket.emit('draw:swap', { code: currentRoom, slotIndex });
    locallyHiddenSlots.delete(slotIndex);
    localDrawnCard = null; swapMode = false;
    renderDrawnArea(); renderMyHand();
    document.getElementById('draw-pile-el').classList.remove('inactive');
    return;
  }

  // Match mode — give own card to opponent (step 2 of opponent match).
  if (matchMode === 'choose-give' && matchOpponentTarget) {
    socket.emit('match:opponent', { code: currentRoom, ...matchOpponentTarget, mySlot: slotIndex });
    exitMatchMode();
    return;
  }

  // Match mode — self match (clicking own card).
  if (matchMode === 'choose-card') {
    socket.emit('match:self', { code: currentRoom, slotIndex });
    exitMatchMode();
    return;
  }

  // Action mode: peek, blind-swap step 1, or look-swap swap step.
  if (!pendingAction) return;
  if (pendingAction.type === 'peek' && pendingAction.step === 'choose-card') {
    socket.emit('action:peek', { code: currentRoom, slotIndex });
    pendingAction = null; activeActionType = null; activeActionActor = null;
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-first') {
    pendingAction.data.card1 = { playerId: myId, slot: slotIndex };
    pendingAction.step = 'choose-second';
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-second') {
    const card1 = pendingAction.data.card1;
    const card2 = { playerId: myId, slot: slotIndex };
    if (card1.playerId === card2.playerId && card1.slot === card2.slot) return;
    socket.emit('action:blind-swap', { code: currentRoom, card1, card2 });
    pendingAction = null; activeActionType = null; activeActionActor = null;
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'look-swap' && pendingAction.step === 'choose-own-for-swap') {
    socket.emit('action:look-swap-decide', { code: currentRoom, mySlot: slotIndex });
    pendingAction = null; activeActionType = null; activeActionActor = null;
    renderActionPanel(); return;
  }
});

// ── Opponent card clicks ───────────────────────────────────────────────────────
document.getElementById('opponents-area').addEventListener('click', (e) => {
  const card     = e.target.closest('.card[data-slot]');
  if (!card) return;
  if (card.classList.contains('empty-slot')) return;
  const opponent = e.target.closest('[data-player-id]');
  if (!opponent) return;
  const targetId  = opponent.dataset.playerId;
  const slotIndex = parseInt(card.dataset.slot, 10);

  // Match mode — select opponent's card (step 1 of opponent match).
  if (matchMode === 'choose-card') {
    matchOpponentTarget = { targetId, targetSlot: slotIndex };
    matchMode = 'choose-give';
    renderMatchRow(); renderMyHand();
    return;
  }

  // Action mode.
  if (!pendingAction) return;
  if (pendingAction.type === 'spy' && pendingAction.step === 'choose-target') {
    socket.emit('action:spy', { code: currentRoom, targetId, slotIndex });
    pendingAction = null; activeActionType = null; activeActionActor = null;
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-first') {
    pendingAction.data.card1 = { playerId: targetId, slot: slotIndex };
    pendingAction.step = 'choose-second';
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-second') {
    const card1 = pendingAction.data.card1;
    const card2 = { playerId: targetId, slot: slotIndex };
    if (card1.playerId === card2.playerId && card1.slot === card2.slot) return;
    socket.emit('action:blind-swap', { code: currentRoom, card1, card2 });
    pendingAction = null; activeActionType = null; activeActionActor = null;
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'look-swap' && pendingAction.step === 'choose-target') {
    socket.emit('action:look-swap-peek', { code: currentRoom, targetId, slotIndex });
    return;
  }
});

// ── Match button ───────────────────────────────────────────────────────────────
matchBtn.addEventListener('click', () => {
  if (matchMode !== 'off') { exitMatchMode(); return; }
  if (localDrawnCard || pendingAction) return; // can't match while holding a card or during action
  matchMode = 'choose-card';
  matchOpponentTarget = null;
  renderMatchRow(); renderMyHand(); renderCambioBoard();
});

function exitMatchMode() {
  matchMode = 'off'; matchOpponentTarget = null;
  renderMatchRow(); renderMyHand(); renderCambioBoard();
}

// ── Match socket events ────────────────────────────────────────────────────────
socket.on('match:success', ({ playerId, targetId, discardTop, drawPileCount, opponentHandSizes, seenUpdates }) => {
  cambioState.discardTop    = discardTop;
  cambioState.drawPileCount = drawPileCount;
  if (opponentHandSizes) mergeOpponentHandSizes(opponentHandSizes);
  applySeenUpdates(seenUpdates);
  const name       = cambioState.playerOrder.find(p => p.id === playerId)?.name ?? '?';
  const targetName = targetId ? (cambioState.playerOrder.find(p => p.id === targetId)?.name ?? '?') : null;
  const msg     = playerId === myId ? 'Match! Card discarded.' : `${escapeHtml(name)} matched a card!`;
  const logMsg  = targetId
    ? `${escapeHtml(name)} matched one of ${escapeHtml(targetName)}'s cards`
    : `${escapeHtml(name)} matched their own card`;
  addLogEntry(logMsg);
  showToast(msg, 'success');
  renderCambioBoard();
});

socket.on('match:penalty', ({ playerId, drawPileCount, opponentHandSizes, seenUpdates }) => {
  cambioState.drawPileCount = drawPileCount;
  if (opponentHandSizes) mergeOpponentHandSizes(opponentHandSizes);
  applySeenUpdates(seenUpdates);
  const name = cambioState.playerOrder.find(p => p.id === playerId)?.name ?? '?';
  const msg  = playerId === myId ? 'Wrong match — penalty card added!' : `${escapeHtml(name)} bad match — penalty!`;
  addLogEntry(`${escapeHtml(name)} mismatch — penalty card added`);
  showToast(msg, 'penalty');
  renderCambioBoard();
});

// Propagate null (empty tombstone) slot data to observers so they render empty slots correctly.
function applySeenUpdates(seenUpdates) {
  if (!seenUpdates) return;
  if (!cambioState.opponentsSeen) cambioState.opponentsSeen = {};
  for (const [id, seen] of Object.entries(seenUpdates)) {
    if (id !== myId) cambioState.opponentsSeen[id] = seen;
  }
}

// Update the client's opponentHandSizes map; keeps opponentsSeen arrays in sync by trimming/padding.
function mergeOpponentHandSizes(sizes) {
  if (!cambioState.opponentHandSizes) cambioState.opponentHandSizes = {};
  for (const [id, size] of Object.entries(sizes)) {
    cambioState.opponentHandSizes[id] = size;
    // Trim or pad the seen-booleans array to match the new hand size.
    if (cambioState.opponentsSeen?.[id]) {
      while (cambioState.opponentsSeen[id].length > size) cambioState.opponentsSeen[id].pop();
      while (cambioState.opponentsSeen[id].length < size) cambioState.opponentsSeen[id].push(false);
    }
  }
}

// ── Action panel button handlers ───────────────────────────────────────────────
actionSkipBtn.addEventListener('click', () => {
  socket.emit('action:skip', { code: currentRoom });
  pendingAction = null; activeActionType = null; activeActionActor = null;
  renderActionPanel();
});
actionDoneBtn.addEventListener('click', () => {
  pendingAction = null; activeActionType = null; activeActionActor = null;
  socket.emit('action:done', { code: currentRoom });
  renderActionPanel(); renderCambioBoard();
});
actionLookSwapBtn.addEventListener('click', () => {
  pendingAction.step = 'choose-own-for-swap'; renderActionPanel();
});
actionLookSwapSkip.addEventListener('click', () => {
  socket.emit('action:look-swap-decide', { code: currentRoom, mySlot: -1 });
  pendingAction = null; activeActionType = null; activeActionActor = null;
  renderActionPanel();
});

// ── Action socket events ───────────────────────────────────────────────────────
const ACTION_PRESENT = {
  peek:         'is peeking at one of their cards',
  spy:          'is about to spy on a card',
  'blind-swap': 'is doing a blind swap',
  'look-swap':  'is about to look & swap',
};

socket.on('action:required', ({ type, actingPlayerId, discardTop, drawPileCount }) => {
  cambioState.discardTop = discardTop; cambioState.drawPileCount = drawPileCount;
  activeActionType = type; activeActionActor = actingPlayerId;
  if (actingPlayerId !== myId) {
    const name = escapeHtml(cambioState?.playerOrder.find(p => p.id === actingPlayerId)?.name ?? '?');
    showToast(`${name} ${ACTION_PRESENT[type] ?? 'is taking an action'}`, '', true);
  }
  if (actingPlayerId === myId) {
    pendingAction = {
      type, data: {},
      step: type === 'peek' ? 'choose-card' : type === 'spy' ? 'choose-target' : type === 'blind-swap' ? 'choose-first' : 'choose-target',
    };
  }
  renderCambioBoard(); renderActionPanel();
});

socket.on('action:peek-result', ({ card, slotIndex }) => {
  actionLabelEl.textContent     = 'Peek';
  actionInstruction.textContent = `Your card ${slotIndex + 1}:`;
  actionResultCard.innerHTML    = renderCard(card);
  actionResultText.textContent  = 'Memorise it, then tap Done.';
  actionResultArea.classList.remove('hidden');
  actionSkipBtn.classList.add('hidden'); actionDoneBtn.classList.remove('hidden');
  actionLookSwapBtn.classList.add('hidden'); actionLookSwapSkip.classList.add('hidden');
  actionPanel.classList.remove('hidden');
  // Store slotIndex so Done can hide the card again.
  pendingAction = { type: 'peek', step: 'showing-result', data: { slotIndex } };
});

socket.on('action:spy-result', ({ card, targetName, slotIndex }) => {
  actionLabelEl.textContent     = 'Spy';
  actionInstruction.textContent = `${escapeHtml(targetName)}'s card ${slotIndex + 1}:`;
  actionResultCard.innerHTML    = renderCard(card);
  actionResultText.textContent  = '';
  actionResultArea.classList.remove('hidden');
  actionSkipBtn.classList.add('hidden'); actionDoneBtn.classList.remove('hidden');
  actionLookSwapBtn.classList.add('hidden'); actionLookSwapSkip.classList.add('hidden');
  actionPanel.classList.remove('hidden');
  pendingAction = { type: 'spy', step: 'showing-result', data: {} };
});

function buildActionBroadcastMsg(actorId, type, targets) {
  const actorName = escapeHtml(cambioState?.playerOrder.find(p => p.id === actorId)?.name ?? '?');
  function cardOf(playerId) {
    if (playerId === myId)    return 'your card';
    if (playerId === actorId) return 'their card';
    const n = cambioState?.playerOrder.find(p => p.id === playerId)?.name ?? '?';
    return `${escapeHtml(n)}'s card`;
  }
  switch (type) {
    case 'peek':
      return `${actorName} is peeking at their card ${(targets[0]?.slot ?? 0) + 1}`;
    case 'spy':
    case 'look-swap-peek': {
      const t = targets[0];
      if (!t) return `${actorName} is peeking at a card`;
      const whose = t.playerId === myId ? 'one of YOUR cards' : cardOf(t.playerId);
      return `${actorName} is peeking at ${whose}`;
    }
    case 'blind-swap': {
      if (targets.length < 2) return `${actorName} swapped two cards`;
      return `${actorName} swapped ${cardOf(targets[0].playerId)} with ${cardOf(targets[1].playerId)}`;
    }
    case 'look-swap': {
      const opp = targets.find(t => t.playerId !== actorId);
      if (!opp) return `${actorName} swapped cards`;
      const whose = opp.playerId === myId ? 'YOUR card' : cardOf(opp.playerId);
      return `${actorName} swapped ${whose} with their own`;
    }
    case 'swap':
      return `${actorName} swapped their drawn card into slot ${(targets[0]?.slot ?? 0) + 1}`;
    default:
      return `${actorName}: ${ACTION_LABELS[type] ?? type}`;
  }
}

// Shown to ALL players — highlights targeted cards until the turn after it ends.
socket.on('action:broadcast', ({ actorId, type, targets }) => {
  actionBroadcast = { actorId, type, targets };
  actionBroadcastTurnCount = 0;
  const msg = buildActionBroadcastMsg(actorId, type, targets);
  addLogEntry(msg);
  if (actorId !== myId) showToast(msg, '', true);
  renderCambioBoard();
});

socket.on('action:look-swap-reveal', ({ card, targetName, slotIndex }) => {
  actionLabelEl.textContent     = 'Look & Swap';
  actionInstruction.textContent = `${escapeHtml(targetName)}'s card ${slotIndex + 1}:`;
  actionResultCard.innerHTML    = renderCard(card);
  actionResultText.textContent  = 'Swap it with one of your cards, or skip.';
  actionResultArea.classList.remove('hidden');
  actionSkipBtn.classList.add('hidden'); actionDoneBtn.classList.add('hidden');
  actionLookSwapBtn.classList.remove('hidden'); actionLookSwapSkip.classList.remove('hidden');
  actionPanel.classList.remove('hidden');
  if (pendingAction) pendingAction.step = 'showing-reveal';
  renderMyHand();
});

// ── Cambio called ──────────────────────────────────────────────────────────────
socket.on('cambio:called', ({ callerId, callerName }) => {
  cambioState.phase = 'final-round'; cambioState.cambioCallerId = callerId;
  const phaseEl = document.getElementById('phase-label');
  phaseEl.textContent = `${escapeHtml(callerName)} called Cambio — final round!`;
  phaseEl.classList.remove('hidden');
  addLogEntry(`${escapeHtml(callerName)} called Cambio!`);
  cambioConfirmPending = false;
  renderCambioBoard();
});
callCambioBtn.addEventListener('click', () => {
  cambioConfirmPending = true;
  renderMyHand();
});
confirmCambioBtn.addEventListener('click', () => {
  cambioConfirmPending = false;
  socket.emit('room:cambio', { code: currentRoom });
  renderMyHand();
});
undoCambioBtn.addEventListener('click', () => {
  cambioConfirmPending = false;
  renderMyHand();
});

// ── Turn progression ───────────────────────────────────────────────────────────
socket.on('turn:advance', ({ discardTop, currentTurnId, drawPileCount }) => {
  cambioState.discardTop = discardTop; cambioState.currentTurnId = currentTurnId; cambioState.drawPileCount = drawPileCount;
  if (pendingAction?.step !== 'showing-result' && pendingAction?.step !== 'showing-reveal') {
    activeActionType = null; activeActionActor = null;
  }
  // Clear any persistent action message now that the turn has moved on.
  if (toastIsSticky) {
    clearTimeout(toastTimer);
    toastEl.classList.add('hidden');
    toastIsSticky = false;
  }
  // Keep action highlight through the next player's full turn, then clear.
  actionBroadcastTurnCount++;
  if (actionBroadcastTurnCount >= 2) {
    actionBroadcast = null;
    actionBroadcastTurnCount = 0;
  }
  renderCambioBoard();
});
socket.on('hand:update', ({ hand }) => {
  cambioState.hand = hand; renderMyHand();
});

// ── Resolution ─────────────────────────────────────────────────────────────────
socket.on('game:over', ({ hands, scores, playerOrder, cambioCallerId, callerPenalty, winnerId }) => {
  const winnerName = playerOrder.find(p => p.id === winnerId)?.name ?? '?';
  const callerName = playerOrder.find(p => p.id === cambioCallerId)?.name ?? null;
  resolutionSubtitle.textContent = callerPenalty > 0
    ? `${escapeHtml(callerName)} called Cambio but didn't win — +${callerPenalty} penalty!`
    : callerName ? `${escapeHtml(callerName)} called Cambio.` : '';
  resolutionPlayers.innerHTML = playerOrder.map(p => {
    const hand    = (hands[p.id] ?? []).map(c => renderCard(c)).join('');
    const penalty = p.id === cambioCallerId && callerPenalty > 0 ? `<p class="resolution-penalty">+${callerPenalty} Cambio penalty</p>` : '';
    return `
      <div class="resolution-player">
        <p class="resolution-player-name">
          ${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}
          ${p.id === winnerId ? '<span class="winner-badge">Winner!</span>' : ''}
        </p>
        <div class="resolution-hand">${hand}</div>
        <p class="resolution-score">Score: ${scores[p.id]}</p>
        ${penalty}
      </div>`;
  }).join('');
  resolutionOverlay.classList.remove('hidden');
});
playAgainBtn.addEventListener('click', () => { socket.emit('room:restart', { code: currentRoom }); });

// ── Back to menu ───────────────────────────────────────────────────────────────
backBtn.addEventListener('click', () => { socket.disconnect(); socket.connect(); currentRoom = null; showScreen('home-screen'); });

const logToggleBtn = document.getElementById('log-toggle-btn');
logToggleBtn.addEventListener('click', () => {
  logVisible = !logVisible;
  logToggleBtn.textContent = logVisible ? 'Hide Log' : 'Log';
  logToggleBtn.classList.toggle('active', logVisible);
  renderGameLog();
});

// ── Cambio rendering ───────────────────────────────────────────────────────────

function addLogEntry(msg) {
  gameLog.push(msg);
  if (gameLog.length > 60) gameLog.shift();
  renderGameLog();
}

function renderGameLog() {
  const logPanel   = document.getElementById('game-log-panel');
  const logContent = document.getElementById('game-log-content');
  if (!logPanel || !logContent) return;
  logPanel.classList.toggle('hidden', !logVisible);
  logContent.innerHTML = gameLog.length === 0
    ? '<p class="log-empty">No actions yet.</p>'
    : gameLog.slice().reverse().map(e => `<p class="log-entry">${escapeHtml(e)}</p>`).join('');
}

function renderCard(card, slotIndex = -1, extraClass = '') {
  const slotAttr = slotIndex >= 0 ? ` data-slot="${slotIndex}"` : '';
  if (!card) {
    return `<div class="card face-down${extraClass}"${slotAttr}>
      <div class="card-back-inner"></div>
    </div>`;
  }
  const colorClass = RED_SUITS.has(card.suit) ? 'red' : 'black';
  const sym = SUIT_SYMBOLS[card.suit];
  return `<div class="card face-up ${colorClass}${extraClass}"${slotAttr}>
    <span class="card-tl">${card.rank}<br>${sym}</span>
    <span class="card-suit">${sym}</span>
    <span class="card-br">${card.rank}<br>${sym}</span>
  </div>`;
}

function isMyCardActionTarget() {
  if (!pendingAction) return false;
  if (pendingAction.type === 'peek' && pendingAction.step === 'choose-card') return true;
  if (pendingAction.type === 'blind-swap' && (pendingAction.step === 'choose-first' || pendingAction.step === 'choose-second')) return true;
  if (pendingAction.type === 'look-swap'  && pendingAction.step === 'choose-own-for-swap') return true;
  return false;
}

function isOpponentCardActionTarget(opponentId, slotIndex) {
  if (!pendingAction) return false;
  if (pendingAction.type === 'spy'        && pendingAction.step === 'choose-target') return true;
  if (pendingAction.type === 'blind-swap' && (pendingAction.step === 'choose-first' || pendingAction.step === 'choose-second')) return true;
  if (pendingAction.type === 'look-swap'  && pendingAction.step === 'choose-target') return true;
  return false;
}

function isActionBroadcastTarget(playerId, slot) {
  if (!actionBroadcast) return false;
  return actionBroadcast.targets.some(t => t.playerId === playerId && t.slot === slot);
}

function renderMyHand() {
  const { hand, phase } = cambioState;
  document.getElementById('my-hand').innerHTML = hand.map((card, i) => {
    if (card?.empty) return `<div class="card empty-slot" data-slot="${i}"></div>`;
    // Cards are only face-up during the initial peek phase; always face-down after.
    const visible = phase === 'peek' && card && !locallyHiddenSlots.has(i);
    let extra = '';
    if (swapMode && localDrawnCard)             extra = ' swappable';
    else if (matchMode === 'choose-give')        extra = ' match-give';
    else if (matchMode === 'choose-card')        extra = ' match-target';
    else if (isMyCardActionTarget(i))            extra = ' action-target';
    else if (isActionBroadcastTarget(myId, i))  extra = ' action-highlight';
    return renderCard(visible ? card : null, i, extra);
  }).join('');

  const donePeekingBtn = document.getElementById('done-peeking-btn');
  const peekWaitText   = document.getElementById('peek-wait-text');
  const handLabel      = document.getElementById('hand-label-text');
  const playerNotReady = phase === 'peek' && !locallyHiddenSlots.has(2);
  donePeekingBtn.classList.toggle('hidden', !playerNotReady);
  peekWaitText.classList.toggle('hidden', !(phase === 'peek' && locallyHiddenSlots.has(2)));
  handLabel.textContent = phase === 'peek' && !locallyHiddenSlots.has(2) ? 'Your Cards — bottom row peeked' : 'Your Cards';

  const isMyTurn   = cambioState.currentTurnId === myId;
  const canCallCambio = phase === 'playing' && isMyTurn && !localDrawnCard && !pendingAction && matchMode === 'off';
  callCambioBtn.classList.toggle('hidden', !canCallCambio || cambioConfirmPending);
  cambioConfirmEl.classList.toggle('hidden', !cambioConfirmPending);
}

function renderDrawnArea() {
  const area = document.getElementById('drawn-card-area');
  if (!localDrawnCard || cambioState?.currentTurnId !== myId) {
    area.classList.add('hidden');
    const swapBtn = document.getElementById('swap-drawn-btn');
    swapBtn.textContent = 'Swap'; swapBtn.classList.remove('active');
    return;
  }
  area.classList.remove('hidden');
  document.getElementById('drawn-card-display').innerHTML = renderCard(localDrawnCard);
}

function renderMatchRow() {
  const phase = cambioState?.phase;
  const active = ['playing', 'final-round'].includes(phase);
  matchRow.classList.toggle('hidden', !active);
  if (!active) return;
  matchBtn.textContent = matchMode !== 'off' ? 'Cancel' : 'Match Discard';
  matchBtn.classList.toggle('active', matchMode !== 'off');
  if (matchMode === 'choose-card') {
    matchModeText.textContent = 'Click one of your cards or an opponent\'s card to match the discard.';
  } else if (matchMode === 'choose-give') {
    matchModeText.textContent = 'Now click one of your cards to give to the opponent.';
  } else {
    matchModeText.textContent = '';
  }
}

function renderActionPanel() {
  if (!pendingAction || pendingAction.step === 'showing-result' || pendingAction.step === 'showing-reveal') {
    if (!pendingAction) actionPanel.classList.add('hidden');
    renderMyHand();
    return;
  }
  actionPanel.classList.remove('hidden');
  actionResultArea.classList.add('hidden');
  actionDoneBtn.classList.add('hidden');
  actionLookSwapBtn.classList.add('hidden');
  actionLookSwapSkip.classList.add('hidden');
  actionSkipBtn.classList.remove('hidden');
  actionLabelEl.textContent = ACTION_LABELS[pendingAction.type] ?? pendingAction.type;
  switch (pendingAction.type) {
    case 'peek':       actionInstruction.textContent = 'Click one of your face-down cards to peek at it.'; break;
    case 'spy':        actionInstruction.textContent = 'Click any face-down card of an opponent to spy on it.'; break;
    case 'blind-swap': actionInstruction.textContent = pendingAction.step === 'choose-first'
        ? 'Choose any card to swap (yours or an opponent\'s).' : 'Now choose a second card to swap with it.'; break;
    case 'look-swap':  actionInstruction.textContent = pendingAction.step === 'choose-own-for-swap'
        ? 'Choose one of your cards to swap.' : 'Click an opponent\'s face-down card to look at it.'; break;
  }
  renderMyHand();
}

function renderCambioBoard() {
  if (!cambioState) return;
  const { discardTop, drawPileCount, playerOrder, myIndex, currentTurnId, phase } = cambioState;
  const isMyTurn = currentTurnId === myId;

  // Turn indicator.
  const turnEl = document.getElementById('turn-indicator');
  if (phase === 'peek') {
    turnEl.textContent = 'Initial Peek'; turnEl.className = 'turn-indicator';
  } else {
    const currentName = playerOrder.find(p => p.id === currentTurnId)?.name ?? '?';
    const hint = activeActionType && activeActionActor
      ? (activeActionActor === myId ? `, ${ACTION_LABELS[activeActionType]}` : `, ${ACTION_TURN_HINTS[activeActionType]}`)
      : '';
    turnEl.textContent = isMyTurn ? `Your turn${hint || ' — draw a card'}` : `${escapeHtml(currentName)}'s turn${hint}`;
    turnEl.className = `turn-indicator${isMyTurn ? ' my-turn' : ''}`;
  }

  // Phase label.
  const phaseEl = document.getElementById('phase-label');
  if (phase === 'peek') {
    phaseEl.textContent = 'Look at your bottom 2 cards, then click Done Peeking.';
    phaseEl.classList.remove('hidden');
  } else if (phase === 'final-round') {
    phaseEl.classList.remove('hidden'); // banner set via cambio:called, don't overwrite
  } else {
    phaseEl.classList.add('hidden');
  }

  // Draw pile.
  const drawPileEl = document.getElementById('draw-pile-el');
  const drawable   = ['playing', 'final-round'].includes(phase) && isMyTurn && !localDrawnCard && !pendingAction && matchMode === 'off';
  drawPileEl.classList.toggle('drawable', drawable);

  // Opponents — use opponentHandSizes if available, fall back to opponentsSeen length.
  const opponents = playerOrder.filter((_, i) => i !== myIndex);
  document.getElementById('opponents-area').innerHTML = opponents.map(p => {
    const seenSlots  = cambioState.opponentsSeen?.[p.id] ?? [];
    const handSize   = cambioState.opponentHandSizes?.[p.id] ?? seenSlots.length;
    // Preserve null (empty tombstone slot) — don't coerce to false.
    const normSeen   = Array.from({ length: handSize }, (_, i) => {
      const v = seenSlots[i]; return v === undefined ? false : v;
    });
    // Flip display order for 4-card hands so the opponent's "bottom" row appears at top.
    // 180° table rotation: slot 0 (my top-left) appears at opponent's bottom-right, etc.
    const order = handSize === 4 ? [3, 2, 1, 0] : Array.from({ length: handSize }, (_, i) => i);
    const cardHtml = order.map(i => {
      if (normSeen[i] === null) return `<div class="card empty-slot" data-slot="${i}"></div>`;
      let extra = isOpponentCardActionTarget(p.id, i) ? ' action-target' : '';
      if (matchMode === 'choose-card' && !extra)          extra = ' match-target';
      if (!extra && isActionBroadcastTarget(p.id, i))    extra = ' action-highlight';
      return renderCard(null, i, extra);
    }).join('');
    return `
      <div class="opponent${p.id === currentTurnId ? ' active-turn' : ''}" data-player-id="${p.id}">
        <p class="opponent-name">${escapeHtml(p.name)}</p>
        <div class="opponent-cards">${cardHtml}</div>
      </div>`;
  }).join('');

  document.getElementById('draw-pile-count').textContent = `${drawPileCount} left`;
  document.getElementById('discard-pile-card').innerHTML = renderCard(discardTop);

  renderMyHand();
  renderDrawnArea();
  renderMatchRow();
  renderActionPanel();
}

// ════════════════════════════════════════════════════════════════════════════════
// ── Un-Solitaire ─────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════════

socket.on('us:state', (view) => {
  usState = { ...usState, ...view };
  renderUSBoard();
});

socket.on('us:game-over', ({ result, givenUpBy }) => {
  if (!usState) return;
  usState.phase = 'resolution';
  const overlay = document.getElementById('resolution-overlay');
  const subtitle = document.getElementById('resolution-subtitle');
  const players  = document.getElementById('resolution-players');
  if (result === 'win') {
    subtitle.textContent = 'You uncovered every card — you win!';
  } else {
    const quitter = usPlayerOrder.find(p => p.id === givenUpBy)?.name ?? '?';
    subtitle.textContent = `${escapeHtml(quitter)} gave up.`;
  }
  players.innerHTML = '';
  overlay.classList.remove('hidden');
});

// ── Give Up button ─────────────────────────────────────────────────────────────
document.getElementById('us-give-up-btn').addEventListener('click', () => {
  socket.emit('us:give-up', { code: currentRoom });
});

// ── Sort-ready button ──────────────────────────────────────────────────────────
document.getElementById('us-sort-ready-btn').addEventListener('click', () => {
  if (!usState) return;
  const btn = document.getElementById('us-sort-ready-btn');
  btn.disabled = true;
  // Commit current drag order to server
  socket.emit('us:reorder-hand', { code: currentRoom, order: usSortOrder });
  socket.emit('us:sort-ready',   { code: currentRoom });
});

// ── Render helpers ─────────────────────────────────────────────────────────────
function usCardHtml(card, extraClass = '', extraAttrs = '') {
  if (!card) return '';
  const sym   = SUIT_SYMBOLS_US[card.suit] ?? card.suit[0];
  const color = RED_SUITS_US.has(card.suit) ? 'red' : 'black';
  return `<div class="us-col-card face-up ${color}${extraClass ? ' ' + extraClass : ''}" ${extraAttrs}>
    <span class="us-card-tl">${card.rank}<br>${sym}</span>
    <span class="us-card-suit">${sym}</span>
    <span class="us-card-br">${card.rank}<br>${sym}</span>
  </div>`;
}

function usFaceDownHtml(extraClass = '') {
  return `<div class="us-col-card face-down${extraClass ? ' ' + extraClass : ''}">
    <div class="us-card-back"></div>
  </div>`;
}

// ── Main render ────────────────────────────────────────────────────────────────
function renderUSBoard() {
  if (!usState) return;
  const { tableau, foundations, myHand, myDiscard,
          partnerHandSize, partnerDiscard,
          currentTurnId, phase, sortingReadyIds, hasDrawnThisTurn } = usState;
  const isMyTurn   = currentTurnId === usMyId;
  const partnerObj = usPlayerOrder.find(p => p.id !== usMyId);
  const myObj      = usPlayerOrder.find(p => p.id === usMyId);

  // Hand section (sorting) vs draw pile in dock (playing)
  const handSection      = document.getElementById('us-hand-section');
  const pileArea         = document.getElementById('us-hand-pile-area');
  const sortHintEl       = document.getElementById('us-sort-hint');
  const sortReadyBtnEl   = document.getElementById('us-sort-ready-btn');
  const partnerReadyText = document.getElementById('us-partner-ready-text');
  if (phase === 'sorting') {
    handSection.classList.remove('hidden');
    pileArea.classList.add('hidden');
    document.getElementById('us-hand-count').textContent = myHand.length;
    sortHintEl.classList.remove('hidden');
    sortReadyBtnEl.classList.remove('hidden');
    sortReadyBtnEl.disabled = (sortingReadyIds ?? []).includes(usMyId);
    const partnerReady = (sortingReadyIds ?? []).some(id => id !== usMyId);
    partnerReadyText.classList.toggle('hidden', !partnerReady);
    renderUSSortingHand();
  } else {
    handSection.classList.add('hidden');
    pileArea.classList.remove('hidden');
    document.getElementById('us-hand-pile-count').textContent = myHand.length;
    const pileDisplay = document.getElementById('us-hand-pile');
    if (myHand.length > 0) {
      const n   = Math.min(myHand.length, 3);
      const sel = usSelected?.type === 'hand' ? ' selected' : '';
      pileDisplay.innerHTML = `<div class="us-hand-pile-wrap${sel}">${
        Array.from({length: n}, (_, i) => {
          const off = (n - 1 - i) * 3;
          return `<div class="us-hand-pile-card" style="left:${off}px;top:${off}px;z-index:${i}"></div>`;
        }).join('')
      }</div>`;
      const pileWrap = pileDisplay.querySelector('.us-hand-pile-wrap');
      if (hasDrawnThisTurn) pileWrap.classList.add('drawn-this-turn');
      pileWrap.addEventListener('click', () => {
        if (!isMyTurn || phase !== 'playing' || hasDrawnThisTurn) return;
        socket.emit('us:draw-to-discard', { code: currentRoom });
      });
    } else {
      pileDisplay.innerHTML = '<div class="us-col-empty" style="width:52px;height:74px"></div>';
    }
  }

  // Foundations
  const foundationOrder = ['hearts', 'diamonds', 'clubs', 'spades'];
  const foundEl = document.getElementById('us-foundations');
  foundEl.innerHTML = foundationOrder.map(suit => {
    const pile  = foundations[suit] ?? [];
    const top   = pile.at(-1);
    const sym   = SUIT_SYMBOLS_US[suit];
    const isSel = usSelected?.type === 'foundation' && usSelected.suit === suit;
    const inner = top ? usCardHtml(top, isSel ? 'selected' : '', 'draggable="true"') : `<span>${sym}</span>`;
    return `<div class="us-foundation-slot${top ? ' has-card' : ''}" data-suit="${suit}">${inner}</div>`;
  }).join('');

  // Tableau
  const CARD_OVERLAP = 28;
  const selCol      = usSelected?.type === 'tableau' ? usSelected.colIndex  : -1;
  const selCardIdx  = usSelected?.type === 'tableau' ? usSelected.cardIndex : -1;
  let stackBottom = null;
  if (usSelected?.type === 'tableau')    stackBottom = tableau[selCol]?.[selCardIdx] ?? null;
  else if (usSelected?.type === 'foundation') stackBottom = foundations[usSelected.suit]?.at(-1) ?? null;
  else if (usSelected?.type === 'discard')    stackBottom = myDiscard?.at(-1) ?? null;
  else if (usSelected?.type === 'hand')       stackBottom = myHand?.[0] ?? null;

  const tableauEl = document.getElementById('us-tableau');
  tableauEl.innerHTML = tableau.map((col, colIdx) => {
    const colTop         = col.length > 0 ? col.at(-1) : null;
    const isDropTarget   = stackBottom !== null
                           && (usSelected?.type !== 'tableau' || colIdx !== selCol)
                           && canStackOnTableau(stackBottom, colTop);
    const totalHeight    = col.length === 0 ? 74 : 74 + (col.length - 1) * CARD_OVERLAP;

    const cards = col.map((card, cardIdx) => {
      const top       = cardIdx * CARD_OVERLAP;
      const inStack   = selCol === colIdx && cardIdx >= selCardIdx && selCardIdx >= 0;
      const isDropTop = isDropTarget && cardIdx === col.length - 1;
      const extraCls  = inStack ? ' selected' : isDropTop ? ' drop-valid' : '';
      if (card.faceUp) {
        const sym   = SUIT_SYMBOLS_US[card.suit];
        const color = RED_SUITS_US.has(card.suit) ? 'red' : 'black';
        return `<div class="us-col-card face-up ${color}${extraCls}"
                     draggable="true"
                     style="top:${top}px"
                     data-col="${colIdx}" data-card="${cardIdx}">
          <span class="us-card-tl">${card.rank}<br>${sym}</span>
          <span class="us-card-suit">${sym}</span>
        </div>`;
      } else {
        return `<div class="us-col-card face-down" style="top:${top}px"
                     data-col="${colIdx}" data-card="${cardIdx}">
          <div class="us-card-back"></div>
        </div>`;
      }
    }).join('');

    const emptySlot = `<div class="us-col-empty${isDropTarget ? ' droppable' : ''}" data-col="${colIdx}"></div>`;
    return `<div class="us-column" data-col="${colIdx}">
      <div class="us-column-cards" style="height:${totalHeight}px">
        ${col.length === 0 ? emptySlot : cards}
      </div>
    </div>`;
  }).join('');

  // My dock
  const myDockLabel = document.getElementById('us-dock-mine-label');
  myDockLabel.textContent = myObj ? escapeHtml(myObj.name) + ' (You)' : 'You';
  myDockLabel.className = 'us-dock-label' + (isMyTurn ? ' my-turn' : '');
  document.getElementById('us-dock-mine').classList.toggle('active-turn', isMyTurn);

  document.getElementById('us-discard-count').textContent = myDiscard.length;
  const myDiscardDisplay = document.getElementById('us-my-discard');
  if (myDiscard.length > 0) {
    myDiscardDisplay.innerHTML = usCardHtml(myDiscard.at(-1), usSelected?.type === 'discard' ? 'selected' : '', 'draggable="true"');
  } else {
    myDiscardDisplay.innerHTML = '<div class="us-col-empty"></div>';
  }

  document.getElementById('us-end-turn-btn').classList.toggle('hidden', !isMyTurn || phase !== 'playing');

  // Partner dock
  const partnerDockLabel = document.getElementById('us-dock-partner-label');
  partnerDockLabel.textContent = partnerObj ? escapeHtml(partnerObj.name) : 'Partner';
  partnerDockLabel.className = 'us-dock-label' + (!isMyTurn && phase === 'playing' ? ' my-turn' : '');

  document.getElementById('us-partner-hand-count').textContent = partnerHandSize;
  const partnerHandDisplay = document.getElementById('us-partner-hand-display');
  if (partnerHandSize > 0) {
    partnerHandDisplay.innerHTML = usFaceDownHtml();
  } else {
    partnerHandDisplay.innerHTML = '<div class="us-col-empty"></div>';
  }

  document.getElementById('us-partner-discard-count').textContent = partnerDiscard.length;
  const partnerDiscardDisplay = document.getElementById('us-partner-discard');
  if (partnerDiscard.length > 0) {
    partnerDiscardDisplay.innerHTML = usCardHtml(partnerDiscard.at(-1));
  } else {
    partnerDiscardDisplay.innerHTML = '<div class="us-col-empty"></div>';
  }
}

// ── Sorting-hand drag-and-drop ─────────────────────────────────────────────────
let usDragSrcIdx = null;

function renderUSSortingHand() {
  if (!usState) return;
  const container = document.getElementById('us-hand-row');
  const hand = usOriginalHand;

  container.innerHTML = usSortOrder.map((srcIdx, pos) => {
    const card  = hand[srcIdx];
    const sym   = SUIT_SYMBOLS_US[card.suit];
    const color = RED_SUITS_US.has(card.suit) ? 'red' : 'black';
    return `<div class="us-sorting-card ${color}" draggable="true" data-pos="${pos}">
      <span class="us-card-tl">${card.rank}<br>${sym}</span>
      <span class="us-card-suit">${sym}</span>
    </div>`;
  }).join('');

  let insertPos = null;

  function getInsertPos(e) {
    const cards = [...container.querySelectorAll('.us-sorting-card')];
    if (cards.length === 0) return 0;
    // Group into rows by similar top value
    const rows = [];
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      const row = rows.find(ro => Math.abs(ro.top - r.top) < 5);
      if (row) { row.cards.push(card); row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ top: r.top, bottom: r.bottom, cards: [card] });
    }
    // Find the row the cursor is on or nearest to
    let bestRow = rows[0], bestDist = Infinity;
    for (const row of rows) {
      const d = Math.max(0, row.top - e.clientY, e.clientY - row.bottom);
      if (d < bestDist) { bestDist = d; bestRow = row; }
    }
    // Horizontal insertion within that row
    const firstIdx = cards.indexOf(bestRow.cards[0]);
    for (let i = 0; i < bestRow.cards.length; i++) {
      const r = bestRow.cards[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) return firstIdx + i;
    }
    return cards.indexOf(bestRow.cards[bestRow.cards.length - 1]) + 1;
  }

  function showIndicator(pos) {
    if (pos === insertPos) return;
    insertPos = pos;
    let ind = container.querySelector('.us-drop-indicator');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'us-drop-indicator';
      container.appendChild(ind);
    }
    const cards = [...container.querySelectorAll('.us-sorting-card')];
    const cRect = container.getBoundingClientRect();
    let x, r;
    if (pos < cards.length) {
      r = cards[pos].getBoundingClientRect();
      x = r.left - cRect.left - 2;
    } else if (cards.length > 0) {
      r = cards[cards.length - 1].getBoundingClientRect();
      x = r.right - cRect.left + 2;
    } else {
      ind.style.cssText = 'left:4px;top:0;height:70px';
      return;
    }
    ind.style.left   = x + 'px';
    ind.style.top    = (r.top - cRect.top) + 'px';
    ind.style.height = r.height + 'px';
  }

  function hideIndicator() {
    container.querySelector('.us-drop-indicator')?.remove();
    insertPos = null;
  }

  container.querySelectorAll('.us-sorting-card').forEach(el => {
    el.addEventListener('dragstart', e => {
      usDragSrcIdx = parseInt(el.dataset.pos, 10);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      hideIndicator();
    });
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    showIndicator(getInsertPos(e));
  });

  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) hideIndicator();
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    const at = insertPos ?? getInsertPos(e);
    hideIndicator();
    if (usDragSrcIdx === null) return;
    const newOrder = [...usSortOrder];
    const [moved] = newOrder.splice(usDragSrcIdx, 1);
    newOrder.splice(at > usDragSrcIdx ? at - 1 : at, 0, moved);
    usSortOrder = newOrder;
    usDragSrcIdx = null;
    renderUSSortingHand();
  });
}

// ── Routing helper: dispatch whatever is selected to a target ─────────────────
function usDispatch(targetType, targetIndex) {
  if (!usSelected) return;
  if (usSelected.type === 'tableau') {
    socket.emit('us:tableau-move', {
      code: currentRoom,
      fromCol: usSelected.colIndex, cardIndex: usSelected.cardIndex,
      toCol: targetIndex,
    });
  } else if (usSelected.type === 'foundation') {
    socket.emit('us:foundation-to-tableau', {
      code: currentRoom, suit: usSelected.suit, toCol: targetIndex,
    });
  } else {
    socket.emit('us:play', {
      code: currentRoom,
      source: usSelected.type,   // 'hand' | 'discard'
      targetType, targetIndex,
    });
  }
  usSelected = null;
  renderUSBoard();
}

// ── Tableau click ─────────────────────────────────────────────────────────────
document.getElementById('us-tableau').addEventListener('click', e => {
  if (!usState || usState.phase !== 'playing') return;
  if (usDragSrc) return; // ignore clicks that end a drag
  const cardEl = e.target.closest('.us-col-card[data-col]');
  const colEl  = e.target.closest('[data-col]');
  if (!colEl) return;
  const colIdx  = parseInt(colEl.dataset.col, 10);
  const cardIdx = cardEl ? parseInt(cardEl.dataset.card, 10) : -1;

  if (cardEl && usState.tableau[colIdx]?.[cardIdx]?.faceUp) {
    if (usSelected?.type === 'tableau') {
      // Clicking a face-up card while a tableau card is selected: switch selection
      // (same card = deselect)
      if (usSelected.colIndex === colIdx && usSelected.cardIndex === cardIdx) {
        usSelected = null;
      } else {
        usSelected = { type: 'tableau', colIndex: colIdx, cardIndex: cardIdx };
      }
    } else if (usSelected) {
      // Hand or discard is selected — dispatch to this column
      usDispatch('tableau', colIdx);
      return;
    } else {
      usSelected = { type: 'tableau', colIndex: colIdx, cardIndex: cardIdx };
    }
    renderUSBoard();
    return;
  }

  // Clicked face-down card, empty slot, or column background
  if (usSelected) usDispatch('tableau', colIdx);
});

// ── Tableau drag-and-drop ─────────────────────────────────────────────────────
document.getElementById('us-tableau').addEventListener('dragstart', e => {
  if (!usState || usState.phase !== 'playing') return;
  const cardEl = e.target.closest('.us-col-card[data-col]');
  if (!cardEl || !cardEl.classList.contains('face-up')) return;
  const colIdx  = parseInt(cardEl.dataset.col, 10);
  const cardIdx = parseInt(cardEl.dataset.card, 10);
  usDragSrc = { colIdx, cardIdx };
  e.dataTransfer.effectAllowed = 'move';
  // Dim the whole sub-stack being lifted
  document.querySelectorAll(`.us-col-card[data-col="${colIdx}"]`).forEach(c => {
    if (parseInt(c.dataset.card, 10) >= cardIdx) c.classList.add('dragging-stack');
  });
});

document.getElementById('us-tableau').addEventListener('dragend', () => {
  usDragSrc = null;
  document.querySelectorAll('.dragging-stack').forEach(c => c.classList.remove('dragging-stack'));
  document.querySelectorAll('.col-drag-over').forEach(c => c.classList.remove('col-drag-over'));
  document.querySelectorAll('.foundation-drag-over').forEach(c => c.classList.remove('foundation-drag-over'));
});

document.getElementById('us-tableau').addEventListener('dragover', e => {
  if (!usDragSrc || !usState) return;
  const colEl = e.target.closest('.us-column[data-col]');
  if (!colEl) return;
  const toCol = parseInt(colEl.dataset.col, 10);

  let dragCard = null;
  if (usDragSrc.type === 'discard') {
    dragCard = usState.myDiscard?.at(-1) ?? null;
  } else if (usDragSrc.type === 'foundation') {
    dragCard = usState.foundations[usDragSrc.suit]?.at(-1) ?? null;
  } else {
    if (toCol === usDragSrc.colIdx) return;
    dragCard = usState.tableau[usDragSrc.colIdx]?.[usDragSrc.cardIdx] ?? null;
  }
  if (!dragCard) return;

  if (canStackOnTableau(dragCard, usState.tableau[toCol]?.at(-1) ?? null)) {
    e.preventDefault();
    document.querySelectorAll('.col-drag-over').forEach(c => {
      if (c !== colEl) c.classList.remove('col-drag-over');
    });
    colEl.classList.add('col-drag-over');
  }
});

document.getElementById('us-tableau').addEventListener('dragleave', e => {
  const colEl = e.target.closest('.us-column[data-col]');
  if (colEl && !colEl.contains(e.relatedTarget)) colEl.classList.remove('col-drag-over');
});

document.getElementById('us-tableau').addEventListener('drop', e => {
  e.preventDefault();
  const colEl = e.target.closest('.us-column[data-col]');
  if (!colEl || !usDragSrc) return;
  colEl.classList.remove('col-drag-over');
  const toCol = parseInt(colEl.dataset.col, 10);
  if (usDragSrc.type === 'discard') {
    usDragSrc = null;
    socket.emit('us:play', { code: currentRoom, source: 'discard', targetType: 'tableau', targetIndex: toCol });
  } else if (usDragSrc.type === 'foundation') {
    const { suit } = usDragSrc;
    usDragSrc = null;
    socket.emit('us:foundation-to-tableau', { code: currentRoom, suit, toCol });
  } else {
    const { colIdx: fromCol, cardIdx } = usDragSrc;
    usDragSrc = null;
    if (toCol === fromCol) return;
    socket.emit('us:tableau-move', { code: currentRoom, fromCol, cardIndex: cardIdx, toCol });
  }
});

// ── Foundation click: select from foundation or place onto it ─────────────────
document.getElementById('us-foundations').addEventListener('click', e => {
  if (!usState || usState.phase !== 'playing') return;
  const slot = e.target.closest('.us-foundation-slot');
  if (!slot) return;
  const suit = slot.dataset.suit;
  if (usSelected?.type === 'foundation') {
    usSelected = usSelected.suit === suit ? null : { type: 'foundation', suit };
    renderUSBoard();
  } else if (usSelected) {
    usDispatch('foundation', suit);
  } else if ((usState.foundations[suit]?.length ?? 0) > 0) {
    usSelected = { type: 'foundation', suit };
    renderUSBoard();
  }
});

// ── Foundation drag-and-drop ──────────────────────────────────────────────────
function getDragCard() {
  if (!usDragSrc || !usState) return null;
  if (usDragSrc.type === 'discard')    return usState.myDiscard?.at(-1) ?? null;
  if (usDragSrc.type === 'foundation') return usState.foundations[usDragSrc.suit]?.at(-1) ?? null;
  // Tableau: only the top card of the column can go to foundation
  const col = usState.tableau[usDragSrc.colIdx];
  if (usDragSrc.cardIdx !== (col?.length ?? 0) - 1) return null;
  return col?.[usDragSrc.cardIdx] ?? null;
}

document.getElementById('us-foundations').addEventListener('dragstart', e => {
  if (!usState || usState.phase !== 'playing') return;
  const slot = e.target.closest('.us-foundation-slot');
  if (!slot) return;
  const suit = slot.dataset.suit;
  if (!usState.foundations[suit]?.length) return;
  usDragSrc = { type: 'foundation', suit };
  e.dataTransfer.effectAllowed = 'move';
});

document.getElementById('us-foundations').addEventListener('dragend', () => {
  if (usDragSrc?.type === 'foundation') usDragSrc = null;
  document.querySelectorAll('.col-drag-over').forEach(c => c.classList.remove('col-drag-over'));
  document.querySelectorAll('.foundation-drag-over').forEach(s => s.classList.remove('foundation-drag-over'));
});

document.getElementById('us-foundations').addEventListener('dragover', e => {
  if (usDragSrc?.type === 'foundation') return; // can't drag foundation onto itself
  const card = getDragCard();
  if (!card) return;
  if (canPlaceOnFoundation(card, usState.foundations[card.suit])) {
    e.preventDefault();
    // Highlight all slots — any slot accepts; we auto-route by suit on drop
    document.querySelectorAll('.us-foundation-slot').forEach(s => s.classList.add('foundation-drag-over'));
  }
});

document.getElementById('us-foundations').addEventListener('dragleave', e => {
  if (!document.getElementById('us-foundations').contains(e.relatedTarget)) {
    document.querySelectorAll('.foundation-drag-over').forEach(s => s.classList.remove('foundation-drag-over'));
  }
});

document.getElementById('us-foundations').addEventListener('drop', e => {
  e.preventDefault();
  document.querySelectorAll('.foundation-drag-over').forEach(s => s.classList.remove('foundation-drag-over'));
  const card = getDragCard();
  if (!card || !usDragSrc) return;
  if (usDragSrc.type === 'discard') {
    usDragSrc = null;
    socket.emit('us:play', { code: currentRoom, source: 'discard', targetType: 'foundation', targetIndex: card.suit });
  } else {
    const fromCol = usDragSrc.colIdx;
    usDragSrc = null;
    socket.emit('us:tableau-to-foundation', { code: currentRoom, fromCol });
  }
});

// ── Discard drag ──────────────────────────────────────────────────────────────
document.getElementById('us-my-discard').addEventListener('dragstart', e => {
  if (!usState || usState.phase !== 'playing') return;
  if (!usState.myDiscard?.length) return;
  usDragSrc = { type: 'discard' };
  e.dataTransfer.effectAllowed = 'move';
});

document.getElementById('us-my-discard').addEventListener('dragend', () => {
  usDragSrc = null;
  document.querySelectorAll('.col-drag-over').forEach(c => c.classList.remove('col-drag-over'));
  document.querySelectorAll('.foundation-drag-over').forEach(s => s.classList.remove('foundation-drag-over'));
});

// ── Discard card click: select it ─────────────────────────────────────────────
document.getElementById('us-my-discard').addEventListener('click', () => {
  if (!usState || usState.phase !== 'playing') return;
  if (usState.myDiscard.length === 0) return;
  usSelected = usSelected?.type === 'discard' ? null : { type: 'discard' };
  renderUSBoard();
});

// ── End Turn button ────────────────────────────────────────────────────────────
document.getElementById('us-end-turn-btn').addEventListener('click', () => {
  if (!usState || usState.currentTurnId !== usMyId) return;
  usSelected = null;
  socket.emit('us:end-turn', { code: currentRoom });
});

// ── Utility ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
