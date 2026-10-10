/* Bounded public-information one-response continuation tree for heads-up.
 * At most one opponent bet and one hero call/fold are simulated.
 * This is a shallow rollout, NOT a solver or full future-street action tree.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./poker') : root.Poker,
    isNode ? require('./ai-range') : root.HoldemAIRange,
    isNode ? require('./ai-conditional') : root.HoldemAIConditional);
  if (isNode) module.exports = api;
  else root.HoldemAITree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Poker, Range, Conditional) {
  'use strict';
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const id = c => c.rank + c.suit;
  const random = rng => clamp(rng(), 0, 1 - Number.EPSILON);
  function draw(pool, rng) {
    if (!pool.length) throw new Error('Public-card sample exhausted');
    return pool.splice(Math.floor(random(rng) * pool.length), 1)[0];
  }
  function holding(range, blocked, rng) {
    let total = 0;
    for (const item of range) if (!blocked.has(id(item.cards[0])) &&
      !blocked.has(id(item.cards[1]))) total += item.weight;
    if (!(total > 0)) throw new Error('No sampled legal opponent cards');
    let value = random(rng) * total, last;
    for (const item of range) {
      if (blocked.has(id(item.cards[0])) || blocked.has(id(item.cards[1]))) continue;
      last = item;
      value -= item.weight;
      if (value < 0) return item.cards;
    }
    return last.cards;
  }
  function category(hole, board) {
    return Poker.evaluate7([...hole, ...board]).score[0];
  }
  function responseProbability(holdingCards, visibleBoard, pot, observed = {}) {
    // Villain sees its own cards plus the public board at the simulated node.
    // Future river cards may not affect its turn betting decision.
    const hand = { cards: holdingCards };
    const strength = Conditional.responseStrength(hand, visibleBoard);
    const history = clamp(Number(observed.raiseRate) || 0, 0, 1);
    const checkBoost = clamp(Number(observed.checkBoost) || 0, -.1, .1);
    const pressure = clamp(pot / 300, 0, .2);
    return clamp(.18 + .38 * strength + .16 * history + checkBoost - pressure, .04, .78);
  }
  function defend({ hole, board, priorEquity, bet, pot, stack }) {
    // The hero's projected reaction must NEVER depend on the sampled
    // villain hole cards or on future hidden runout cards.
    if (!Number.isFinite(priorEquity) || priorEquity < 0 || priorEquity > 1)
      throw new Error('Invalid public-information equity for next decision');
    const call = Math.min(stack, bet);
    const odds = call / Math.max(1, pot + bet + call);
    const rank = category(hole, board);
    const made = [.12, .35, .65, .79, .88, .94, .97, .99, 1][rank];
    const projectedEquity = clamp(priorEquity * .52 + made * .48 - .08, 0, 1);
    return { type: projectedEquity >= odds + .025 ? 'call' : 'fold',
      equity: projectedEquity, potOdds: odds };
  }
  function legalOpportunity(state) {
    if (!state || !state.legal || !Array.isArray(state.players) ||
      !Array.isArray(state.board) || !Array.isArray(state.hole)) return false;
    if (state.street < 1 || state.street > 3 || state.board.length < 3) return false;
    const opponents = state.players.filter(p => p.seat !== state.seat &&
      p.inHand && !p.folded);
    if (opponents.length !== 1) return false;
    const hero = state.players[state.seat], villain = opponents[0];
    if (!hero || !Number.isFinite(hero.stack) || !Number.isFinite(villain.stack) ||
      villain.stack <= 0) return false;
    const now = Math.min(hero.stack, state.legal.canCheck ? 0 : state.legal.callAmount);
    if (hero.stack <= now) return false;
    // On the river only an out-of-position check can face an immediate bet.
    if (state.street === 3 && (!state.legal.canCheck ||
      state.button === state.seat)) return false;
    return true;
  }
  function simulate(state, options = {}) {
    if (!legalOpportunity(state)) return null;
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const n = Number.isFinite(options.trials) ?
      clamp(Math.floor(options.trials), 1, 64) : 24;
    const equity = Number(options.equity);
    if (!Number.isFinite(equity) || equity < 0 || equity > 1)
      throw new Error('One-response rollout requires valid equity');
    const hero = state.players[state.seat];
    const villain = state.players.find(p => p.seat !== state.seat && p.inHand && !p.folded);
    const blockedOriginal = new Set([...state.hole, ...state.board].map(id));
    if (blockedOriginal.size !== 2 + state.board.length)
      throw new Error('Duplicate publicly known cards');
    const range = Range.buildRange(state, villain.seat,
      Number.isFinite(options.trust) ? clamp(options.trust, 0, 1) : .65);
    const allUnseen = Poker.deck().filter(c => !blockedOriginal.has(id(c)));
    const folded = state.players.filter(p => p.seat !== state.seat &&
      p.inHand && p.folded).length;
    const paidNow = state.legal.canCheck ? 0 : state.legal.callAmount;
    const afterNow = hero.stack - paidNow;
    const heroFirst = state.button !== state.seat;
    const sameStreet = state.legal.canCheck && heroFirst;
    const canBet = villain.stack > 0 && afterNow > 0;
    const history = (state.actions || []).filter(a => a.seat === villain.seat &&
      a.hand < state.handNumber && a.type === 'raise');
    const observations = (state.actions || []).filter(a => a.seat === villain.seat &&
      a.hand < state.handNumber && ['check','raise','call','fold'].includes(a.type));
    const aggression = (history.length + 2) / (observations.length + 7);
    let sum = 0, bets = 0, heroCalls = 0, secondBets = 0, secondCalls = 0;
    for (let trial = 0; trial < n; trial++) {
      const blocked = new Set(blockedOriginal);
      const pool = allUnseen.slice();
      for (let i = 0; i < folded * 2; i++) blocked.add(id(draw(pool, rng)));
      const opponentHole = holding(range, blocked, rng);
      for (const card of opponentHole) blocked.add(id(card));
      const runoutPool = allUnseen.filter(c => !blocked.has(id(c)));
      const boardAtResponse = state.board.slice();
      // Simulate precisely the next public street before a possible lead;
      // if hero checks first on this street, opponent may bet immediately.
      if (!sameStreet && boardAtResponse.length < 5)
        boardAtResponse.push(draw(runoutPool, rng));
      const visible = boardAtResponse.slice();
      const start = state.players.map(p => p.invested);
      start[state.seat] += paidNow;
      let extra = 0, live = true;
      const potNow = state.pot + paidNow;
      const probe = Math.min(villain.stack,
        Math.max(1, Math.round(Math.max(state.bigBlind || 10, potNow * .55))));
      if (canBet && random(rng) < responseProbability(opponentHole, visible, potNow,
        { raiseRate: aggression, checkBoost: sameStreet ? .06 : 0 })) {
        bets++;
        const verdict = defend({ hole: state.hole, board: visible,
          priorEquity: equity, bet: probe, pot: potNow, stack: afterNow });
        if (verdict.type === 'fold') live = false;
        else {
          extra = Math.min(afterNow, probe);
          start[state.seat] += extra;
          start[villain.seat] += probe;
          heroCalls++;
        }
      }
      if (!live) { sum -= paidNow; continue; }
      // On the following street, allow one more bounded lead-and-defense
      // branch when both players can still wager. No 3-bets are simulated.
      const board = visible.slice();
      let totalHeroExtra = extra;
      let spentVillain = extra ? probe : 0;
      if (board.length < 5) {
        board.push(draw(runoutPool, rng));
        const remainingHero = afterNow - totalHeroExtra;
        const remainingVillain = villain.stack - spentVillain;
        const potAtNextStreet = potNow + totalHeroExtra + spentVillain;
        const laterBet = Math.min(remainingVillain,
          Math.max(1, Math.round(Math.max(state.bigBlind || 10, potAtNextStreet * .5))));
        if (remainingHero > 0 && remainingVillain > 0 &&
          random(rng) < responseProbability(opponentHole, board,
            potAtNextStreet, { raiseRate: aggression })) {
          secondBets++;
          const reply = defend({ hole: state.hole, board,
            priorEquity: equity, bet: laterBet,
            pot: potAtNextStreet, stack: remainingHero });
          if (reply.type === 'fold') {
            sum -= paidNow + totalHeroExtra;
            continue;
          }
          const added = Math.min(remainingHero, laterBet);
          totalHeroExtra += added;
          spentVillain += laterBet;
          start[state.seat] += added;
          start[villain.seat] += laterBet;
          secondCalls++;
        }
      }
      while (board.length < 5) board.push(draw(runoutPool, rng));
      const heroRank = Poker.evaluate7([...state.hole, ...board]);
      const villainRank = Poker.evaluate7([...opponentHole, ...board]);
      const award = Conditional.showdownPayout(start,
        new Set([state.seat, villain.seat]), state.seat,
        new Map([[state.seat, heroRank], [villain.seat, villainRank]]));
      sum += award - paidNow - totalHeroExtra;
    }
    return { type: paidNow ? 'call' : 'check', ev: sum / n,
      trials: n, betFrequency: bets / n, defendFrequency: bets ? heroCalls / bets : 0,
      secondBetFrequency: secondBets / n,
      secondDefendFrequency: secondBets ? secondCalls / secondBets : 0,
      depth: state.street === 1 || (state.street === 2 && sameStreet) ? 2 : 1,
      node: sameStreet ? 'same-street-after-check' : 'next-street' };
  }
  return { simulate, legalOpportunity, defend, responseProbability };
});
