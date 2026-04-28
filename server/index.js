const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createCambioState, getPlayerView, getCardAction } = require('./cambio');
const { createUnSolitaireState, getUnSolitaireView, canStackOnTableau, canPlaceOnFoundation, cloneUSState } = require('./unsolitaire');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// rooms: Map<roomCode, { code, hostId, players: Map<socketId, {id, name}>, game, phase }>
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getOpenRooms() {
  return [...rooms.values()]
    .filter(r => r.phase === 'lobby')
    .map(r => ({ code: r.code, game: r.game, playerCount: r.players.size, maxPlayers: 4 }));
}

function broadcastRoomList() {
  io.to('global').emit('rooms:list', getOpenRooms());
}

// Advance the turn index. Returns the next player's ID, or 'resolve' if the game ends.
// count: if true and phase is 'final-round', decrements finalRoundRemaining.
function doAdvanceTurn(state, count = true) {
  if (count && state.phase === 'final-round') {
    state.finalRoundRemaining--;
    if (state.finalRoundRemaining <= 0) return 'resolve';
  }
  // Advance, skipping the Cambio caller during the final round.
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.playerOrder.length;
  } while (state.phase === 'final-round' && state.playerOrder[state.currentTurnIndex] === state.cambioCallerId);
  return state.playerOrder[state.currentTurnIndex];
}

function triggerResolution(room, code) {
  const state = room.cambioState;
  state.phase = 'resolution';

  const hands = {}, scores = {};
  for (const id of state.playerOrder) {
    hands[id] = state.hands[id].filter(s => !s.empty).map(slot => ({ ...slot.card }));
    scores[id] = hands[id].reduce((sum, c) => sum + c.value, 0);
  }

  let winnerId = state.playerOrder.reduce((best, id) => scores[id] < scores[best] ? id : best);
  const callerPenalty = (state.cambioCallerId && state.cambioCallerId !== winnerId) ? 15 : 0;
  if (callerPenalty > 0) {
    scores[state.cambioCallerId] += callerPenalty;
    winnerId = state.playerOrder.reduce((best, id) => scores[id] < scores[best] ? id : best);
  }

  const playerList = state.playerOrder.map(id => ({ id, name: room.players.get(id)?.name ?? id }));
  io.to(code).emit('game:over', { hands, scores, playerOrder: playerList, cambioCallerId: state.cambioCallerId, callerPenalty, winnerId });
  console.log(`[game:over]   ${code} — winner: ${room.players.get(winnerId)?.name} (${scores[winnerId]} pts)`);
}

// Clear pending action/drawn card, advance turn, emit turn:advance or trigger resolution.
function finishTurn(state, room, code, count = true) {
  state.pendingAction = null;
  state.drawnCard = null;
  const nextId = doAdvanceTurn(state, count);
  if (nextId === 'resolve') { triggerResolution(room, code); return; }
  io.to(code).emit('turn:advance', {
    discardTop: { ...state.discardPile.at(-1) },
    currentTurnId: nextId,
    drawPileCount: state.deck.length,
  });
}

function buildHandSizes(state) {
  return Object.fromEntries(state.playerOrder.map(id => [id, state.hands[id].length]));
}

// Kings of opposite colors have different point values but match each other (§3.5).
function matchKey(card) {
  return card.rank === 'K' ? 'K' : card.value;
}

