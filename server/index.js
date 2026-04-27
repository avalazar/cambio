const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createCambioState, getPlayerView, getCardAction } = require('./cambio');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
    hands[id] = state.hands[id].map(slot => ({ ...slot.card }));
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

    if (mySlot >= 0 && mySlot < state.hands[socket.id].length) {
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

    const discardValue = state.discardPile.at(-1).value;
    const slot = myHand[slotIndex];

    if (slot.card.value === discardValue) {
      state.discardPile.push(slot.card);
      myHand.splice(slotIndex, 1);
      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      const sizes = buildHandSizes(state);
      io.to(code).emit('match:success', {
        playerId: socket.id, targetId: null,
        discardTop: { ...state.discardPile.at(-1) },
        drawPileCount: state.deck.length, opponentHandSizes: sizes,
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

    const discardValue = state.discardPile.at(-1).value;
    const targetCard   = targetHand[targetSlot].card;

    if (targetCard.value === discardValue) {
      // Discard the opponent's matched card.
      state.discardPile.push(targetCard);
      targetHand.splice(targetSlot, 1);
      // Give one of the player's cards to the opponent (neither player knows it).
      const givenCard = myHand.splice(mySlot, 1)[0];
      targetHand.push({ card: givenCard.card, knownTo: new Set() });

      socket.emit('hand:update', { hand: getPlayerView(state, socket.id).hand });
      io.to(targetId).emit('hand:update', { hand: getPlayerView(state, targetId).hand });
      const sizes = buildHandSizes(state);
      io.to(code).emit('match:success', {
        playerId: socket.id, targetId,
        discardTop: { ...state.discardPile.at(-1) },
        drawPileCount: state.deck.length, opponentHandSizes: sizes,
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
      });
      console.log(`[match:fail]  ${code} — ${room.players.get(socket.id)?.name} failed opponent-match (penalty)`);
    }
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
