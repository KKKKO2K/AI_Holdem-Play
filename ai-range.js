/* Public-information-only, range-aware Hold'em equity estimator.
 * Candidate ranges are heuristic likelihoods, not solver outputs. Opponent
 * cards, the undealt deck, and burn cards are never inputs to this module.
 */
(function (root, factory) {
  const poker = typeof module === 'object' && module.exports ? require('./poker') : root.Poker;
  const api = factory(poker);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemAIRange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Poker) {
  'use strict';

  const MAX_TRIALS = 240;
  const rankOf = card => card.rank;
  const suitOf = card => card.suit;
  const keyOf = card => `${rankOf(card)}${suitOf(card)}`;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function randomValue(rng) {
    const value = Number(rng());
    if (!Number.isFinite(value)) return 0.5;
    return clamp(value, 0, 1 - Number.EPSILON);
  }

  function validatePublicState(state) {
    if (!state || !Array.isArray(state.hole) || state.hole.length !== 2 ||
        !Array.isArray(state.board) || state.board.length > 5 ||
        !Array.isArray(state.players) || !Number.isInteger(state.seat)) {
      throw new TypeError('Invalid public AI range state');
    }
    const known = [...state.hole, ...state.board];
    const used = new Set();
    for (const card of known) {
      if (!card || !Number.isInteger(rankOf(card)) || rankOf(card) < 2 || rankOf(card) > 14 ||
          !['s', 'h', 'd', 'c'].includes(suitOf(card))) {
        throw new TypeError('Invalid card in public AI range state');
      }
      const key = keyOf(card);
      if (used.has(key)) throw new TypeError('Duplicate known card in public AI range state');
      used.add(key);
    }
    return used;
  }

  function activeOpponents(state) {
    // Explicit property reads form the information boundary. In particular,
    // never enumerate/clone player objects or touch any `cards` property.
    return state.players.filter(player => player.seat !== state.seat && player.inHand && !player.folded)
      .map(player => player.seat);
  }

  function preflopStrength(a, b) {
    const high = Math.max(a.rank, b.rank), low = Math.min(a.rank, b.rank);
    if (high === low) return 0.61 + (high - 2) * 0.026;
    const suited = a.suit === b.suit;
    const gap = high - low - 1;
    const highCard = (high - 2) / 12;
    const lowCard = (low - 2) / 12;
    const connected = gap === 0 ? 0.105 : gap === 1 ? 0.065 : gap === 2 ? 0.025 : gap >= 5 ? -0.045 : 0;
    const broadway = high >= 10 && low >= 10 ? 0.045 : 0;
    return clamp(0.12 + highCard * 0.39 + lowCard * 0.19 +
      (suited ? 0.075 : 0) + connected + broadway, 0.025, 0.79);
  }

  function drawBonus(cards, boardLength) {
    if (boardLength >= 5) return 0;
    let bonus = 0;
    const suits = new Map();
    for (const card of cards) suits.set(card.suit, (suits.get(card.suit) || 0) + 1);
    if ([...suits.values()].some(count => count === 4)) bonus += 0.035;

    const ranks = new Set(cards.map(card => card.rank));
    if (ranks.has(14)) ranks.add(1);
    let bestWindow = 0;
    for (let low = 1; low <= 10; low++) {
      let present = 0;
      for (let rank = low; rank < low + 5; rank++) if (ranks.has(rank)) present++;
      bestWindow = Math.max(bestWindow, present);
    }
    if (bestWindow === 4) bonus += 0.026;
    return bonus;
  }

  function handStrength(hole, board) {
    const preflop = preflopStrength(hole[0], hole[1]);
    if (board.length < 3) return preflop;
    const result = Poker.evaluate7([...hole, ...board]);
    const categoryBase = [0.105, 0.30, 0.435, 0.575, 0.675, 0.765, 0.86, 0.93, 0.985];
    const tail = result.score.slice(1);
    let numerator = 0, denominator = 0, place = 1;
    for (const rank of tail) {
      const weight = place;
      numerator += ((rank - 2) / 12) * weight;
      denominator += weight;
      place *= 0.62;
    }
    const tieValue = denominator ? numerator / denominator : 0;
    const made = clamp(categoryBase[result.score[0]] + tieValue * 0.023 +
      drawBonus([...hole, ...board], board.length), 0.02, 0.999);
    return clamp(preflop * 0.22 + made * 0.78, 0.02, 0.999);
  }

  function boardLengthAtStreet(street) {
    if (street <= 0) return 0;
    if (street === 1) return 3;
    if (street === 2) return 4;
    return 5;
  }

  function opponentEvidence(state, seat) {
    const current = [];
    let decisions = 0, raises = 0, calls = 0, folds = 0;
    const actions = Array.isArray(state.actions) ? state.actions : [];
    for (const action of actions) {
      if (action.seat !== seat) continue;
      const type = action.type;
      if (action.hand === state.handNumber) {
        if (type === 'raise' || type === 'call') {
          // Ignore impossible or malformed current-hand records rather than
          // letting future board cards leak backward into an earlier action.
          if (!Number.isInteger(action.street) || action.street < 0 || action.street > 3 ||
              boardLengthAtStreet(action.street) > state.board.length) continue;
          // The amount already wagered and pot just before the action are
          // public. Larger investments carry more *conditional* strength
          // evidence, tempered by the opponent's historical raise rate.
          // Malformed/missing sizes remain neutral (backward compatible).
          const investedRatio = Number.isFinite(action.paid) && action.paid >= 0 &&
            Number.isFinite(action.potBefore) && action.potBefore > 0 ?
            clamp(action.paid / action.potBefore, 0, 2.5) : null;
          current.push({ type, street: action.street, investedRatio });
        }
        continue;
      }
      // Histories from earlier hands inform how much an action means. They do
      // not directly narrow a no-action range, which stays broad.
      if (Number.isFinite(action.hand) && Number.isFinite(state.handNumber) && action.hand >= state.handNumber) continue;
      if (type === 'fold' || type === 'call' || type === 'raise' || type === 'check') {
        decisions++;
        if (type === 'raise') raises++;
        if (type === 'call') calls++;
        if (type === 'fold') folds++;
      }
    }
    const confidence = decisions / (decisions + 12);
    // Eight pseudo decisions with a neutral 1.5 raise / 3.5 call / 2 fold /
    // 1 check mix keep early reads close to the prior.
    const raiseRate = (raises + 1.5) / (decisions + 8);
    const callRate = (calls + 3.5) / (decisions + 8);
    const foldRate = (folds + 2) / (decisions + 8);
    return { current, confidence, raiseRate, callRate, foldRate };
  }

  function candidateCards(known) {
    const unseen = Poker.deck().filter(card => !known.has(keyOf(card)));
    const result = [];
    for (let i = 0; i < unseen.length - 1; i++) {
      for (let j = i + 1; j < unseen.length; j++) {
        const cards = [unseen[i], unseen[j]];
        result.push({ cards, preflop: preflopStrength(cards[0], cards[1]) });
      }
    }
    return result;
  }

  function weightsFor(candidates, state, evidence, trust, streetScores) {
    const logWeights = new Array(candidates.length);
    let maxLog = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      let logWeight = (candidate.preflop - 0.5) * 0.42;
      for (const action of evidence.current) {
        const boardLen = boardLengthAtStreet(action.street);
        const score = boardLen < 3 ? candidate.preflop : streetScores.get(boardLen)[i];
        if (action.type === 'raise') {
          const raiseCoefficient = 2.65 *
            (1 - evidence.confidence * evidence.raiseRate * 0.52) *
            (1 + evidence.confidence * (evidence.foldRate - 0.25) * 0.25);
          const sizeFactor = action.investedRatio === null ? 1 :
            clamp(0.80 + 0.34 * action.investedRatio, 0.80, 1.55);
          logWeight += raiseCoefficient * sizeFactor * (score - 0.47);
        } else {
          // A known frequent caller gets a less selective call likelihood;
          // estimates remain near neutral until enough hands are observed.
          const callCoefficient = 1.08 * (1 - evidence.confidence * evidence.callRate * 0.55) *
            (1 + evidence.confidence * (evidence.foldRate - 0.25) * 0.25);
          logWeight += callCoefficient * (score - 0.47);
        }
      }
      logWeight = clamp(logWeight, -5.5, 5.5);
      logWeights[i] = logWeight;
      if (logWeight > maxLog) maxLog = logWeight;
    }
    const raw = logWeights.map(value => Math.exp(value - maxLog));
    const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
    return raw.map(value => Math.max(Number.MIN_VALUE, (1 - trust) + trust * value / mean));
  }

  function normalizeTrust(value) {
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0.65;
  }

  function boardScores(candidates, board, actions) {
    const lengths = new Set(actions.map(action => boardLengthAtStreet(action.street)).filter(length => length >= 3));
    const scores = new Map();
    for (const length of lengths) {
      const prefix = board.slice(0, Math.min(length, board.length));
      if (prefix.length < 3) continue;
      scores.set(length, candidates.map(candidate => handStrength(candidate.cards, prefix)));
    }
    return scores;
  }

  function rangeForSeat(candidates, state, seat, trust, scoreCache) {
    const evidence = opponentEvidence(state, seat);
    const scores = scoreCache || boardScores(candidates, state.board, evidence.current);
    const weights = weightsFor(candidates, state, evidence, normalizeTrust(trust), scores);
    return candidates.map((candidate, index) => ({
      cards: candidate.cards,
      weight: weights[index],
      strength: candidate.preflop
    }));
  }

  function buildRange(state, opponentSeat, trust = 0.65) {
    const known = validatePublicState(state);
    const opponents = activeOpponents(state);
    if (!opponents.includes(opponentSeat)) throw new RangeError('Opponent seat is not active');
    const candidates = candidateCards(known);
    return rangeForSeat(candidates, state, opponentSeat, trust);
  }

  function pickWeighted(range, blocked, rng) {
    let total = 0;
    for (const candidate of range) {
      if (!blocked.has(keyOf(candidate.cards[0])) && !blocked.has(keyOf(candidate.cards[1]))) total += candidate.weight;
    }
    if (!(total > 0)) throw new Error('No legal opponent holdings remain');
    let pick = randomValue(rng) * total;
    let fallback = null;
    for (const candidate of range) {
      if (blocked.has(keyOf(candidate.cards[0])) || blocked.has(keyOf(candidate.cards[1]))) continue;
      fallback = candidate;
      pick -= candidate.weight;
      if (pick < 0) return candidate.cards;
    }
    return fallback.cards;
  }

  function drawCard(pool, rng) {
    const index = Math.floor(randomValue(rng) * pool.length);
    return pool.splice(index, 1)[0];
  }

  function equity(state, options = {}) {
    options = options || {};
    const known = validatePublicState(state);
    const seats = activeOpponents(state);
    if (seats.length === 0) return 1;
    if (seats.length > 5) throw new RangeError('Range equity supports one to five opponents');
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const trials = Number.isFinite(options.trials) ? clamp(Math.floor(options.trials), 1, MAX_TRIALS) : 120;
    const trust = normalizeTrust(options.trust);
    const candidates = candidateCards(known);
    const ranges = new Map();
    const evidenceBySeat = new Map(seats.map(seat => [seat, opponentEvidence(state, seat)]));
    const allCurrentActions = seats.flatMap(seat => evidenceBySeat.get(seat).current);
    // Board interaction for a given street is identical across seats, so do
    // the evaluator work once even when all five opponents have histories.
    const sharedScores = boardScores(candidates, state.board, allCurrentActions);
    for (const seat of seats) {
      const evidence = evidenceBySeat.get(seat);
      const weights = weightsFor(candidates, state, evidence, trust, sharedScores);
      ranges.set(seat, candidates.map((candidate, index) => ({
        cards: candidate.cards, weight: weights[index], strength: candidate.preflop
      })));
    }
    const hero = state.hole;
    const board = state.board;
    const unseen = Poker.deck().filter(card => !known.has(keyOf(card)));
    const foldedSeats = state.players.filter(player => player.seat !== state.seat &&
      player.inHand && player.folded).map(player => player.seat);
    let totalShare = 0;

    for (let trial = 0; trial < trials; trial++) {
      const order = seats.slice();
      // Random seat order reduces the systematic advantage of sampling an
      // informative range first when holdings are selected conditionally.
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(randomValue(rng) * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const blocked = new Set(known);
      // Folded hands were dealt, so integrate their unknown cards out as
      // uniformly sampled blockers without reading the folded players' cards.
      const foldedPool = unseen.slice();
      for (let i = 0; i < foldedSeats.length * 2; i++) {
        const foldedCard = drawCard(foldedPool, rng);
        blocked.add(keyOf(foldedCard));
      }
      const holdings = new Map();
      for (const seat of order) {
        const holding = pickWeighted(ranges.get(seat), blocked, rng);
        holdings.set(seat, holding);
        blocked.add(keyOf(holding[0]));
        blocked.add(keyOf(holding[1]));
      }
      const runoutPool = unseen.filter(card => !blocked.has(keyOf(card)));
      const runout = board.slice();
      while (runout.length < 5) runout.push(drawCard(runoutPool, rng));
      const heroRank = Poker.evaluate7([...hero, ...runout]);
      let best = heroRank, heroWins = true, tied = 1;
      for (const seat of seats) {
        const holding = holdings.get(seat);
        const opponentRank = Poker.evaluate7([...holding, ...runout]);
        const comparison = Poker.compareRanks(opponentRank, best);
        if (comparison > 0) {
          best = opponentRank;
          heroWins = false;
          tied = 1;
        } else if (comparison === 0) {
          tied++;
        }
      }
      if (heroWins) totalShare += 1 / tied;
    }
    return totalShare / trials;
  }

  return { equity, buildRange, preflopStrength, MAX_TRIALS };
});
