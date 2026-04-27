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

const GAME_LABELS  = { cambio: 'Cambio', 'un-solitaire': 'Un-Solitaire' };
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS    = new Set(['hearts', 'diamonds']);

const ACTION_LABELS = {
  peek:         'Peek',
  spy:          'Spy',
  'blind-swap': 'Blind Swap',
  'look-swap':  'Look & Swap',
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

const backFromCreate   = document.getElementById('back-from-create');
const createForm       = document.getElementById('create-form');
const createNameInput  = document.getElementById('create-name-input');
const createError      = document.getElementById('create-error');

const backFromJoin     = document.getElementById('back-from-join');
const joinNameInput    = document.getElementById('join-name-input');
const roomsList        = document.getElementById('rooms-list');
const joinCodeInput    = document.getElementById('join-code-input');
const joinCodeBtn      = document.getElementById('join-code-btn');
const joinError        = document.getElementById('join-error');

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
let toastTimer = null;

// ── Screen helper ──────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function clearError(el)     { el.textContent = ''; el.classList.add('hidden'); }

function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className   = `toast${type ? ' ' + type : ''}`;
  toastEl.classList.remove('hidden');
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2800);
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

// ── Home navigation ────────────────────────────────────────────────────────────
gotoCreateBtn.addEventListener('click', () => { clearError(createError); showScreen('create-screen'); createNameInput.focus(); });
gotoJoinBtn.addEventListener('click',   () => { clearError(joinError); showScreen('join-screen'); socket.emit('rooms:get'); joinNameInput.focus(); });
backFromCreate.addEventListener('click', () => showScreen('home-screen'));
backFromJoin.addEventListener('click',   () => showScreen('home-screen'));

// ── Create room ────────────────────────────────────────────────────────────────
createForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = createNameInput.value.trim();
  if (!name) { showError(createError, 'Please enter your name.'); return; }
  clearError(createError);
  socket.emit('room:create', { name });
});
socket.on('room:created', ({ code, playerId, name }) => {
  myId = playerId; myName = name; currentRoom = code;
  roomCodeDisplay.textContent = code; showScreen('lobby-screen');
});

