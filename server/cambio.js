const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED_SUITS = new Set(['hearts', 'diamonds']);

// §3.2 scoring values
function cardValue(rank, suit) {
  if (rank === 'A') return 1;
  const n = Number(rank);
  if (!isNaN(n)) return n;                        // 2-10
  if (rank === 'K') return RED_SUITS.has(suit) ? -1 : 10;
  return 10;                                       // J, Q (all suits)
}

function buildDeck() {
  return SUITS.flatMap(suit =>
    RANKS.map(rank => ({ suit, rank, value: cardValue(rank, suit) }))
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Creates a fresh Cambio game state for the given player IDs (in turn order).
 *
 * Hand slot layout (2×2 grid per §3.1):
 *   slot 0, 1  →  top row    — unknown to everyone at start
 *   slot 2, 3  →  bottom row — initially peeked by the owner (§3.1 "Initial Peek")
 *
 * knownTo tracks which socket IDs have legally seen each slot.
 * getPlayerView() uses this to decide what to send to each client.
 */
function createCambioState(playerIds) {
  const deck = shuffle(buildDeck());

  const hands = Object.fromEntries(playerIds.map(id => [id, []]));

  // Round-robin deal: 4 rounds × N players
  for (let round = 0; round < 4; round++) {
    for (const id of playerIds) {
      const card = deck.pop();
      const isBottomRow = round >= 2;
      hands[id].push({
        card,
        knownTo: new Set(isBottomRow ? [id] : []),
      });
    }
  }

  const discardPile = [deck.pop()];

  return {
    deck,
    hands,            // { socketId: [{ card, knownTo: Set<socketId> }, ...] }
    discardPile,      // top = discardPile.at(-1)
    playerOrder: [...playerIds],
    currentTurnIndex: 0,
    phase: 'peek',    // 'peek' | 'playing' | 'final-round' | 'resolution'

    // Set of socketIds that have clicked "Done Peeking".
    // Populated one-by-one; phase advances to 'playing' once its size === playerOrder.length.
    peekReady: new Set(),

    // Card currently held by the active player after drawing from the deck.
    // Cleared when they discard it or swap it into their hand.
    drawnCard: null,  // { card: {suit,rank,value}, drawnBy: socketId }

    cambioCallerId: null,
    finalRoundRemaining: 0,
  };
}

/**
 * Returns only what socketId is allowed to see.
 * Slots the player hasn't peeked at come back as null — the client
 * renders those as face-down cards without knowing their value.
 *
 * opponentsSeen: for each opponent, a boolean array marking which of
 * their slots that opponent has legally seen. No card values are revealed —
 * just the knowledge map, so the viewer can show a "seen" indicator.
 */
function getPlayerView(state, playerId) {
  const opponentsSeen      = {};
  const opponentHandSizes  = {};
  for (const id of state.playerOrder) {
    if (id === playerId) continue;
    // null = removed/empty slot, true/false = whether owner has seen it
    opponentsSeen[id]     = state.hands[id].map(slot => slot.empty ? null : slot.knownTo.has(id));
    opponentHandSizes[id] = state.hands[id].length;
  }

  return {
    hand: state.hands[playerId].map(slot => {
      if (slot.empty) return { empty: true };
      return slot.knownTo.has(playerId) ? { ...slot.card } : null;
    }),
    discardTop: { ...state.discardPile.at(-1) },
    drawPileCount: state.deck.length,
    currentTurnId: state.playerOrder[state.currentTurnIndex],
    phase: state.phase,
    opponentsSeen,
    opponentHandSizes,
  };
}

// Returns the action triggered when this card is discarded after being drawn, or null.
function getCardAction(rank, suit) {
  if (rank === '7' || rank === '8') return 'peek';
  if (rank === '9' || rank === '10') return 'spy';
  if (rank === 'J' || rank === 'Q') return 'blind-swap';
  if (rank === 'K' && !RED_SUITS.has(suit)) return 'look-swap';
  return null;
}

module.exports = { createCambioState, getPlayerView, getCardAction };
