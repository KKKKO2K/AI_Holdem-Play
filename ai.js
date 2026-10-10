/* Public-information-only opponent policy for offline 2–6 seat Hold'em.
 * Style controls strategy; skill controls estimation quality and calibration.
 * This is a heuristic policy, not a solver or a claim of GTO play.
 */
(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const poker = commonJs ? require('./poker') : root.Poker;
  const range = commonJs ? require('./ai-range') : root.HoldemAIRange;
  const evEngine = commonJs ? require('./ai-ev') : root.HoldemAIEV;
  const postflop = commonJs ? require('./ai-postflop') : root.HoldemAIPostflop;
  const conditional = commonJs ? require('./ai-conditional') : root.HoldemAIConditional;
  const tree = commonJs ? require('./ai-tree') : root.HoldemAITree;
  const api = factory(poker, range, evEngine, postflop, conditional, tree);
  if (commonJs) module.exports = api;
  else root.HoldemAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Poker, Range, EV, Postflop, Conditional, Tree) {
  'use strict';

  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const STYLE_ALIASES = Object.freeze({
    nit: 'nit', 'tight-passive': 'nit', 'tight passive': 'nit',
    tag: 'tag', 'tight-aggressive': 'tag', 'tight aggressive': 'tag',
    lag: 'lag', 'loose-aggressive': 'lag', 'loose aggressive': 'lag',
    'calling-station': 'calling-station', 'loose-passive': 'calling-station',
    'calling station': 'calling-station', callingstation: 'calling-station',
    'loose passive': 'calling-station',
    tricky: 'tricky', deceptive: 'tricky',
    balanced: 'balanced', adaptive: 'balanced'
  });
  const SKILL_ALIASES = Object.freeze({
    novice: 'novice', casual: 'casual', standard: 'standard', competent: 'standard', expert: 'expert'
  });
  const STYLES = Object.freeze({
    nit: Object.freeze({ aggression: .25, looseness: -.035, bluff: .012, sizing: .60, risk: .025 }),
    tag: Object.freeze({ aggression: .55, looseness: .005, bluff: .045, sizing: .69, risk: .005 }),
    lag: Object.freeze({ aggression: .69, looseness: .055, bluff: .085, sizing: .93, risk: -.02 }),
    'calling-station': Object.freeze({ aggression: .25, looseness: .075, bluff: .012, sizing: .53, risk: -.015 }),
    tricky: Object.freeze({ aggression: .49, looseness: -.005, bluff: .12, sizing: .85, risk: .005 }),
    balanced: Object.freeze({ aggression: .46, looseness: .008, bluff: .04, sizing: .72, risk: 0 })
  });
  const SKILLS = Object.freeze({
    novice: Object.freeze({ equityTrials: .42, error: .105, decisionNoise: .19, readStrength: .12, riskCalibration: 1.24 }),
    casual: Object.freeze({ equityTrials: .68, error: .065, decisionNoise: .11, readStrength: .31, riskCalibration: 1.12 }),
    standard: Object.freeze({ equityTrials: 1, error: .026, decisionNoise: .040, readStrength: .56, riskCalibration: 1 }),
    expert: Object.freeze({ equityTrials: 1.55, error: .009, decisionNoise: .006, readStrength: .82, riskCalibration: .88 })
  });
  const TRAIT_BOUNDS = Object.freeze({
    aggression: Object.freeze([0, 1]),
    looseness: Object.freeze([-.12, .12]),
    bluff: Object.freeze([0, .2]),
    sizing: Object.freeze([.35, 1.25]),
    risk: Object.freeze([-.08, .12])
  });
  const MASCOT_STYLE = Object.freeze({
    fox: 'tag', owl: 'nit', lion: 'lag', cat: 'calling-station', rabbit: 'balanced'
  });

  // Keep the prior mascot defaults intact for games that do not set aiStyle.
  // Explicit aiStyle always selects the independent archetype above.
  const PERSONALITIES = Object.freeze({
    fox: Object.freeze({ aggression: .52, looseness: .012, bluff: .055, sizing: .68, risk: 0 }),
    owl: Object.freeze({ aggression: .25, looseness: -.030, bluff: .010, sizing: .60, risk: 0 }),
    lion: Object.freeze({ aggression: .64, looseness: .020, bluff: .045, sizing: .87, risk: 0 }),
    cat: Object.freeze({ aggression: .38, looseness: .028, bluff: .035, sizing: .57, risk: 0 }),
    rabbit: Object.freeze({ aggression: .28, looseness: -.010, bluff: .018, sizing: .53, risk: 0 })
  });

  function normalizedKey(value) {
    return typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ') : '';
  }

  function normalizeStyle(value, mascot) {
    const key = normalizedKey(value);
    if (Object.hasOwn(STYLE_ALIASES, key)) return STYLE_ALIASES[key];
    const mascotKey = normalizedKey(mascot);
    return Object.hasOwn(MASCOT_STYLE, mascotKey) ? MASCOT_STYLE[mascotKey] : 'balanced';
  }

  function normalizeSkill(value) {
    const key = normalizedKey(value);
    return Object.hasOwn(SKILL_ALIASES, key) ? SKILL_ALIASES[key] : 'standard';
  }

  function stableDeviation(player, seat, style, skill) {
    const identity = [Number.isSafeInteger(seat) ? seat : 0, player.name || '',
      player.mascot || '', style, skill].join('|');
    let hash = 2166136261;
    for (let i = 0; i < identity.length; i++) {
      hash ^= identity.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 2001 / 1000 - 1) * .012;
  }

  function normalizeProfile(player = {}, seat = 0) {
    const styleKey = normalizedKey(player.aiStyle);
    const requestedStyle = Object.hasOwn(STYLE_ALIASES, styleKey) ? STYLE_ALIASES[styleKey] : undefined;
    const mascot = normalizedKey(player.mascot);
    const style = normalizeStyle(player.aiStyle, player.mascot);
    const skill = normalizeSkill(player.aiSkill);
    const base = requestedStyle ? STYLES[style] :
      (Object.hasOwn(PERSONALITIES, mascot) ? PERSONALITIES[mascot] : STYLES[style]);
    const deviation = stableDeviation(player, seat, style, skill);
    const traits = player.aiTraits && typeof player.aiTraits === 'object' ? player.aiTraits : {};
    const profile = {
      style, skill, deviation,
      aggression: clamp(base.aggression + deviation, ...TRAIT_BOUNDS.aggression),
      looseness: base.looseness,
      bluff: clamp(base.bluff + deviation * .25, ...TRAIT_BOUNDS.bluff),
      sizing: clamp(base.sizing + deviation * 2, ...TRAIT_BOUNDS.sizing),
      risk: base.risk
    };
    for (const [key, [low, high]] of Object.entries(TRAIT_BOUNDS)) {
      if (Number.isFinite(traits[key])) profile[key] = clamp(traits[key], low, high);
    }
    return profile;
  }

  function snapshot(game, seat) {
    if (!game || game.status !== 'active' || game.turn !== seat ||
        !game.players || !game.players[seat] || game.players[seat].type !== 'ai') {
      throw new Error('AI snapshot requires the acting AI seat');
    }
    const legal = game.legal(seat);
    if (!legal) throw new Error('Missing legal actions');
    const hero = game.players[seat];
    // Never inspect another seat's private cards or AI settings. The acting
    // profile is the only configuration copied into this public decision view.
    const players = game.players.map((p, i) => {
      const view = {
        seat: i, type: p.type, stack: p.stack, invested: p.invested,
        committed: p.committed, inHand: p.inHand, folded: p.folded
      };
      if (i === seat) {
        view.name = p.name;
        view.mascot = p.mascot;
        view.aiStyle = typeof p.aiStyle === 'string' ? p.aiStyle : undefined;
        view.aiSkill = typeof p.aiSkill === 'string' ? p.aiSkill : undefined;
        view.aiTraits = {};
        for (const key of Object.keys(TRAIT_BOUNDS)) {
          if (p.aiTraits && Number.isFinite(p.aiTraits[key])) view.aiTraits[key] = p.aiTraits[key];
        }
      }
      return view;
    });
    const actions = (game.publicActions || []).slice(-240).map(a => ({
      hand: a.hand, street: a.street, seat: a.seat, type: a.type,
      paid: a.paid, facing: a.facing, potBefore: a.potBefore, raiseTo: a.raiseTo
    }));
    return {
      seat, handNumber: game.handNumber, street: game.street,
      button: game.button, smallBlind: game.smallBlind, bigBlind: game.bigBlind,
      pot: game.pot, currentBet: game.currentBet,
      board: game.board.map(c => ({ rank: c.rank, suit: c.suit })),
      hole: hero.cards.map(c => ({ rank: c.rank, suit: c.suit })),
      legal: { ...legal }, players, actions
    };
  }


  // Opening/calling ranges are separate from pot-odds and showdown equity.
  // The percentile describes a hole-card CLASS among 1,326 two-card
  // combinations (not the chance to win at showdown).
  const PREFLOP_ENTRY = Object.freeze({
    nit: .80, tag: .70, lag: .52, 'calling-station': .50,
    tricky: .66, balanced: .61
  });
  let preflopScores = null;

  function preflopPercentile(hole) {
    if (!Array.isArray(hole) || hole.length !== 2) throw new Error('Expected two hole cards');
    if (!preflopScores) {
      const cards = Poker.deck(), scores = [];
      for (let i = 0; i < cards.length - 1; i++)
        for (let j = i + 1; j < cards.length; j++)
          scores.push(Range.preflopStrength(cards[i], cards[j]));
      preflopScores = scores.sort((a, b) => a - b);
    }
    const score = Range.preflopStrength(hole[0], hole[1]);
    let low = 0, high = preflopScores.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (preflopScores[middle] < score - 1e-9) low = middle + 1;
      else high = middle;
    }
    const first = low;
    high = preflopScores.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (preflopScores[middle] <= score + 1e-9) low = middle + 1;
      else high = middle;
    }
    return (first + low) / (2 * preflopScores.length);
  }

  function preflopPosition(state) {
    const seats = state.players.filter(p => p.inHand).map(p => p.seat).sort((a, b) => a - b);
    const n = seats.length;
    const button = seats.indexOf(state.button);
    if (button < 0 || !seats.includes(state.seat)) return { label: 'unknown', adjustment: 0 };
    const sequence = seats.slice(button + 1).concat(seats.slice(0, button + 1));
    if (n === 2) {
      return state.seat === state.button ?
        { label: 'heads-up-button', adjustment: -.16 } :
        { label: 'heads-up-big-blind', adjustment: -.12 };
    }
    if (state.seat === state.button) return { label: 'button', adjustment: -.075 };
    if (state.seat === sequence[0]) return { label: 'small-blind', adjustment: .025 };
    if (state.seat === sequence[1]) return { label: 'big-blind', adjustment: -.10 };
    const index = sequence.indexOf(state.seat);
    const lateFraction = (index - 2) / Math.max(1, n - 3);
    return { label: index === 2 ? 'early' : index === n - 2 ? 'cutoff' : 'middle',
      adjustment: .065 - lateFraction * .14 };
  }

  function preflopPlan(state, profile, equity, required) {
    if (state.street !== 0) return null;
    const percentile = preflopPercentile(state.hole);
    const position = preflopPosition(state);
    const facingRaises = (state.actions || []).filter(a =>
      a.hand === state.handNumber && a.street === 0 &&
      a.seat !== state.seat && a.type === 'raise').length;
    const hero = state.players[state.seat];
    const stackInBlinds = (hero.stack + hero.invested) / Math.max(1, state.bigBlind);
    const facing = Math.max(0, state.legal.toCall);
    const priceInBlinds = facing / Math.max(1, state.bigBlind);
    const pressure = facingRaises * .09 +
      Math.max(0, Math.log2(Math.max(1, priceInBlinds))) * .028;
    // Include the hero's prior raise: when Hero opens and faces a 3-bet,
    // Hero's next raise is a 4-bet, even though only one rival raised.
    const raisesInHand = (state.actions || []).filter(a =>
      a.hand === state.handNumber && a.street === 0 && a.type === 'raise').length;
    const raiseDepth = facing > 0 ? Math.min(2, raisesInHand) : 0;
    const response = raiseDepth === 0 ? 'open' :
      raiseDepth === 1 ? '3-bet' : '4-bet+';
    const shallow = stackInBlinds < 14 ? .065 : 0;
    const entryThreshold = clamp(
      (PREFLOP_ENTRY[profile.style] || PREFLOP_ENTRY.balanced) +
      position.adjustment + pressure + shallow - profile.looseness, .24, .96
    );
    // An exceptionally favorable equity/price gap overrides rough starting
    // hand selection; real pot odds remain the final economic constraint.
    const profitableOverride = equity >= required + .13;
    // Opening, 3-bet and 4-bet ranges are distinct. Reraises are more
    // selective than calling, but a loose-aggressive profile can still
    // take light 3-bets in position. No opposing private cards are read.
    const styleReraise = {
      nit: [.925, .975], tag: [.845, .96], lag: [.735, .915],
      'calling-station': [.92, .98], tricky: [.80, .945],
      balanced: [.855, .96]
    }[profile.style] || [.855, .96];
    const reraiseIndex = Math.max(0, raiseDepth - 1);
    const reraiseFloor = styleReraise[reraiseIndex] +
      Math.max(0, position.adjustment) * .3 -
      Math.min(0, profile.looseness) * .25 +
      (stackInBlinds < 12 ? .025 : 0);
    const raiseThreshold = raiseDepth > 0 ?
      clamp(reraiseFloor, .62, .997) : entryThreshold;
    const facingRangeGap = facing > 0 &&
      percentile < entryThreshold + (facingRaises > 0 ? .14 : .07) && equity < .88;
    const rejectReraise = raiseDepth > 0 && percentile < raiseThreshold;
    return {
      percentile, entryThreshold, raiseThreshold, response, raiseDepth,
      position: position.label, facingRaises, stackInBlinds,
      shouldFold: facing > 0 && percentile < entryThreshold && !profitableOverride,
      discourageRaise: facingRangeGap || rejectReraise
    };
  }

  function opponentRead(state, skill = SKILLS.standard) {
    const opponents = state.players.filter(p => p.seat !== state.seat && p.inHand && !p.folded);
    const opponentSeats = new Set(opponents.map(p => p.seat));
    const recent = state.actions.filter(a => a.hand === state.handNumber && a.street === state.street &&
      opponentSeats.has(a.seat));
    const currentRaises = recent.filter(a => a.type === 'raise').length;
    let historicalFolds = 0, decisions = 0, historicalRaises = 0, historicalCalls = 0;
    for (const a of state.actions) {
      if (!opponentSeats.has(a.seat)) continue;
      if (a.type === 'fold' || a.type === 'call' || a.type === 'raise') {
        decisions++;
        if (a.type === 'fold') historicalFolds++;
        if (a.type === 'raise') historicalRaises++;
        if (a.type === 'call') historicalCalls++;
      }
    }
    const confidence = clamp((decisions - 3) / 20, 0, 1);
    const foldRate = decisions ? historicalFolds / decisions : 0;
    const raiseRate = decisions ? historicalRaises / decisions : 0;
    const callRate = decisions ? historicalCalls / decisions : 0;
    const rawPressure = clamp(currentRaises * .023 + confidence *
      ((foldRate - .25) * .012 + (raiseRate - .25) * .032), 0, .10);
    return {
      count: opponents.length, pressure: rawPressure * skill.readStrength,
      rawPressure, foldRate, raiseRate, callRate, confidence, currentRaises
    };
  }

  function eligiblePot(state, callAmount) {
    // A short stack cannot win contributions above its post-call all-in cap.
    const hero = state.players[state.seat];
    const cap = hero.invested + callAmount;
    return state.players.reduce((sum, p) => sum + Math.min(p.invested, cap), 0);
  }

  function trialsFor(opponents, skill) {
    const base = opponents >= 4 ? 58 : opponents === 3 ? 76 : opponents === 2 ? 98 : 132;
    return clamp(Math.round(base * skill.equityTrials), 24, 240);
  }

  function postflopPosition(state) {
    const active = state.players.filter(p => p.inHand && !p.folded && p.stack > 0)
      .map(p => p.seat)
      .sort((a, b) => {
        const da = (a - state.button + state.players.length) % state.players.length || state.players.length;
        const db = (b - state.button + state.players.length) % state.players.length || state.players.length;
        return da - db;
      });
    const index = active.indexOf(state.seat);
    return { index, count: active.length, late: index >= 0 && index === active.length - 1 };
  }

  function fallbackAction(legal, analysis) {
    if (legal.canCheck) return { type: 'check', analysis };
    if (legal.canCall) return { type: 'call', analysis };
    if (legal.canFold) return { type: 'fold', analysis };
    throw new Error('No legal fallback action in AI snapshot');
  }

  function decision(state, opts = {}) {
    if (!state || !state.legal || !Array.isArray(state.hole) || state.hole.length !== 2 ||
        !Array.isArray(state.board) || !Array.isArray(state.players) ||
        !state.players[state.seat]) throw new Error('Invalid AI information snapshot');

    const rng = opts.rng || Math.random;
    const profile = normalizeProfile(state.players[state.seat], state.seat);
    // Keep the old opts.difficulty knob working while player aiSkill remains
    // the persistent, orthogonal per-seat setting.
    const skillName = opts.difficulty ? normalizeSkill(opts.difficulty) : profile.skill;
    const skill = SKILLS[skillName];
    const read = opponentRead(state, skill);
    const legal = state.legal;
    const toCall = Math.max(0, legal.toCall);
    const callAmount = Math.max(0, legal.callAmount);
    const stack = state.players[state.seat].stack;
    const trials = trialsFor(read.count, skill);
    const estimated = typeof opts.equityFn === 'function'
      ? opts.equityFn(state.hole, state.board, trials, rng, Math.max(1, read.count))
      : Range.equity(state, { trials, rng, trust: skill.readStrength });
    if (!Number.isFinite(estimated) || estimated < 0 || estimated > 1) {
      throw new Error('Equity estimate unavailable');
    }
    const equity = clamp(estimated + (rng() - .5) * 2 * skill.error, 0, 1);
    const baseline = 1 / (read.count + 1);
    const advantage = equity - baseline;
    const eligible = eligiblePot(state, callAmount);
    const potOdds = toCall > 0 ? callAmount / Math.max(1, eligible + callAmount) : 0;
    const postflop = state.street > 0;
    const position = postflop ? postflopPosition(state) : { index: -1, count: 0, late: false };
    const latePosition = position.late;
    const risk = ((toCall > 0 ? .025 : 0) + read.pressure +
      (read.count > 1 ? .016 : 0) - profile.looseness + profile.risk) * skill.riskCalibration;
    const required = clamp(potOdds + risk, 0, 1);
    const analysis = {
      equity, baseline, potOdds, required, eligiblePot: eligible, opponents: read.count,
      pressure: read.pressure, rawPressure: read.rawPressure, advantage,
      style: profile.style, skill: skillName, trust: skill.readStrength, trials,
      position: position.index, latePosition, deviation: profile.deviation
    };
    const preflop = preflopPlan(state, profile, equity, required);
    if (preflop) analysis.preflop = preflop;
    const postflopRead = postflop ? Postflop.inspect(state) : null;
    const streetPlan = postflopRead ? Postflop.streetPlan(state, postflopRead, profile) : null;
    if (postflopRead) analysis.postflop = { ...postflopRead, plan: streetPlan };
    const context = { rng, preflop, postflop: postflopRead, streetPlan };
    const raiseSelectivity = EV.raiseDiscipline(state, equity, profile, context);
    if (profile.style === 'calling-station')
      analysis.raiseSelectivity = { eligible: raiseSelectivity.eligible,
        basis: raiseSelectivity.basis, minimum: raiseSelectivity.minimum || null };
    // The optional legacy equity injection is intentionally not mixed with
    // independently sampled conditional ranges: tests and callers can still
    // force one consistent showdown-equity value for every action.
    if (raiseSelectivity.eligible && typeof opts.equityFn !== 'function' && profile.aggression > .015 &&
        !(preflop && preflop.discourageRaise) && legal.canRaise) {
      const targets = EV.legalRaiseTargets(state, profile, context);
      if (targets.length) {
        const simulated = Conditional.simulate(state, {
          targets, rng, heroEquity: equity, trust: skill.readStrength, skill, context,
          trials: Math.max(18, Math.min(70, Math.round(trials * .4)))
        });
        context.conditional = simulated;
        analysis.conditional = { trials: simulated.trials,
          targets: Object.keys(simulated.raises).length };
      }
    }
    // One additional heads-up decision node after a check/call. No opponent
    // private cards are disclosed to the hero's future defend policy.
    if (typeof opts.equityFn !== 'function' && postflop &&
        Tree.legalOpportunity(state)) {
      const future = Tree.simulate(state, {
        rng, equity, trust: skill.readStrength,
        trials: Math.max(14, Math.min(38, Math.round(trials * .25)))
      });
      if (future) {
        context.future = future;
        analysis.future = { trials: future.trials, node: future.node,
          betFrequency: future.betFrequency, defendFrequency: future.defendFrequency,
          secondBetFrequency: future.secondBetFrequency,
          secondDefendFrequency: future.secondDefendFrequency, depth: future.depth };
      }
    }
    const policy = EV.recommend(state, equity, profile, skill, context);
    analysis.actionEV = {
      fold: 0,
      safeAction: policy.choices.find(choice => choice.type === 'call' || choice.type === 'check'),
      raises: policy.choices.filter(choice => choice.type === 'raise'),
      selectedEV: policy.move.ev, estimatedPolicyRegret: policy.policyRegret
    };
    const move = { type: policy.move.type, analysis };
    if (policy.move.type === 'raise') move.amount = policy.move.amount;
    return move;
  }
  function act(game, seat, opts = {}) {
    const move = decision(snapshot(game, seat), opts);
    game.act(seat, move.type, move.amount);
    return move;
  }

  return {
    snapshot, decision, act, eligiblePot, opponentRead, normalizeProfile,
    normalizeStyle, normalizeSkill, trialsFor, postflopPosition, preflopPlan, preflopPercentile,
    EV, Postflop, Conditional, Tree, PERSONALITIES, STYLES, SKILLS, DIFFICULTY: SKILLS, TRAIT_BOUNDS, MASCOT_STYLE
  };
});
