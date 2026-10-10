/* Pure Texas Hold'em card utilities. No dependencies; works in browsers and Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Poker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const LABELS = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const RANK_LABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
  const rankText = r => RANK_LABEL[r] || String(r);
  function deck() {
    const result = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) result.push({ rank, suit });
    return result;
  }
  function shuffle(cards, rng = Math.random) {
    const copy = cards.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  function straightHigh(ranks) {
    const unique = [...new Set(ranks)].sort((a, b) => b - a);
    if (unique.includes(14)) unique.push(1);
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) return unique[i];
    }
    return 0;
  }
  function compareRanks(a, b) {
    const A = Array.isArray(a) ? a : a.score;
    const B = Array.isArray(b) ? b : b.score;
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const diff = (A[i] || 0) - (B[i] || 0);
      if (diff !== 0) return Math.sign(diff);
    }
    return 0;
  }
  function evaluate5(cards) {
    if (cards.length !== 5) throw new Error('evaluate5 needs five cards');
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const flush = cards.every(c => c.suit === cards[0].suit);
    const straight = straightHigh(ranks);
    const counts = new Map();
    for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    if (flush && straight) return [8, straight];
    if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
    if (flush) return [5, ...ranks];
    if (straight) return [4, straight];
    if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(x => x[0]).sort((a, b) => b - a)];
    if (groups[0][1] === 2 && groups[1][1] === 2) {
      const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
      return [2, ...pairs, groups[2][0]];
    }
    if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map(x => x[0]).sort((a, b) => b - a)];
    return [0, ...ranks];
  }
  function evaluate7(cards) {
    if (cards.length < 5 || cards.length > 7) throw new Error('Need five to seven cards');
    let best = null, bestCards = null;
    for (let a = 0; a < cards.length - 4; a++)
      for (let b = a + 1; b < cards.length - 3; b++)
        for (let c = b + 1; c < cards.length - 2; c++)
          for (let d = c + 1; d < cards.length - 1; d++)
            for (let e = d + 1; e < cards.length; e++) {
              const chosen = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              const score = evaluate5(chosen);
              if (!best || compareRanks(score, best) > 0) { best = score; bestCards = chosen; }
            }
    const name = best[0] === 8 && best[1] === 14 ? 'Royal flush' : LABELS[best[0]];
    return { score: best, cards: bestCards, name, description: describe(best) };
  }
  function describe(score) {
    const r = rankText;
    switch (score[0]) {
      case 8: return score[1] === 14 ? 'Royal flush' : `Straight flush, ${r(score[1])} high`;
      case 7: return `Four ${r(score[1])}s · ${r(score[2])} kicker`;
      case 6: return `${r(score[1])}s full of ${r(score[2])}s`;
      case 5: return `Flush, ${score.slice(1).map(r).join('–')}`;
      case 4: return `Straight, ${r(score[1])} high`;
      case 3: return `Three ${r(score[1])}s · ${score.slice(2).map(r).join('–')} kickers`;
      case 2: return `${r(score[1])}s & ${r(score[2])}s · ${r(score[3])} kicker`;
      case 1: return `Pair of ${r(score[1])}s · ${score.slice(2).map(r).join('–')} kickers`;
      default: return `${r(score[1])} high · ${score.slice(2).map(r).join('–')}`;
    }
  }
  function equity(hole, board, trials = 100, rng = Math.random, opponents = 1) {
    if (!hole || hole.length !== 2 || !Array.isArray(board) || board.length > 5 ||
        !Number.isSafeInteger(trials) || trials < 1 || !Number.isSafeInteger(opponents) || opponents < 1 || opponents > 5) return null;
    const used = new Set([...hole, ...board].map(c => `${c.rank}${c.suit}`));
    if (used.size !== hole.length + board.length) return null;
    const unseen = deck().filter(c => !used.has(`${c.rank}${c.suit}`));
    let share = 0;
    for (let i = 0; i < trials; i++) {
      // Sample from only this seat's hand and public board. Actual private hands
      // and burned cards are deliberately not inputs to the estimate.
      const sample = unseen.slice();
      const need = 2 * opponents + 5 - board.length;
      for (let j = 0; j < need; j++) {
        const idx = j + Math.floor(rng() * (sample.length - j));
        [sample[j], sample[idx]] = [sample[idx], sample[j]];
      }
      const runout = [...board, ...sample.slice(2 * opponents, need)];
      const hero = evaluate7([...hole, ...runout]);
      let ties = 1, beaten = false;
      for (let opponent = 0; opponent < opponents; opponent++) {
        const cmp = compareRanks(hero, evaluate7([...sample.slice(opponent * 2, opponent * 2 + 2), ...runout]));
        if (cmp < 0) { beaten = true; break; }
        if (cmp === 0) ties++;
      }
      if (!beaten) share += 1 / ties;
    }
    return share / trials;
  }
  return { deck, shuffle, evaluate5, evaluate7, compareRanks, equity, rankText, describe, SUIT_SYMBOL, LABELS };
});
