/* Public board texture and hero draw features for the opponent strategy.
 * No opponent hole cards, deck order or hidden game objects are accessed.
 */
(function (root, factory) {
  const poker = typeof module === 'object' && module.exports
    ? require('./poker') : root.Poker;
  const api = factory(poker);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemAIPostflop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Poker) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const key = c => c.rank + c.suit;
  function rankSet(cards) {
    const ranks = new Set(cards.map(c => c.rank));
    if (ranks.has(14)) ranks.add(1);
    return ranks;
  }
  function straightPotential(cards) {
    const ranks = rankSet(cards);
    let best = 0;
    for (let start = 1; start <= 10; start++) {
      let count = 0;
      for (let r = start; r <= start + 4; r++) if (ranks.has(r)) count++;
      best = Math.max(best, count);
    }
    return best;
  }
  function suitCounts(cards) {
    const counts = {};
    for (const card of cards) counts[card.suit] = (counts[card.suit] || 0) + 1;
    return counts;
  }
  function texture(board) {
    if (!Array.isArray(board) || board.length < 3 || board.length > 5)
      throw new Error('Expected flop, turn or river board');
    const suited = Math.max(...Object.values(suitCounts(board)));
    const counts = new Map();
    for (const c of board) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
    const paired = [...counts.values()].some(n => n >= 2);
    const connected = straightPotential(board);
    const wetness = clamp(
      (suited >= 3 ? .43 : suited === 2 ? .20 : 0) +
      (connected >= 4 ? .39 : connected === 3 ? .24 : connected === 2 ? .09 : 0) +
      (paired ? .11 : 0), 0, 1);
    return { suits: suited >= 3 ? 'monotone' : suited === 2 ? 'two-tone' : 'rainbow',
      paired, connected, wetness };
  }
  function inspect(state) {
    if (!state || !Array.isArray(state.board) || state.board.length < 3 ||
      state.board.length > 5 || !Array.isArray(state.hole) || state.hole.length !== 2)
      return null;
    const board = state.board, hole = state.hole;
    const all = hole.concat(board);
    const seen = new Set(all.map(key));
    if (seen.size !== all.length) throw new Error('Duplicate known cards in AI hand');
    const made = Poker.evaluate7(all);
    const category = made.score[0];
    const boardTexture = texture(board);
    const maxBoard = Math.max(...board.map(c => c.rank));
    const handMatch = hole.some(c => board.some(b => b.rank === c.rank));
    const overpair = hole[0].rank === hole[1].rank && hole[0].rank > maxBoard;
    const topPair = category === 1 && hole.some(c => c.rank === maxBoard);
    const holeFlush = suitCounts(hole), combinedFlush = suitCounts(all);
    const liveDraw = board.length < 5 && category < 4;
    let flushOuts = 0, straightOuts = 0;
    if (liveDraw) {
      // Count currently unseen, publicly possible ONE-CARD direct outs.
      // Never use the real live deck or another seat's private hole cards.
      const possible = Poker.deck().filter(c => !seen.has(key(c)));
      for (const card of possible) {
        const next = Poker.evaluate7(all.concat(card)).score[0];
        if (category < 5 && next >= 5 && Object.keys(holeFlush).some(s =>
          holeFlush[s] > 0 && combinedFlush[s] === 4 && card.suit === s))
          flushOuts++;
        if (category < 4 && next >= 4 && next !== 5 &&
          next !== 6 && next !== 7) straightOuts++;
      }
    }
    // A made straight may still be drawing to a flush. Check that separately.
    if (board.length < 5 && category >= 4 && category < 5) {
      const possible = Poker.deck().filter(c => !seen.has(key(c)));
      for (const card of possible) {
        const next = Poker.evaluate7(all.concat(card)).score[0];
        if (next >= 5 && Object.keys(holeFlush).some(s =>
          holeFlush[s] > 0 && combinedFlush[s] === 4 && card.suit === s))
          flushOuts++;
      }
    }
    const primaryDraw = flushOuts >= 8 ? 'flush' :
      straightOuts >= 8 ? 'open-ended-straight' :
      straightOuts >= 4 ? 'gutshot-straight' : 'none';
    // Outs are not independent; intersections are counted once.
    const drawOuts = Math.max(0, Math.min(52 - all.length, flushOuts + straightOuts -
      (flushOuts && straightOuts ? Math.min(2, flushOuts, straightOuts) : 0)));
    const madeRole = category >= 4 ? 'strong-made' :
      category >= 2 ? 'two-pair-or-trips' :
      overpair ? 'overpair' : topPair ? 'top-pair' :
      handMatch ? 'paired' : 'air';
    const madeFlush = category >= 5;
    const threats = board.length === 5 ? 0 : Math.min(1, drawOuts / 12);
    const blockers = {
      aceOfBoardSuit: boardTexture.suits !== 'rainbow' &&
        hole.some(h => h.rank === 14 && board.some(c => c.suit === h.suit))
    };
    const backdoorFlush = board.length === 3 && !madeFlush && flushOuts === 0 &&
      Object.entries(combinedFlush).some(([s, n]) => n === 3 && holeFlush[s]);
    return {
      street: state.street, boardTexture, category, madeRole,
      flushOuts, straightOuts, drawOuts, primaryDraw, backdoorFlush,
      threats, blockers,
      hasStrongDraw: drawOuts >= 8,
      canImprove: board.length < 5,
      rawScore: made.score.slice()
    };
  }

  function streetPlan(state, postflop, profile = {}) {
    if (!postflop) return null;
    const opponents = state.players.filter(p => p.inHand && !p.folded && p.seat !== state.seat);
    const hero = state.players[state.seat];
    const effStack = Math.min(hero.stack,
      Math.max(0, ...opponents.filter(p => p.stack > 0).map(p => p.stack)));
    const spr = effStack / Math.max(1, state.pot);
    const hasBet = Math.max(0, state.legal.toCall) > 0;
    const headsUp = opponents.length === 1;
    const streetActions = (state.actions || []).filter(a =>
      a.hand === state.handNumber && a.street === state.street);
    const priorPreflopRaises = (state.actions || []).filter(a =>
      a.hand === state.handNumber && a.street === 0 && a.type === 'raise');
    const lastPreflopRaiser = priorPreflopRaises.length ?
      priorPreflopRaises[priorPreflopRaises.length - 1].seat : null;
    const continuation = state.street === 1 && lastPreflopRaiser === state.seat &&
      !hasBet && !streetActions.some(a => a.seat === state.seat && a.type === 'raise');
    const semiBluff = postflop.hasStrongDraw && headsUp && spr > .6 && !hasBet;
    const trapping = postflop.category >= 3 && headsUp && spr >= 2 &&
      profile.style === 'tricky' && !hasBet;
    return {
      spr, headsUp, continuation, semiBluff, trapping,
      wetness: postflop.boardTexture.wetness,
      danger: postflop.boardTexture.wetness > .55 &&
        postflop.madeRole === 'air' && !postflop.hasStrongDraw
    };
  }
  return { texture, inspect, streetPlan };
});