io.on('connection', (socket) => {
  console.log(`[connect]    ${socket.id}`);
  socket.join('global');

  // ── Room list ──────────────────────────────────────────────────────────────────
  socket.on('rooms:get', () => { socket.emit('rooms:list', getOpenRooms()); });

  // ── Create room ────────────────────────────────────────────────────────────────
  socket.on('room:create', ({ name }) => {
    const trimmedName = (name || '').trim().slice(0, 20) || 'Host';
    const code = generateRoomCode();
    const room = {
      code, hostId: socket.id,
      players: new Map([[socket.id, { id: socket.id, name: trimmedName }]]),
      game: 'cambio', phase: 'lobby',
    };
    rooms.set(code, room);
    socket.leave('global');
    socket.join(code);
    console.log(`[room:create] ${code} by ${trimmedName}`);
    socket.emit('room:created', { code, playerId: socket.id, name: trimmedName });
    emitRoomUpdate(code);
    broadcastRoomList();
  });

  // ── Join room ──────────────────────────────────────────────────────────────────
  socket.on('room:join', ({ code, name }) => {
    const upperCode = (code || '').toUpperCase().trim();
    const room = rooms.get(upperCode);
    if (!room) { socket.emit('room:error', { message: `Room "${upperCode}" not found.` }); return; }
    if (room.phase !== 'lobby') { socket.emit('room:error', { message: 'That game has already started.' }); return; }
    if (room.players.size >= 4) { socket.emit('room:error', { message: 'Room is full.' }); return; }
    const trimmedName = (name || '').trim().slice(0, 20) || `Player ${room.players.size + 1}`;
    room.players.set(socket.id, { id: socket.id, name: trimmedName });
    socket.leave('global');
    socket.join(upperCode);
    console.log(`[room:join]   ${upperCode} ← ${trimmedName}`);
    socket.emit('room:joined', { code: upperCode, playerId: socket.id, name: trimmedName });
    emitRoomUpdate(upperCode);
    broadcastRoomList();
  });

  // ── Game selection (host only) ─────────────────────────────────────────────────
  socket.on('room:selectGame', ({ code, game }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    if (!['cambio', 'un-solitaire'].includes(game)) return;
    room.game = game;
    emitRoomUpdate(code);
    broadcastRoomList();
  });

  // ── Start game (host only) ─────────────────────────────────────────────────────
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
      for (const socketId of playerOrder) {
        const view = getPlayerView(room.cambioState, socketId);
        io.to(socketId).emit('game:started', { game: 'cambio', playerOrder: playerList, myIndex: playerOrder.indexOf(socketId), ...view });
      }
      console.log(`[game:start]  ${code} — cambio (${room.players.size}p, ${room.cambioState.deck.length} cards left)`);
    } else if (room.game === 'un-solitaire') {
      if (room.players.size !== 2) return; // requires exactly 2 players
      const playerIds = [...room.players.keys()];
      room.usState = createUnSolitaireState(playerIds);
      const { playerOrder } = room.usState;
      const playerList = playerOrder.map(id => ({ id, name: room.players.get(id).name }));
      for (const socketId of playerOrder) {
        const view = getUnSolitaireView(room.usState, socketId);
        io.to(socketId).emit('game:started', { game: 'un-solitaire', playerOrder: playerList, myId: socketId, ...view });
      }
      console.log(`[game:start]  ${code} — un-solitaire`);
    } else {
      io.to(code).emit('game:started', { game: room.game, players: [...room.players.values()] });
      console.log(`[game:start]  ${code} — ${room.game}`);
    }
    broadcastRoomList();
  });

  // ── Peek phase ready ───────────────────────────────────────────────────────────
  socket.on('playerReady', ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.cambioState) return;
    if (!room.players.has(socket.id)) return;
    const state = room.cambioState;
    if (state.phase !== 'peek') return;
    // peekReady is a Set — duplicate adds are idempotent.
    state.peekReady.add(socket.id);
    const readyCount = state.peekReady.size;
    const totalCount = state.playerOrder.length;
    console.log(`[peek:ready]  ${code} — ${readyCount}/${totalCount} players ready`);
    if (readyCount === totalCount) {
      state.phase = 'playing';
      const firstPlayerId = state.playerOrder[state.currentTurnIndex];
      io.to(code).emit('beginTurns', { currentTurnId: firstPlayerId });
      console.log(`[peek:done]   ${code} — turns begin, ${room.players.get(firstPlayerId)?.name} goes first`);
    }
  });

  // ── Draw from deck ─────────────────────────────────────────────────────────────
  socket.on('deck:draw', ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.cambioState) return;
    const state = room.cambioState;
    if (!['playing', 'final-round'].includes(state.phase)) return;
    if (state.playerOrder[state.currentTurnIndex] !== socket.id) return;
    if (state.drawnCard) return;
    if (state.deck.length === 0) return;
    const card = state.deck.pop();
    state.drawnCard = { card, drawnBy: socket.id };
    socket.emit('card:drawn', { card });
    io.to(code).emit('deck:update', { drawPileCount: state.deck.length });
    console.log(`[deck:draw]   ${code} — ${room.players.get(socket.id)?.name} drew`);
  });

  // ── Discard drawn card (may trigger action) ────────────────────────────────────
  socket.on('draw:discard', ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.cambioState) return;
    const state = room.cambioState;
    if (!state.drawnCard || state.drawnCard.drawnBy !== socket.id) return;

    const { card } = state.drawnCard;
    state.drawnCard = null;
    state.discardPile.push(card);

    const action = getCardAction(card.rank, card.suit);
    if (action) {
      state.pendingAction = { type: action, actingPlayerId: socket.id, lookSwapData: null };
      io.to(code).emit('action:required', {
        type: action, actingPlayerId: socket.id,
        discardTop: { ...state.discardPile.at(-1) }, drawPileCount: state.deck.length,
      });
      console.log(`[action]      ${code} — ${room.players.get(socket.id)?.name} triggered ${action}`);
      return;
    }
    console.log(`[draw:discard] ${code} — ${room.players.get(socket.id)?.name} discarded`);
    finishTurn(state, room, code);
  });

  // ── Swap drawn card with hand slot ─────────────────────────────────────────────
  socket.on('draw:swap', ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || !room.cambioState) return;
    const state = room.cambioState;
    if (!state.drawnCard || state.drawnCard.drawnBy !== socket.id) return;
    if (slotIndex < 0 || slotIndex >= state.hands[socket.id].length) return;
    if (state.hands[socket.id][slotIndex].empty) return;

    const drawnCard    = state.drawnCard.card;
    const replacedCard = state.hands[socket.id][slotIndex].card;
    // Player drew the card face-up, so they know its value after swapping it in.
    state.hands[socket.id][slotIndex] = { card: drawnCard, knownTo: new Set([socket.id]) };
    state.drawnCard = null;
    state.discardPile.push(replacedCard);

    socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
    // Broadcast so all players see which slot was swapped.
    io.to(code).emit('action:broadcast', {
      actorId: socket.id,
      type: 'swap',
      targets: [{ playerId: socket.id, slot: slotIndex }],
    });

    // The replaced (discarded) card may trigger an action, just like draw:discard.
    const action = getCardAction(replacedCard.rank, replacedCard.suit);
    if (action) {
      state.pendingAction = { type: action, actingPlayerId: socket.id, lookSwapData: null };
      io.to(code).emit('action:required', {
        type: action, actingPlayerId: socket.id,
        discardTop: { ...state.discardPile.at(-1) }, drawPileCount: state.deck.length,
      });
      console.log(`[draw:swap]   ${code} — ${room.players.get(socket.id)?.name} swapped slot ${slotIndex}, triggers ${action}`);
      return;
    }
    console.log(`[draw:swap]   ${code} — ${room.players.get(socket.id)?.name} swapped slot ${slotIndex}`);
    finishTurn(state, room, code);
  });

  // ── Action: skip ───────────────────────────────────────────────────────────────
  socket.on('action:skip', ({ code }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction || state.pendingAction.actingPlayerId !== socket.id) return;
    if (state.pendingAction.waitingForDone) return; // peek/spy result showing — use action:done
    console.log(`[action:skip] ${code} — ${room.players.get(socket.id)?.name} skipped ${state.pendingAction.type}`);
    finishTurn(state, room, code);
  });

  // ── Action: done viewing peek/spy result ───────────────────────────────────────
  socket.on('action:done', ({ code }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction?.waitingForDone) return;
    if (state.pendingAction.actingPlayerId !== socket.id) return;
    console.log(`[action:done] ${code} — ${room.players.get(socket.id)?.name} done viewing`);
    finishTurn(state, room, code);
  });

  // ── Action: peek (7 or 8) ──────────────────────────────────────────────────────
  socket.on('action:peek', ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction || state.pendingAction.actingPlayerId !== socket.id) return;
    if (state.pendingAction.type !== 'peek') return;
    if (slotIndex < 0 || slotIndex >= state.hands[socket.id].length) return;
    if (state.hands[socket.id][slotIndex].empty) return;

    state.hands[socket.id][slotIndex].knownTo.add(socket.id);
    const card = state.hands[socket.id][slotIndex].card;
    socket.emit('action:peek-result', { card, slotIndex });
    socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
    io.to(code).emit('action:broadcast', {
      actorId: socket.id,
      type: 'peek',
      targets: [{ playerId: socket.id, slot: slotIndex }],
    });
    console.log(`[action:peek] ${code} — ${room.players.get(socket.id)?.name} peeked slot ${slotIndex}`);
    // Turn advances only after the player confirms they've memorised the card.
    state.pendingAction.waitingForDone = true;
  });

  // ── Action: spy (9 or 10) ──────────────────────────────────────────────────────
  socket.on('action:spy', ({ code, targetId, slotIndex }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction || state.pendingAction.actingPlayerId !== socket.id) return;
    if (state.pendingAction.type !== 'spy') return;
    if (!state.hands[targetId] || targetId === socket.id) return;
    if (slotIndex < 0 || slotIndex >= state.hands[targetId].length) return;
    if (state.hands[targetId][slotIndex].empty) return;

    state.hands[targetId][slotIndex].knownTo.add(socket.id);
    const card = state.hands[targetId][slotIndex].card;
    const targetName = room.players.get(targetId)?.name ?? '?';
    socket.emit('action:spy-result', { card, targetId, targetName, slotIndex });
    io.to(code).emit('action:broadcast', {
      actorId: socket.id,
      type: 'spy',
      targets: [{ playerId: targetId, slot: slotIndex }],
    });
    console.log(`[action:spy]  ${code} — ${room.players.get(socket.id)?.name} spied on ${targetName} slot ${slotIndex}`);
    // Turn advances only after the player confirms they've memorised the card.
    state.pendingAction.waitingForDone = true;
  });

  // ── Action: blind swap (J or Q) ────────────────────────────────────────────────
  // card1 and card2 can be any two cards (own+own, own+opponent, opponent+opponent).
  socket.on('action:blind-swap', ({ code, card1, card2 }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction || state.pendingAction.actingPlayerId !== socket.id) return;
    if (state.pendingAction.type !== 'blind-swap') return;

    const { playerId: p1, slot: s1 } = card1;
    const { playerId: p2, slot: s2 } = card2;

    // Both players must exist in this game; the two selections must be different.
    if (!state.hands[p1] || !state.hands[p2]) return;
    if (p1 === p2 && s1 === s2) return;
    if (s1 < 0 || s1 >= state.hands[p1].length) return;
    if (s2 < 0 || s2 >= state.hands[p2].length) return;

    if (state.hands[p1][s1].empty || state.hands[p2][s2].empty) return;
    const cardA = state.hands[p1][s1].card;
    const cardB = state.hands[p2][s2].card;
    // After a blind swap neither player knows what ended up in the swapped slots.
    state.hands[p1][s1] = { card: cardB, knownTo: new Set() };
    state.hands[p2][s2] = { card: cardA, knownTo: new Set() };

    const affectedIds = [...new Set([p1, p2])];
    for (const id of affectedIds) {
      io.to(id).emit('hand:update', { hand: getPlayerView(state, id).hand });
    }
    io.to(code).emit('action:broadcast', {
      actorId: socket.id,
      type: 'blind-swap',
      targets: [{ playerId: p1, slot: s1 }, { playerId: p2, slot: s2 }],
    });
    console.log(`[action:blind-swap] ${code} — ${room.players.get(socket.id)?.name} swapped ${room.players.get(p1)?.name}[${s1}] ↔ ${room.players.get(p2)?.name}[${s2}]`);
    finishTurn(state, room, code);
  });

  // ── Action: look & swap step 1 — peek at target card (Black King) ──────────────
  socket.on('action:look-swap-peek', ({ code, targetId, slotIndex }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction || state.pendingAction.actingPlayerId !== socket.id) return;
    if (state.pendingAction.type !== 'look-swap') return;
    if (!state.hands[targetId] || targetId === socket.id) return;
    if (slotIndex < 0 || slotIndex >= state.hands[targetId].length) return;
    if (state.hands[targetId][slotIndex].empty) return;

    state.hands[targetId][slotIndex].knownTo.add(socket.id);
    const card = state.hands[targetId][slotIndex].card;
    const targetName = room.players.get(targetId)?.name ?? '?';
    state.pendingAction.lookSwapData = { targetId, slotIndex, card };
    socket.emit('action:look-swap-reveal', { card, targetId, targetName, slotIndex });
    io.to(code).emit('action:broadcast', {
      actorId: socket.id,
      type: 'look-swap-peek',
      targets: [{ playerId: targetId, slot: slotIndex }],
    });
    console.log(`[action:look-swap] ${code} — ${room.players.get(socket.id)?.name} looked at ${targetName} slot ${slotIndex}`);
  });

  // ── Action: look & swap step 2 — decide to swap or skip ───────────────────────
  socket.on('action:look-swap-decide', ({ code, mySlot }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!state.pendingAction || state.pendingAction.actingPlayerId !== socket.id) return;
    if (state.pendingAction.type !== 'look-swap' || !state.pendingAction.lookSwapData) return;

    if (mySlot >= 0 && mySlot < state.hands[socket.id].length && !state.hands[socket.id][mySlot].empty) {
      const { targetId, slotIndex: targetSlot, card: theirCard } = state.pendingAction.lookSwapData;
      const myCard = state.hands[socket.id][mySlot].card;
      // Acting player takes the card they looked at — they know its value.
      state.hands[socket.id][mySlot]    = { card: theirCard, knownTo: new Set([socket.id]) };
      // Target receives acting player's card — unknown to them.
      state.hands[targetId][targetSlot] = { card: myCard,    knownTo: new Set() };
      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      io.to(targetId).emit('hand:update', { hand: getPlayerView(state, targetId).hand });
      io.to(code).emit('action:broadcast', {
        actorId: socket.id,
        type: 'look-swap',
        targets: [{ playerId: socket.id, slot: mySlot }, { playerId: targetId, slot: targetSlot }],
      });
      console.log(`[action:look-swap] ${code} — ${room.players.get(socket.id)?.name} swapped slot ${mySlot}`);
    } else {
      console.log(`[action:look-swap] ${code} — ${room.players.get(socket.id)?.name} skipped swap`);
    }
    finishTurn(state, room, code);
  });

  // ── Call Cambio ────────────────────────────────────────────────────────────────
  socket.on('room:cambio', ({ code }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (state.phase !== 'playing') return;
    if (state.playerOrder[state.currentTurnIndex] !== socket.id) return;
    if (state.drawnCard) return; // must call before drawing

    const callerName = room.players.get(socket.id)?.name ?? '?';
    state.cambioCallerId = socket.id;
    state.phase = 'final-round';
    state.finalRoundRemaining = state.playerOrder.length - 1;

    io.to(code).emit('cambio:called', { callerId: socket.id, callerName });
    console.log(`[cambio:call] ${code} — ${callerName} called Cambio`);
    // Advance without counting — the Cambio caller's turn ends but doesn't
    // consume one of the other players' final turns.
    finishTurn(state, room, code, false);
  });

  // ── Undo Cambio ────────────────────────────────────────────────────────────────
  socket.on('cambio:undo', ({ code }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (state.phase !== 'final-round') return;
    if (state.cambioCallerId !== socket.id) return;
    const callerName = room.players.get(socket.id)?.name ?? '?';
    state.phase = 'playing';
    state.cambioCallerId = null;
    state.finalRoundRemaining = 0;
    io.to(code).emit('cambio:undone', { callerId: socket.id, callerName });
    console.log(`[cambio:undo] ${code} — ${callerName} undid Cambio`);
  });

  // ── Match: self (§3.5) ────────────────────────────────────────────────────────
  // The player believes one of their own face-down cards matches the discard top.
  socket.on('match:self', ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!['playing', 'final-round'].includes(state.phase)) return;
    if (!room.players.has(socket.id)) return;
    const myHand = state.hands[socket.id];
    if (!myHand || slotIndex < 0 || slotIndex >= myHand.length) return;

    const discardKey = matchKey(state.discardPile.at(-1));
    const slot = myHand[slotIndex];
    if (slot.empty) return;

    if (matchKey(slot.card) === discardKey) {
      state.discardPile.push(slot.card);
      myHand[slotIndex] = { card: null, knownTo: new Set(), empty: true };
      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      const sizes = buildHandSizes(state);
      const seenUpdates = {
        [socket.id]: state.hands[socket.id].map(s => s.empty ? null : s.knownTo.has(socket.id)),
      };
      io.to(code).emit('match:success', {
        playerId: socket.id, targetId: null,
        discardTop: { ...state.discardPile.at(-1) },
        drawPileCount: state.deck.length, opponentHandSizes: sizes, seenUpdates,
      });
      console.log(`[match:self]  ${code} — ${room.players.get(socket.id)?.name} matched ${slot.card.rank}`);
    } else {
      // Incorrect match — penalty card added face-down.
      if (state.deck.length > 0) {
        myHand.push({ card: state.deck.pop(), knownTo: new Set() });
      }
      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      const sizes = buildHandSizes(state);
      io.to(code).emit('match:penalty', {
        playerId: socket.id, drawPileCount: state.deck.length, opponentHandSizes: sizes,
        seenUpdates: { [socket.id]: state.hands[socket.id].map(s => s.empty ? null : s.knownTo.has(socket.id)) },
      });
      console.log(`[match:fail]  ${code} — ${room.players.get(socket.id)?.name} failed self-match (penalty)`);
    }
  });

  // ── Match: opponent (§3.5) ────────────────────────────────────────────────────
  // The player believes an opponent's face-down card matches the discard top.
  // On success the opponent's card is discarded and the player gives one of their
  // own cards to that opponent in exchange.
  socket.on('match:opponent', ({ code, targetId, targetSlot, mySlot }) => {
    const room = rooms.get(code);
    if (!room?.cambioState) return;
    const state = room.cambioState;
    if (!['playing', 'final-round'].includes(state.phase)) return;
    if (!room.players.has(socket.id)) return;
    if (!state.hands[targetId] || targetId === socket.id) return;
    const targetHand = state.hands[targetId];
    const myHand     = state.hands[socket.id];
    if (targetSlot < 0 || targetSlot >= targetHand.length) return;
    if (mySlot < 0    || mySlot    >= myHand.length)       return;

    const discardKey = matchKey(state.discardPile.at(-1));
    const targetCard = targetHand[targetSlot].card;
    if (targetHand[targetSlot].empty || myHand[mySlot].empty) return;

    if (matchKey(targetCard) === discardKey) {
      // Discard the opponent's matched card; tombstone keeps slot positions stable.
      state.discardPile.push(targetCard);
      targetHand[targetSlot] = { card: null, knownTo: new Set(), empty: true };
      // Give one of the player's cards to the opponent (neither player knows it).
      const givenCard = myHand[mySlot];
      myHand[mySlot] = { card: null, knownTo: new Set(), empty: true };
      targetHand.push({ card: givenCard.card, knownTo: new Set() });

      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      io.to(targetId).emit('hand:update', { hand: getPlayerView(state, targetId).hand });
      const sizes = buildHandSizes(state);
      const seenUpdates = {
        [socket.id]: state.hands[socket.id].map(s => s.empty ? null : s.knownTo.has(socket.id)),
        [targetId]:  state.hands[targetId].map(s => s.empty ? null : s.knownTo.has(targetId)),
      };
      io.to(code).emit('match:success', {
        playerId: socket.id, targetId,
        discardTop: { ...state.discardPile.at(-1) },
        drawPileCount: state.deck.length, opponentHandSizes: sizes, seenUpdates,
      });
      console.log(`[match:opp]   ${code} — ${room.players.get(socket.id)?.name} matched ${room.players.get(targetId)?.name}'s ${targetCard.rank}`);
    } else {
      if (state.deck.length > 0) {
        myHand.push({ card: state.deck.pop(), knownTo: new Set() });
      }
      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      const sizes = buildHandSizes(state);
      io.to(code).emit('match:penalty', {
        playerId: socket.id, drawPileCount: state.deck.length, opponentHandSizes: sizes,
        seenUpdates: { [socket.id]: state.hands[socket.id].map(s => s.empty ? null : s.knownTo.has(socket.id)) },
      });
      console.log(`[match:fail]  ${code} — ${room.players.get(socket.id)?.name} failed opponent-match (penalty)`);
    }
  });

  // ── Restart game (same room, same players, fresh deal) ────────────────────────
  socket.on('room:restart', ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.players.has(socket.id)) return;
    const playerIds = [...room.players.keys()];

    if (room.cambioState) {
      if (room.cambioState.phase !== 'resolution') return;
      room.cambioState = createCambioState(playerIds);
      const { playerOrder } = room.cambioState;
      const playerList = playerOrder.map(id => ({ id, name: room.players.get(id).name }));
      for (const socketId of playerOrder) {
        const view = getPlayerView(room.cambioState, socketId);
        io.to(socketId).emit('game:started', {
          game: 'cambio', playerOrder: playerList,
          myIndex: playerOrder.indexOf(socketId), ...view,
        });
      }
    } else if (room.usState) {
      if (room.usState.phase !== 'resolution') return;
      room.usState = createUnSolitaireState(playerIds);
      const { playerOrder } = room.usState;
      const playerList = playerOrder.map(id => ({ id, name: room.players.get(id).name }));
      for (const socketId of playerOrder) {
        const view = getUnSolitaireView(room.usState, socketId);
        io.to(socketId).emit('game:started', {
          game: 'un-solitaire', playerOrder: playerList, myId: socketId, ...view,
        });
      }
    } else return;

    console.log(`[room:restart] ${code} — restarted by ${room.players.get(socket.id)?.name}`);
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // ── Un-Solitaire events ───────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════════

  function usRoom(code) {
    const room = rooms.get(code);
    if (!room?.usState || !room.players.has(socket.id)) return null;
    return room;
  }

  function pushHistory(state) {
    state.history.push(cloneUSState(state));
    if (state.history.length > 30) state.history.shift();
  }

  function broadcastUS(code) {
    const room = rooms.get(code);
    if (!room?.usState) return;
    for (const socketId of room.usState.playerOrder) {
      io.to(socketId).emit('us:state', getUnSolitaireView(room.usState, socketId));
    }
  }

  // ── Sorting: reorder hand ──────────────────────────────────────────────────────
  socket.on('us:reorder-hand', ({ code, order }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'sorting') return;
    if (state.sortingReady.has(socket.id)) return; // locked in
    const hand = state.playerHands[socket.id];
    if (!Array.isArray(order) || order.length !== hand.length) return;
    const sorted = [...new Set(order)];
    if (sorted.length !== hand.length || sorted.some(i => i < 0 || i >= hand.length)) return;
    state.playerHands[socket.id] = order.map(i => hand[i]);
    socket.emit('us:state', getUnSolitaireView(state, socket.id));
  });

  // ── Sorting: signal ready ──────────────────────────────────────────────────────
  socket.on('us:sort-ready', ({ code }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'sorting') return;
    state.sortingReady.add(socket.id);
    console.log(`[us:sort]     ${code} — ${room.players.get(socket.id)?.name} ready (${state.sortingReady.size}/${state.playerOrder.length})`);
    if (state.sortingReady.size === state.playerOrder.length) {
      state.phase = 'playing';
      console.log(`[us:play]     ${code} — sorting done, playing begins`);
    }
    broadcastUS(code);
  });

  // ── Play: place card from hand or discard onto tableau or foundation ───────────
  socket.on('us:play', ({ code, source, targetType, targetIndex }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;

    const myHand    = state.playerHands[socket.id];
    const myDiscard = state.playerDiscards[socket.id];

    // Hand plays require it to be your turn; discard plays are always allowed.
    let card;
    if (source === 'hand') {
      if (state.playerOrder[state.currentTurnIndex] !== socket.id) return;
      if (myHand.length === 0) return;
      card = myHand[0];
    } else if (source === 'discard') {
      if (myDiscard.length === 0) return;
      card = myDiscard.at(-1);
    } else return;

    if (targetType === 'foundation') {
      const pile = state.foundations[card.suit];
      if (!canPlaceOnFoundation(card, pile)) return;
    } else if (targetType === 'tableau') {
      const col = state.tableau[targetIndex];
      if (col === undefined) return;
      const topCard = col.length > 0 ? col.at(-1) : null;
      if (!canStackOnTableau(card, topCard)) return;
    } else return;

    // All validations passed — snapshot before mutating.
    pushHistory(state);

    if (targetType === 'foundation') {
      state.foundations[card.suit].push(card);
    } else {
      state.tableau[targetIndex].push({ ...card, faceUp: true });
    }

    // Remove from source; advance turn only for hand plays.
    if (source === 'hand') {
      myHand.shift();
      state.drawnThisTurn.delete(socket.id);
      state.currentTurnIndex = (state.currentTurnIndex + 1) % state.playerOrder.length;
    } else {
      myDiscard.pop();
    }

    console.log(`[us:play]     ${code} — ${room.players.get(socket.id)?.name} played ${card.rank}${card.suit[0]} → ${targetType}${targetType === 'tableau' ? targetIndex : ''}`);

    // Check win condition
    const won = Object.values(state.foundations).every(p => p.length === 13);
    if (won) {
      state.phase = 'resolution';
      io.to(code).emit('us:game-over', { result: 'win' });
      return;
    }
    broadcastUS(code);
  });

  // ── Play: discard from hand (can't or don't want to play it) ──────────────────
  socket.on('us:discard-hand', ({ code }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    if (state.playerOrder[state.currentTurnIndex] !== socket.id) return;
    const myHand    = state.playerHands[socket.id];
    const myDiscard = state.playerDiscards[socket.id];
    if (myHand.length === 0) return;
    pushHistory(state);
    const card = myHand.shift();
    myDiscard.push(card);
    state.drawnThisTurn.delete(socket.id);
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.playerOrder.length;
    console.log(`[us:discard]  ${code} — ${room.players.get(socket.id)?.name} discarded ${card.rank}${card.suit[0]}`);
    broadcastUS(code);
  });

  // ── Tableau → Tableau stack move ───────────────────────────────────────────────
  socket.on('us:tableau-move', ({ code, fromCol, cardIndex, toCol }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;

    const src = state.tableau[fromCol];
    const dst = state.tableau[toCol];
    if (!src || !dst) return;
    if (cardIndex < 0 || cardIndex >= src.length) return;
    if (!src[cardIndex].faceUp) return; // can only move face-up cards

    // All cards from cardIndex onward must be face-up (they form the stack)
    const stack = src.slice(cardIndex);
    if (stack.some(c => !c.faceUp)) return;

    // The bottom card of the moving stack must be placeable on dst top
    const dstTop = dst.length > 0 ? dst.at(-1) : null;
    if (!canStackOnTableau(stack[0], dstTop)) return;

    // All validations passed — snapshot before mutating.
    pushHistory(state);

    // Move the stack
    src.splice(cardIndex, stack.length);
    for (const c of stack) dst.push(c);

    // Flip new src top face-up if it exists and isn't already
    if (src.length > 0 && !src.at(-1).faceUp) src.at(-1).faceUp = true;

    console.log(`[us:t-move]   ${code} — ${room.players.get(socket.id)?.name} col${fromCol}[${cardIndex}..] → col${toCol}`);
    broadcastUS(code);
  });

  // ── End turn without playing ──────────────────────────────────────────────────
  socket.on('us:end-turn', ({ code }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    if (state.playerOrder[state.currentTurnIndex] !== socket.id) {
      broadcastUS(code); // re-sync client if stale (e.g. hand-play already advanced turn)
      return;
    }
    pushHistory(state);
    state.drawnThisTurn.delete(socket.id);
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.playerOrder.length;
    console.log(`[us:end-turn] ${code} — ${room.players.get(socket.id)?.name} ended turn`);
    broadcastUS(code);
  });

  // ── Draw top card from hand to discard (no turn advance) ─────────────────────
  socket.on('us:draw-to-discard', ({ code }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    if (state.playerOrder[state.currentTurnIndex] !== socket.id) return;
    if (state.drawnThisTurn.has(socket.id)) return;
    const hand = state.playerHands[socket.id];
    if (hand.length === 0) return;
    pushHistory(state);
    state.drawnThisTurn.add(socket.id);
    state.playerDiscards[socket.id].push(hand.shift());
    console.log(`[us:draw]     ${code} — ${room.players.get(socket.id)?.name} drew to discard`);
    broadcastUS(code);
  });

  // ── Tableau top card → foundation (no turn advance, either player) ────────────
  socket.on('us:tableau-to-foundation', ({ code, fromCol }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    const col = state.tableau[fromCol];
    if (!col || col.length === 0) return;
    const card = col.at(-1);
    if (!card.faceUp) return;
    if (!canPlaceOnFoundation(card, state.foundations[card.suit])) return;
    pushHistory(state);
    col.pop();
    if (col.length > 0 && !col.at(-1).faceUp) col.at(-1).faceUp = true;
    state.foundations[card.suit].push(card);
    console.log(`[us:t-found]  ${code} — col${fromCol} ${card.rank}${card.suit[0]} → foundation`);
    const won = Object.values(state.foundations).every(p => p.length === 13);
    if (won) {
      state.phase = 'resolution';
      io.to(code).emit('us:game-over', { result: 'win' });
      return;
    }
    broadcastUS(code);
  });

  // ── Foundation top card → tableau column (either player, any time) ──────────────
  socket.on('us:foundation-to-tableau', ({ code, suit, toCol }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    const pile = state.foundations[suit];
    if (!pile || pile.length === 0) return;
    const col = state.tableau[toCol];
    if (!col) return;
    const card = pile.at(-1);
    if (!canStackOnTableau(card, col.at(-1) ?? null)) return;
    pushHistory(state);
    pile.pop();
    col.push({ ...card, faceUp: true });
    console.log(`[us:f-tab]    ${code} — ${card.rank}${card.suit[0]} foundation → col${toCol}`);
    broadcastUS(code);
  });

  // ── Undo last move ─────────────────────────────────────────────────────────────
  socket.on('us:undo', ({ code }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    if (state.history.length === 0) return;
    const prev = state.history.pop();
    Object.assign(state, prev);
    console.log(`[us:undo]     ${code} — ${room.players.get(socket.id)?.name} undid a move`);
    broadcastUS(code);
  });

  // ── Give up ────────────────────────────────────────────────────────────────────
  socket.on('us:give-up', ({ code }) => {
    const room = usRoom(code);
    if (!room) return;
    const state = room.usState;
    if (state.phase !== 'playing') return;
    for (const col of state.tableau) for (const card of col) card.faceUp = true;
    state.phase = 'resolution';
    const name = room.players.get(socket.id)?.name ?? '?';
    console.log(`[us:give-up]  ${code} — ${name} gave up`);
    broadcastUS(code);
    io.to(code).emit('us:game-over', { result: 'loss', givenUpBy: socket.id });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────────
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
        if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
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
    code: room.code, hostId: room.hostId,
    players: [...room.players.values()],
    game: room.game, phase: room.phase,
    canStart: room.players.size >= 2,
  });
}

server.listen(PORT, () => { console.log(`Cambio server → http://localhost:${PORT}`); });