// ── Join room ──────────────────────────────────────────────────────────────────
function doJoin(code) {
  const name = joinNameInput.value.trim();
  if (!name) { showError(joinError, 'Please enter your name first.'); return; }
  clearError(joinError); socket.emit('room:join', { name, code });
}
roomsList.addEventListener('click', (e) => { const btn = e.target.closest('.room-join-btn'); if (btn) doJoin(btn.dataset.code); });
joinCodeInput.addEventListener('input', () => { joinCodeInput.value = joinCodeInput.value.toUpperCase(); });
joinCodeBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) { showError(joinError, 'Room code must be 4 letters.'); return; }
  doJoin(code);
});
socket.on('room:joined', ({ code, playerId, name }) => {
  myId = playerId; myName = name; currentRoom = code;
  roomCodeDisplay.textContent = code; showScreen('lobby-screen');
});
socket.on('room:error', ({ message }) => {
  const joinVisible = !document.getElementById('join-screen').classList.contains('hidden');
  showError(joinVisible ? joinError : createError, message);
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
}

// ── Game started ───────────────────────────────────────────────────────────────
socket.on('game:started', (payload) => {
  if (payload.game === 'cambio') {
    cambioState = payload;
    resetGameState();
    cambioBoard.classList.remove('hidden');
    genericGameInfo.classList.add('hidden');
    resolutionOverlay.classList.add('hidden');
    renderCambioBoard();
  } else {
    cambioBoard.classList.add('hidden');
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
    if (cambioState.hand[slotIndex] !== null && !locallyHiddenSlots.has(slotIndex)) return;
    socket.emit('action:peek', { code: currentRoom, slotIndex });
    pendingAction = null; activeActionType = null; activeActionActor = null;
    renderActionPanel(); return;
  }
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-own') {
    pendingAction.data.mySlot = slotIndex;
    pendingAction.step = 'choose-target';
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
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-target') {
    socket.emit('action:blind-swap', { code: currentRoom, mySlot: pendingAction.data.mySlot, targetId, targetSlot: slotIndex });
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
socket.on('match:success', ({ playerId, targetId, discardTop, drawPileCount, opponentHandSizes }) => {
  cambioState.discardTop    = discardTop;
  cambioState.drawPileCount = drawPileCount;
  if (opponentHandSizes) mergeOpponentHandSizes(opponentHandSizes);
  const name = cambioState.playerOrder.find(p => p.id === playerId)?.name ?? '?';
  const msg  = playerId === myId ? 'Match! Card discarded.' : `${escapeHtml(name)} matched a card!`;
  showToast(msg, 'success');
  renderCambioBoard();
});

socket.on('match:penalty', ({ playerId, drawPileCount, opponentHandSizes }) => {
  cambioState.drawPileCount = drawPileCount;
  if (opponentHandSizes) mergeOpponentHandSizes(opponentHandSizes);
  const name = cambioState.playerOrder.find(p => p.id === playerId)?.name ?? '?';
  const msg  = playerId === myId ? 'Wrong match — penalty card added!' : `${escapeHtml(name)} bad match — penalty!`;
  showToast(msg, 'penalty');
  renderCambioBoard();
});

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
  // After peeking, re-hide the card so the player must remember it.
  if (pendingAction?.type === 'peek' && pendingAction.data?.slotIndex != null) {
    locallyHiddenSlots.add(pendingAction.data.slotIndex);
  }
  pendingAction = null; activeActionType = null; activeActionActor = null;
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
socket.on('action:required', ({ type, actingPlayerId, discardTop, drawPileCount }) => {
  cambioState.discardTop = discardTop; cambioState.drawPileCount = drawPileCount;
  activeActionType = type; activeActionActor = actingPlayerId;
  if (actingPlayerId === myId) {
    pendingAction = {
      type, data: {},
      step: type === 'peek' ? 'choose-card' : type === 'spy' ? 'choose-target' : type === 'blind-swap' ? 'choose-own' : 'choose-target',
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
  renderCambioBoard();
});
callCambioBtn.addEventListener('click', () => { socket.emit('room:cambio', { code: currentRoom }); });

// ── Turn progression ───────────────────────────────────────────────────────────
socket.on('turn:advance', ({ discardTop, currentTurnId, drawPileCount }) => {
  cambioState.discardTop = discardTop; cambioState.currentTurnId = currentTurnId; cambioState.drawPileCount = drawPileCount;
  if (pendingAction?.step !== 'showing-result' && pendingAction?.step !== 'showing-reveal') {
    activeActionType = null; activeActionActor = null;
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
playAgainBtn.addEventListener('click', () => { socket.disconnect(); socket.connect(); currentRoom = null; showScreen('home-screen'); });

// ── Back to menu ───────────────────────────────────────────────────────────────
backBtn.addEventListener('click', () => { socket.disconnect(); socket.connect(); currentRoom = null; showScreen('home-screen'); });

// ── Cambio rendering ───────────────────────────────────────────────────────────

function renderCard(card, slotIndex = -1, seen = false, extraClass = '') {
  const slotAttr = slotIndex >= 0 ? ` data-slot="${slotIndex}"` : '';
  if (!card) {
    return `<div class="card face-down${extraClass}"${slotAttr}>
      <div class="card-back-inner"></div>
      ${seen ? '<div class="seen-dot"></div>' : ''}
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

function isMyCardActionTarget(slotIndex) {
  if (!pendingAction) return false;
  if (pendingAction.type === 'peek' && pendingAction.step === 'choose-card') {
    const c = cambioState.hand[slotIndex];
    return !c || locallyHiddenSlots.has(slotIndex);
  }
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-own')       return true;
  if (pendingAction.type === 'look-swap'  && pendingAction.step === 'choose-own-for-swap') return true;
  return false;
}

function isOpponentCardActionTarget(opponentId, slotIndex) {
  if (!pendingAction) return false;
  if (pendingAction.type === 'spy'        && pendingAction.step === 'choose-target') return true;
  if (pendingAction.type === 'blind-swap' && pendingAction.step === 'choose-target') return true;
  if (pendingAction.type === 'look-swap'  && pendingAction.step === 'choose-target') return true;
  return false;
}

function renderMyHand() {
  const { hand, phase } = cambioState;
  document.getElementById('my-hand').innerHTML = hand.map((card, i) => {
    const visible = card && !locallyHiddenSlots.has(i);
    let extra = '';
    if (swapMode && localDrawnCard)             extra = ' swappable';
    else if (matchMode === 'choose-give')        extra = ' match-give';
    else if (matchMode === 'choose-card')        extra = ' match-target';
    else if (isMyCardActionTarget(i))            extra = ' action-target';
    return renderCard(visible ? card : null, i, false, extra);
  }).join('');

  const donePeekingBtn = document.getElementById('done-peeking-btn');
  const peekWaitText   = document.getElementById('peek-wait-text');
  const handLabel      = document.getElementById('hand-label-text');
  const playerNotReady = phase === 'peek' && !locallyHiddenSlots.has(2);
  donePeekingBtn.classList.toggle('hidden', !playerNotReady);
  peekWaitText.classList.toggle('hidden', !(phase === 'peek' && locallyHiddenSlots.has(2)));
  handLabel.textContent = phase === 'peek' && !locallyHiddenSlots.has(2) ? 'Your Cards — bottom row peeked' : 'Your Cards';

  const isMyTurn   = cambioState.currentTurnId === myId;
  const showCambio = phase === 'playing' && isMyTurn && !localDrawnCard && !pendingAction && matchMode === 'off';
  callCambioBtn.classList.toggle('hidden', !showCambio);
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
    case 'blind-swap': actionInstruction.textContent = pendingAction.step === 'choose-own'
        ? 'Choose one of your cards to swap.' : 'Now choose an opponent\'s card to swap with.'; break;
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
    const normSeen   = Array.from({ length: handSize }, (_, i) => seenSlots[i] ?? false);
    // Flip display order for 4-card hands so the opponent's "bottom" row appears at top.
    const order = handSize === 4 ? [2, 3, 0, 1] : Array.from({ length: handSize }, (_, i) => i);
    const cardHtml = order.map(i => {
      let extra = isOpponentCardActionTarget(p.id, i) ? ' action-target' : '';
      if (matchMode === 'choose-card' && !extra) extra = ' match-target';
      return renderCard(null, i, normSeen[i] ?? false, extra);
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

// ── Utility ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
