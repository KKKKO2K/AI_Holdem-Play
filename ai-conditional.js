/* Public-information conditional response / showdown rollouts.
 * Candidate bet sizes reuse the same sampled ranges and board runouts.
 * Future streets are dealt solely to settle equity; future bets are not simulated.
 */
(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const poker = commonJs ? require('./poker') : root.Poker;
  const ranges = commonJs ? require('./ai-range') : root.HoldemAIRange;
  const ev = commonJs ? require('./ai-ev') : root.HoldemAIEV;
  const api = factory(poker, ranges, ev);
  if (commonJs) module.exports = api;
  else root.HoldemAIConditional = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Poker, Range, EV) {
  'use strict';
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  const key = c => c.rank + c.suit;
  const random = rng => clamp(rng(), 0, 0.9999999999999999);
  function draw(pool, rng) {
    if (!pool.length) throw new Error('Cannot draw from exhausted public-card pool');
    return pool.splice(Math.floor(random(rng) * pool.length), 1)[0];
  }
  function pickRange(range, blocked, rng) {
    let total = 0;
    for (const item of range)
      if (!blocked.has(key(item.cards[0])) && !blocked.has(key(item.cards[1])))
        total += item.weight;
    if (!(total > 0)) throw new Error('No legal conditional opponent holdings');
    let sample = random(rng) * total;
    let last = null;
    for (const item of range) {
      if (blocked.has(key(item.cards[0])) || blocked.has(key(item.cards[1]))) continue;
      last = item;
      sample -= item.weight;
      if (sample < 0) return item;
    }
    return last;
  }
  // Uses only the *visible* board at decision time. Never use river-runout
  // ranks to decide whether the opponent calls a flop or turn bet.
  function responseStrength(holding, publicBoard) {
    const preflop = Range.preflopStrength(holding.cards[0], holding.cards[1]);
    if (publicBoard.length < 3) return preflop;
    const value = Poker.evaluate7([...holding.cards, ...publicBoard]).score;
    const made = [0.18, .49, .70, .79, .91, .955, .975, .99, 1][value[0]];
    const kick = (value[1] || 2) / 14;
    return clamp(preflop * .15 + (made + .022 * kick) * .85, 0, 1);
  }
  function showdownPayout(contributions, live, hero, ranks) {
    const levels = [...new Set(contributions.filter(n => n > 0))].sort((a, b) => a - b);
    let previous = 0, payout = 0;
    for (const level of levels) {
      const contributors = contributions.map((n, i) => n >= level ? i : -1).filter(i => i >= 0);
      const amount = (level - previous) * contributors.length;
      previous = level;
      if (!live.has(hero) || contributions[hero] < level) continue;
      const eligible = contributors.filter(i => live.has(i));
      if (eligible.length === 1) { payout += amount; continue; }
      let winners = [eligible[0]];
      for (const seat of eligible.slice(1)) {
        const cmp = Poker.compareRanks(ranks.get(seat), ranks.get(winners[0]));
        if (cmp > 0) winners = [seat];
        else if (cmp === 0) winners.push(seat);
      }
      if (winners.includes(hero)) payout += amount / winners.length;
    }
    return payout;
  }
  // A sampled opponent may respond to the proposed hero bet by reraising.
  // The hero's response must be based only on the public price and own equity.
  function reraiseProbability(strength, state, opponent) {
    const observed = (state.actions || []).filter(a => a.seat === opponent.seat &&
      a.hand < state.handNumber && a.facing > 0 &&
      ['fold', 'call', 'raise'].includes(a.type));
    const raises = observed.filter(a => a.type === 'raise').length;
    const aggression = (raises + 1) / (observed.length + 10);
    return clamp(.04 + (strength - .65) * 1.03 + aggression * .3, .005, .62);
  }

  function reraiseDefense(state, initialTotal, opponentTotal, equity) {
    const hero = state.players[state.seat];
    const paid = initialTotal - hero.committed;
    const remaining = Math.max(0, hero.stack - paid);
    const cost = Math.min(remaining, Math.max(0, opponentTotal - initialTotal));
    const opponent = state.players.find(p => p.seat !== state.seat &&
      p.inHand && !p.folded);
    const opponentPaid = Math.min(opponent.stack,
      Math.max(0, opponentTotal - opponent.committed));
    const pot = state.pot + paid + opponentPaid;
    const odds = cost / Math.max(1, pot + cost);
    const adjustedEquity = clamp(equity - (state.street === 0 ? .11 : .13), 0, 1);
    return { type: cost && adjustedEquity < odds + .025 ? 'fold' : 'call',
      cost, odds, adjustedEquity };
  }
  function simulate(state, options = {}) {
    if (!state || !Array.isArray(state.hole) || state.hole.length !== 2 ||
        !Array.isArray(state.board) || !Array.isArray(state.players) ||
        !Array.isArray(options.targets) || !state.players[state.seat])
      throw new Error('Invalid conditional equity snapshot');
    const opponents = state.players.filter(p => p.seat !== state.seat && p.inHand && !p.folded);
    if (!opponents.length || opponents.length > 5)
      throw new RangeError('Conditional equity needs 1–5 active opponents');
    const hero = state.players[state.seat];
    const targets = [...new Set(options.targets)];
    if (!targets.length) return { trials: 0, raises: {}, baselineEquity: null };
    for (const total of targets) {
      if (!Number.isSafeInteger(total) || !state.legal.canRaise ||
          total > state.legal.maxTotal || total <= state.currentBet ||
          (total < state.legal.minTotal && total !== state.legal.maxTotal))
        throw new RangeError('Illegal conditional raise candidate');
    }
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const trials = Number.isFinite(options.trials) ?
      clamp(Math.floor(options.trials), 1, 120) : 36;
    const trust = clamp(Number.isFinite(options.trust) ? options.trust : .65, 0, 1);
    const known = new Set([...state.hole, ...state.board].map(key));
    if (known.size !== 2 + state.board.length) throw new Error('Duplicate known cards');
    const unseen = Poker.deck().filter(card => !known.has(key(card)));
    const deadSeats = state.players.filter(p => p.inHand && p.folded).length;
    const candidateRanges = new Map(opponents.map(p =>
      [p.seat, Range.buildRange(state, p.seat, trust)]));
    const skill = options.skill || {};
    const context = options.context || {};
    const baseFold = new Map(targets.map(total => [total, new Map(opponents.map(p =>
      [p.seat, EV.foldProbability(state, p, total, skill, context)]))]));
    const totals = new Map(targets.map(total =>
      [total, { ev: 0, foldAll: 0, payout: 0, cost: total - hero.committed, reraises: 0, heroReraiseFolds: 0 }]));

    for (let trial = 0; trial < trials; trial++) {
      // Sample blockers and opponent holdings exactly once per trial.
      const blocked = new Set(known);
      const pool = unseen.slice();
      for (let i = 0; i < deadSeats * 2; i++) blocked.add(key(draw(pool, rng)));
      const order = opponents.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random(rng) * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const holdings = new Map();
      for (const p of order) {
        const holding = pickRange(candidateRanges.get(p.seat), blocked, rng);
        holdings.set(p.seat, holding);
        blocked.add(key(holding.cards[0]));
        blocked.add(key(holding.cards[1]));
      }
      const runoutPool = unseen.filter(card => !blocked.has(key(card)));
      const board = state.board.slice();
      while (board.length < 5) board.push(draw(runoutPool, rng));
      const ranks = new Map([[state.seat, Poker.evaluate7([...state.hole, ...board])]]);
      const strengths = new Map();
      for (const p of opponents) {
        const hand = holdings.get(p.seat);
        ranks.set(p.seat, Poker.evaluate7([...hand.cards, ...board]));
        strengths.set(p.seat, responseStrength(hand, state.board));
      }
      const baseContributions = state.players.map(p => p.invested);
      for (const total of targets) {
        const live = new Set([state.seat]);
        const contributions = baseContributions.slice();
        contributions[state.seat] += total - hero.committed;
        const prior = totals.get(total);
        let anyone = false, heroFoldedToReraise = false;
        let incrementalCost = total - hero.committed;
        for (const p of opponents) {
          if (p.stack === 0 || total <= p.committed) {
            live.add(p.seat); anyone = true; continue;
          }
          const base = baseFold.get(total).get(p.seat);
          // Strong hands call more frequently. Trust controls how much we
          // believe this counterfactual hand-strength signal.
          const fold = clamp(base - trust * .62 * (strengths.get(p.seat) - .50),
            .015, .985);
          if (random(rng) >= fold) {
            live.add(p.seat); anyone = true;
            contributions[p.seat] += Math.min(p.stack, Math.max(0, total - p.committed));
            const maximum = p.committed + p.stack;
            const canReraise = opponents.length === 1 &&
              hero.stack > incrementalCost && maximum > total &&
              total > state.currentBet;
            if (canReraise && random(rng) <
              reraiseProbability(strengths.get(p.seat), state, p)) {
              const increment = Math.max(state.bigBlind || 1, total - state.currentBet);
              const counterTotal = Math.min(maximum, total + increment);
              prior.reraises++;
              contributions[p.seat] += counterTotal - total;
              const defense = reraiseDefense(state, total, counterTotal,
                Number.isFinite(options.heroEquity) ? options.heroEquity : .5);
              if (defense.type === 'fold') {
                prior.heroReraiseFolds++;
                heroFoldedToReraise = true;
              } else {
                contributions[state.seat] += defense.cost;
                incrementalCost += defense.cost;
              }
            }
          }
        }
        if (!anyone) prior.foldAll++;
        if (heroFoldedToReraise) {
          prior.ev -= incrementalCost;
          continue;
        }
        const award = showdownPayout(contributions, live, state.seat, ranks);
        prior.payout += award;
        prior.ev += award - incrementalCost;
      }
    }
    const raises = {};
    for (const [target, value] of totals) {
      raises[target] = {
        ev: value.ev / trials, payout: value.payout / trials,
        foldAll: value.foldAll / trials, trials,
        reraiseFrequency: value.reraises / trials,
        heroReraiseFoldFrequency: value.heroReraiseFolds / trials
      };
    }
    return { trials, raises };
  }
  return { simulate, responseStrength, showdownPayout, reraiseProbability, reraiseDefense };
});
