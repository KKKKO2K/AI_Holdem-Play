/* One-decision action EV approximation using public stacks, actions and equity.
 * Incremental chip EV relative to folding now (sunk contributions excluded).
 * No real opponent holes, live deck, private profiles or future betting.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemAIEV = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const activeOpponents = s => s.players.filter(p => p.seat !== s.seat && p.inHand && !p.folded);
  const bankroll = (s, seat) => s.players.find(p => p.seat === seat);

  function foldProbability(state, opponent, targetTotal, skill = {}, context = {}) {
    if (!opponent || !opponent.inHand || opponent.folded) return 1;
    if (opponent.stack <= 0) return 0; // already all-in: never assume they fold
    const faced = Math.max(0, targetTotal - opponent.committed);
    const cost = Math.min(opponent.stack, faced);
    if (cost === 0) return 0;
    const hero = bankroll(state, state.seat);
    const heroPaid = Math.max(0, targetTotal - hero.committed);
    const price = cost / Math.max(1, state.pot + heroPaid + cost);
    const stackFraction = cost / Math.max(1, opponent.stack);
    let choices = 0, folds = 0;
    let priorRaise = false;
    for (const action of state.actions || []) {
      if (action.seat !== opponent.seat) continue;
      if (action.hand === state.handNumber && action.street === state.street && action.type === 'raise')
        priorRaise = true;
      if (action.hand >= state.handNumber || !(action.facing > 0)) continue;
      if (!['fold', 'call', 'raise'].includes(action.type)) continue;
      // A river fold is stronger evidence for river decisions than for flop
      // decisions; do not treat every past street identically.
      const weight = action.street === state.street ? 1 : .35;
      choices += weight;
      if (action.type === 'fold') folds += weight;
    }
    const shrink = choices / (choices + 16);
    const historical = (folds + 2.4) / (choices + 8);
    const readTrust = clamp(skill.readStrength === undefined ? .55 : skill.readStrength, 0, 1);
    const texture = context.postflop ? context.postflop.boardTexture : null;
    const street = context.streetPlan || {};
    const postflopShift = texture ? -.075 * texture.wetness +
      (street.continuation ? .045 : 0) : 0;
    const preflopReraise = context.preflop &&
      context.preflop.raiseDepth >= 2 ? -.05 : 0;
    return clamp(.25 + (price - .20) * .9 + stackFraction * .15 -
      (priorRaise ? .10 : 0) + readTrust * shrink * (historical - .30) +
      postflopShift + preflopReraise, .025, .80);
  }

  // A layer consists of contributions between successive investment caps.
  // Folded players still supply dead money but cannot win; an all-in player
  // stays eligible for the main pot even if other opponents fold to a raise.
  function payout(state, contributions, alive, showdownEquity) {
    const levels = [...new Set(contributions.filter(x => x > 0))].sort((a, b) => a - b);
    const hero = state.seat;
    let prev = 0, expected = 0, heroEligiblePot = 0;
    const initialOpponents = Math.max(1, activeOpponents(state).length);
    for (const level of levels) {
      const contributors = contributions.map((n, i) => n >= level ? i : -1).filter(i => i !== -1);
      const pot = (level - prev) * contributors.length;
      const contenders = contributors.filter(i => alive.has(i));
      prev = level;
      if (!contenders.includes(hero)) continue;
      heroEligiblePot += pot;
      const rivals = contenders.length - 1;
      // This extrapolation is heuristic; exact subset-conditioned equity
      // would require another range-weighted Monte Carlo simulation.
      const equity = rivals === 0 ? 1 : clamp(
        showdownEquity + (Math.pow(showdownEquity, rivals / initialOpponents) -
          showdownEquity) * .65, 0, 1);
      expected += pot * equity;
    }
    return { expected, heroEligiblePot };
  }

  function evaluateCall(state, equity) {
    const hero = bankroll(state, state.seat);
    const amount = state.legal.canCheck ? 0 : state.legal.callAmount;
    const contributions = state.players.map(p => p.invested);
    contributions[state.seat] += amount;
    const alive = new Set(state.players.filter(p => p.inHand && !p.folded).map(p => p.seat));
    const pots = payout(state, contributions, alive, equity);
    return { type: amount ? 'call' : 'check', cost: amount,
      ev: pots.expected - amount, payout: pots.expected, eligiblePot: pots.heroEligiblePot };
  }

  function legalRaiseTargets(state, profile = {}, context = {}) {
    const legal = state.legal;
    if (!legal.canRaise) return [];
    const hero = bankroll(state, state.seat);
    const minimum = legal.canFullRaise ? legal.minTotal : legal.maxTotal;
    const maximum = legal.maxTotal;
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) ||
        minimum > maximum || maximum <= state.currentBet) return [];
    const pot = Math.max(1, state.pot + (legal.callAmount || 0));
    const sizing = clamp(Number.isFinite(profile.sizing) ? profile.sizing : .7, .35, 1.25);
    const depth = context.preflop ? context.preflop.raiseDepth : 0;
    // 3-bet/4-bet pot-relative multiples are not ordinary flop bet sizing.
    // Use street totals for all candidates, in agreement with Game.act.
    const oop = context.preflop && ['early', 'small-blind', 'big-blind'].includes(
      context.preflop.position) ? .3 : 0;
    const multiples = depth >= 2 ? [2.15, 2.45, 2.75] :
      depth === 1 ? [2.55 + oop, 3 + oop, 3.5 + oop] : null;
    const proposed = multiples ?
      multiples.map(mult => Math.round(state.currentBet * mult)) :
      [sizing * .75, sizing, sizing * 1.2].map(mult =>
        Math.round(hero.committed + legal.toCall + pot * mult));
    const targets = [...new Set([minimum, ...proposed.map(x => clamp(x, minimum, maximum))])];
    if (maximum <= Math.max(minimum * 1.65, hero.committed + state.pot * 1.4)) targets.push(maximum);
    return [...new Set(targets)].filter(t => Number.isSafeInteger(t) && t > state.currentBet &&
      t <= maximum && (t >= legal.minTotal || t === maximum)).sort((a, b) => a - b);
  }

  function evaluateRaise(state, equity, target, skill = {}, context = {}) {
    const hero = bankroll(state, state.seat);
    const heroPaid = target - hero.committed;
    if (!state.legal.canRaise || !Number.isSafeInteger(target) ||
        target > state.legal.maxTotal || target <= state.currentBet ||
        (target < state.legal.minTotal && target !== state.legal.maxTotal) ||
        heroPaid <= 0) throw new Error('Illegal candidate raise');
    const opponents = activeOpponents(state);
    const canFold = opponents.filter(p => p.stack > 0 && target > p.committed);
    const mandatory = opponents.filter(p => !canFold.includes(p)); // all-in or already matched
    const folds = canFold.map(p => foldProbability(state, p, target, skill, context));
    let ev = 0, foldAll = 0, probabilityTotal = 0;
    const n = canFold.length;
    const count = 1 << n; // at most five opponent seats
    for (let mask = 0; mask < count; mask++) {
      let probability = 1;
      const surviving = [...mandatory];
      for (let i = 0; i < n; i++) {
        const continues = !!(mask & (1 << i));
        probability *= continues ? (1 - folds[i]) : folds[i];
        if (continues) surviving.push(canFold[i]);
      }
      if (probability === 0) continue;
      if (!surviving.length) foldAll += probability;
      const contributions = state.players.map(p => p.invested);
      contributions[state.seat] += heroPaid;
      const alive = new Set([state.seat, ...surviving.map(p => p.seat)]);
      for (const p of surviving) {
        // Current bets are street totals, not increments.
        const extra = Math.min(p.stack, Math.max(0, target - p.committed));
        contributions[p.seat] += extra;
      }
      const totalPaid = contributions.reduce((a, b) => a + b, 0);
      if (!Number.isFinite(totalPaid)) throw new Error('Invalid simulated pot');
      // Calling a large raise conveys strength; modestly discount equity
      // relative to unconditional showdown estimates (all-fold case exact).
      const texture = context.postflop ? context.postflop.boardTexture : null;
      const contested = surviving.filter(p => p.stack > 0).length;
      const calledEquity = clamp(equity - .055 * contested /
        Math.max(1, opponents.length) -
        .02 * Math.min(1, heroPaid / Math.max(1, state.pot)) -
        (texture ? texture.wetness * .02 * contested / Math.max(1, opponents.length) : 0),
        .001, 1);
      const pots = payout(state, contributions, alive, calledEquity);
      ev += probability * (pots.expected - heroPaid);
      probabilityTotal += probability;
    }
    const conditional = context.conditional && context.conditional.raises &&
      context.conditional.raises[target];
    // Retain a limited fallback component to damp Monte Carlo variance,
    // while using response-conditioned showdown outcomes for most of EV.
    const reliability = conditional && Number.isFinite(conditional.ev) ?
      clamp(conditional.trials / (conditional.trials + 9), .4, .92) : 0;
    const projectedEV = reliability ? conditional.ev * reliability + ev * (1 - reliability) : ev;
    const projectedFolds = reliability ?
      conditional.foldAll * reliability + foldAll * (1 - reliability) : foldAll;
    return { type: 'raise', amount: target, cost: heroPaid, ev: projectedEV,
      foldAll: projectedFolds, probabilityTotal, opponents: opponents.length,
      conditionalTrials: reliability ? conditional.trials : 0,
      reraiseFrequency: reliability ? conditional.reraiseFrequency || 0 : 0,
      heroReraiseFoldFrequency: reliability ? conditional.heroReraiseFoldFrequency || 0 : 0 };
  }

  // An explicit calling-station is a call-first, value-heavy style, not a
  // solver-equivalent player with a cosmetic low aggression bonus. A high
  // per-seat aggression trait progressively relaxes both selectivity and the
  // incremental EV premium; premium value hands remain eligible to raise.
  // Other archetypes retain their previous EV policy.
  function raiseDiscipline(state, equity, profile = {}, options = {}, choice = {}) {
    if (profile.style !== 'calling-station')
      return { eligible: true, premium: 0, archetype: profile.style || 'default' };
    const aggression = clamp(Number.isFinite(profile.aggression) ? profile.aggression : .25, 0, 1);
    const flexibility = clamp((aggression - .25) / .70, 0, 1);
    const pot = Math.max(1, state.pot);
    const premium = pot * (.14 - .12 * flexibility) +
      Math.max(0, Number(choice.cost) || 0) * (.065 - .045 * flexibility);
    const preflop = options.preflop;
    if (preflop) {
      const minimum = clamp(.87 - .34 * flexibility -
        Math.max(0, (Number(profile.looseness) || 0) - .075) * .12, .48, .94);
      return { eligible: preflop.percentile >= minimum, premium,
        minimum, archetype: 'calling-station', basis: 'selective-preflop-value' };
    }
    const postflop = options.postflop;
    if (postflop) {
      const value = postflop.category >= 2 ||
        (postflop.madeRole === 'top-pair' &&
          equity >= .70 - .25 * flexibility);
      const strongEquity = equity >= .79 - .27 * flexibility;
      const semiBluff = postflop.hasStrongDraw &&
        equity >= .57 - .17 * flexibility && aggression >= .54;
      return { eligible: value || strongEquity || semiBluff,
        premium, archetype: 'calling-station', basis: 'postflop-value-or-draw' };
    }
    // A public snapshot without a made-hand diagnostic may still be used
    // directly by EV consumers; this fallback relies only on hero equity.
    return { eligible: equity >= .78 - .26 * flexibility,
      premium, archetype: 'calling-station', basis: 'equity-only' };
  }
  function recommend(state, equity, profile = {}, skill = {}, options = {}) {
    if (!state || !state.legal || !state.players || !Number.isFinite(equity) ||
        equity < 0 || equity > 1) throw new Error('Invalid public action EV input');
    const baseline = evaluateCall(state, equity);
    const future = options.future;
    if (future && Number.isFinite(future.ev) &&
        future.type === baseline.type && Number.isFinite(future.trials)) {
      const previousEV = baseline.ev;
      // Sample-based continuation has variance. Blend with the previously
      // available chip-EV rather than treating one future response as certain.
      const share = clamp(future.trials / (future.trials + 10), .35, .79);
      baseline.ev = share * future.ev + (1 - share) * previousEV;
      baseline.futureTrials = future.trials;
      baseline.immediateEV = previousEV;
    }
    const choices = state.legal.canCheck ? [baseline] : [{ type: 'fold', cost: 0, ev: 0 }, baseline];
    const preflop = options.preflop || null;
    if (Number(profile.aggression) > .015 && (!preflop || !preflop.discourageRaise)) for (const target of legalRaiseTargets(state, profile, options)) {
      choices.push(evaluateRaise(state, equity, target, skill, options));
    }
    // Skill regulates EV accuracy/noise; styles regulate willingness to take
    // nearby aggressive lines. Do not turn profitable calls into irrational
    // folds simply to force a character-specific raise.
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const aggression = clamp(Number(profile.aggression) || 0, 0, 1);
    const risk = clamp(Number(profile.risk) || 0, -.08, .12);
    // Rank comparison precision is independent of equity estimate jitter.
    const noise = clamp(Number.isFinite(skill.decisionNoise) ?
      skill.decisionNoise : Number(skill.error) || 0, 0, .25);
    const pot = Math.max(1, state.pot);
    let best = null;
    const scored = choices.map(choice => {
      const street = options.streetPlan || {};
      const postflopBonus = street.semiBluff ? .075 * aggression :
        street.continuation ? .048 * aggression :
        street.trapping ? -.065 : street.danger ? -.055 : 0;
      const styleBonus = choice.type === 'raise' ?
        pot * (.10 * (aggression - .45) + .06 * (Number(profile.bluff) || 0) -
          Math.max(0, risk) * .4 + postflopBonus) : 0;
      const riskPremium = choice.type === 'raise' ?
        choice.cost * Math.max(0, .045 - equity * .045 + risk * .2) : 0;
      const uncertainty = noise * pot * (rng() * 2 - 1);
      const discipline = choice.type === 'raise' ?
        raiseDiscipline(state, equity, profile, options, choice) : null;
      const score = discipline && !discipline.eligible ? -Infinity :
        choice.ev + styleBonus - riskPremium + uncertainty -
        (discipline ? discipline.premium : 0);
      const candidate = discipline ? { ...choice, score, decisionNoise: uncertainty,
        raiseDiscipline: discipline } : { ...choice, score, decisionNoise: uncertainty };
      if (!best || candidate.score > best.score) best = candidate;
      return candidate;
    });
    // Fold/check/call are always legal when included. Game.act is still the
    // authoritative validator for chosen street-total raises.
    if (!state.legal.canFold && best.type === 'fold') best = scored.find(c => c.type === baseline.type);
    if (preflop && preflop.shouldFold && state.legal.canFold) {
      best = scored.find(c => c.type === 'fold');
    }
    // Diagnostic "policy-score regret" versus the style-aware ranking
    // with the *same estimated equity* and no per-choice score jitter.
    // This is NOT actual game-theoretic EV regret or solver ground truth.
    const eligible = scored.filter(c => Number.isFinite(c.score));
    const nominal = c => c.score - c.decisionNoise;
    const reference = eligible.reduce((a,b)=>!a || nominal(b)>nominal(a)?b:a,null);
    const policyRegret = preflop && preflop.shouldFold ? 0 :
      reference ? Math.max(0, nominal(reference)-nominal(best)) : 0;
    return { move: best, choices: scored, policyRegret };
  }

  return { foldProbability, payout, evaluateCall, evaluateRaise, legalRaiseTargets, raiseDiscipline, recommend };
});
