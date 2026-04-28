const SUITS  = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS  = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED_SUITS = new Set(['hearts', 'diamonds']);

function buildDeck() {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
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
 * Creates a fresh Un-Solitaire state.
 *
 * Tableau layout (§4.1):
 *   Column 0 → 7 cards, column 1 → 6, …, column 6 → 1 card  (28 total)
 *   Only the top (last) card of each column starts face-up.
 *
 * Remaining 24 cards split evenly: 12 per player.
 * phase: 'sorting' → players reorder their hands → 'playing' → 'resolution'
 */
function createUnSolitaireState(playerIds) {
  const deck = shuffle(buildDeck());

  // Build tableau: col 0 gets 7 cards, col 6 gets 1
  const tableau = [];
  for (let col = 0; col < 7; col++) {
    const count = 7 - col;
    const column = [];
    for (let i = 0; i < count; i++) {
      column.push({ ...deck.pop(), faceUp: i === count - 1 });
    }
    tableau.push(column);
  }

  // Deal 12 cards each (round-robin so neither player gets a predictable run)
  const hands = Object.fromEntries(playerIds.map(id => [id, []]));
  for (let i = 0; i < 12; i++) {
    for (const id of playerIds) {
      hands[id].push(deck.pop());
    }
  }

  return {
    tableau,
    foundations: { hearts: [], diamonds: [], clubs: [], spades: [] },
    playerHands:    hands,
    playerDiscards: Object.fromEntries(playerIds.map(id => [id, []])),
    playerOrder: [...playerIds],
    currentTurnIndex: 0,
    phase: 'sorting',
    sortingReady: new Set(),
    drawnThisTurn: new Set(),
    history: [],
  };
}

/**
 * What each player is allowed to see.
 *
 * - Tableau: full (face-up / face-down flags are public knowledge).
 * - Foundations: always public.
 * - My hand: fully visible so I can plan my sort order.
 * - Partner hand: only size + top card (after sorting starts) — cards are hidden.
 * - Both discard piles: top card visible, size known.
 */
function getUnSolitaireView(state, playerId) {
  const partnerId = state.playerOrder.find(id => id !== playerId);
  const partnerHand = partnerId ? state.playerHands[partnerId] : [];
  return {
    tableau:           state.tableau,
    foundations:       state.foundations,
    myHand:            state.playerHands[playerId] ?? [],
    myDiscard:         state.playerDiscards[playerId] ?? [],
    partnerHandSize:   partnerHand.length,
    partnerHandTop:    state.phase !== 'sorting' ? (partnerHand[0] ?? null) : null,
    partnerDiscard:    state.playerDiscards[partnerId] ?? [],
    currentTurnId:     state.playerOrder[state.currentTurnIndex],
    phase:             state.phase,
    sortingReadyIds:   [...state.sortingReady],
    hasDrawnThisTurn:  state.drawnThisTurn?.has(playerId) ?? false,
    historySize:       state.history.length,
  };
}

// Returns true if `card` can legally be placed on top of `targetCard` in the tableau.
function canStackOnTableau(card, targetCard) {
  if (!targetCard) return card.rank === 'K'; // empty column only accepts Kings
  if (RANKS.indexOf(card.rank) !== RANKS.indexOf(targetCard.rank) - 1) return false;
  const cardRed   = RED_SUITS.has(card.suit);
  const targetRed = RED_SUITS.has(targetCard.suit);
  return cardRed !== targetRed; // must alternate colors
}

// Returns true if `card` is the next card needed for its foundation pile.
function canPlaceOnFoundation(card, foundationPile) {
  if (foundationPile.length === 0) return card.rank === 'A';
  const topRank = foundationPile.at(-1).rank;
  return card.suit === foundationPile.at(-1).suit &&
    RANKS.indexOf(card.rank) === RANKS.indexOf(topRank) + 1;
}

function cloneUSState(state) {
  return {
    tableau:        state.tableau.map(col => col.map(c => ({ ...c }))),
    foundations: {
      hearts:   [...state.foundations.hearts.map(c => ({ ...c }))],
      diamonds: [...state.foundations.diamonds.map(c => ({ ...c }))],
      clubs:    [...state.foundations.clubs.map(c => ({ ...c }))],
      spades:   [...state.foundations.spades.map(c => ({ ...c }))],
    },
    playerHands:    Object.fromEntries(Object.entries(state.playerHands).map(([id, h]) => [id, h.map(c => ({ ...c }))])),
    playerDiscards: Object.fromEntries(Object.entries(state.playerDiscards).map(([id, h]) => [id, h.map(c => ({ ...c }))])),
    playerOrder:    [...state.playerOrder],
    currentTurnIndex: state.currentTurnIndex,
    phase:          state.phase,
    sortingReady:   new Set(state.sortingReady),
    drawnThisTurn:  new Set(state.drawnThisTurn),
  };
}

module.exports = { createUnSolitaireState, getUnSolitaireView, canStackOnTableau, canPlaceOnFoundation, cloneUSState };
