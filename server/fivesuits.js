'use strict';

const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['spades','hearts','clubs','diamonds','stars'];

function buildDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank, joker: false });
    }
  }
  // 3 jokers per half-deck
  for (let i = 0; i < 3; i++) {
    cards.push({ suit: 'joker', rank: 'Joker', joker: true });
  }
  // Two copies of the 58-card half
  return [...cards, ...cards.map(c => ({ ...c }))];
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
 * Creates a fresh Five Suits state for a new round.
 * @param {string[]} playerIds
 * @param {number} round - 1-indexed
 * @param {Object|null} prevScores - carried-over score map { socketId: [scores...] }
 */
function createFiveSuitsState(playerIds, round = 1, prevScores = null) {
  const deck = shuffle(buildDeck());
  const handSize = round + 2; // round 1 → 3 cards, round 11 → 13 cards

  const playerHands = {};
  for (const id of playerIds) {
    playerHands[id] = [];
  }
  // Deal round-robin
  for (let i = 0; i < handSize; i++) {
    for (const id of playerIds) {
      playerHands[id].push(deck.pop());
    }
  }

  // Start discard pile with top card
  const firstDiscard = deck.pop();
  const discardPile = [firstDiscard];

  // Carry over or initialize roundScores
  const roundScores = {};
  for (const id of playerIds) {
    roundScores[id] = prevScores?.[id] ? [...prevScores[id]] : [];
  }

  return {
    deck,
    discardPile,
    playerHands,
    melds: Object.fromEntries(playerIds.map(id => [id, []])),
    playerOrder: [...playerIds],
    currentTurnIndex: 0,
    phase: 'playing',
    round,
    roundScores,
    finalTurnsRemaining: 0,
    goOutPlayerId: null,
    hasDrawn: new Set(),
    roundReadyIds: new Set(),
  };
}

/**
 * Returns the per-player view of the state.
 */
function getFiveSuitsView(state, playerId) {
  const wildRank = RANKS[state.round - 1];
  const handSizes = {};
  for (const id of state.playerOrder) {
    handSizes[id] = state.playerHands[id]?.length ?? 0;
  }
  return {
    myHand:         state.playerHands[playerId] ?? [],
    discardTop:     state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null,
    discardCount:   state.discardPile.length,
    drawCount:      state.deck.length,
    melds:          state.melds,
    playerOrder:    state.playerOrder,
    currentTurnId:  state.playerOrder[state.currentTurnIndex],
    phase:          state.phase,
    round:          state.round,
    wildRank,
    roundScores:    state.roundScores,
    hasDrawn:       [...state.hasDrawn],
    goOutPlayerId:  state.goOutPlayerId,
    handSizes,
  };
}

/**
 * Validates a proposed meld (array of card objects).
 * Returns 'book', 'run', or null.
 */
function validateMeld(cards, round) {
  if (!cards || cards.length < 3) return null;
  const wildRank = RANKS[round - 1];

  function isWild(card) {
    return card.joker || card.rank === wildRank;
  }

  const naturals = cards.filter(c => !isWild(c));
  // Must have at least 1 natural card
  if (naturals.length === 0) return null;

  // Try book: all naturals same rank
  const bookRank = naturals[0].rank;
  if (naturals.every(c => c.rank === bookRank)) {
    return 'book';
  }

  // Try run: all naturals same non-joker suit, no duplicate rank indices
  const runSuit = naturals[0].suit;
  if (runSuit === 'joker') return null;
  if (!naturals.every(c => c.suit === runSuit)) return null;

  const rankIndices = naturals.map(c => RANKS.indexOf(c.rank));
  if (rankIndices.some(i => i === -1)) return null;

  // No duplicate rank indices in naturals
  const uniqueIndices = new Set(rankIndices);
  if (uniqueIndices.size !== naturals.length) return null;

  const minIdx = Math.min(...rankIndices);
  const maxIdx = Math.max(...rankIndices);

  // Count how many wilds are needed to fill gaps between min and max
  const span = maxIdx - minIdx + 1;
  const gapsNeeded = span - naturals.length;
  const wilds = cards.filter(c => isWild(c));

  if (wilds.length < gapsNeeded) return null;

  // Extra wilds extend the run; total length >= 3 is already guaranteed by cards.length >= 3
  return 'run';
}

/**
 * Computes the penalty score for leftover cards at round end.
 */
function scorePenalty(cards, round) {
  const wildRank = RANKS[round - 1];
  let total = 0;
  for (const card of cards) {
    if (card.joker) {
      total += 50;
    } else if (card.rank === wildRank) {
      total += 20;
    } else if (['10','J','Q','K'].includes(card.rank)) {
      total += 10;
    } else {
      // ranks 3-9: face value
      total += parseInt(card.rank, 10);
    }
  }
  return total;
}

module.exports = { createFiveSuitsState, getFiveSuitsView, validateMeld, scorePenalty };
