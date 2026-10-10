/* Felt & Fable: public-information-only AI turn choreography.
 * Never receives private cards, a proposed move, equity or hidden personality state.
 * These durations describe presentation, not the computation of an AI decision.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemTableTempo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BASE_MS = Object.freeze({
    lag: 560,
    tag: 690,
    nit: 845,
    'calling-station': 625,
    calling_station: 625,
    tricky: 820,
    balanced: 710
  });
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function randomUnit(rng) {
    const n = Number(rng());
    return clamp(Number.isFinite(n) ? n : 0.5, 0, 1);
  }

  // Only the fields named below may reach the tempo model.
  // In particular this function MUST NOT inspect players[].cards, game.deck,
  // result.ranks, or AI decision outputs.
  function publicContext(game, seat) {
    if (!game || !Array.isArray(game.players) ||
        !Number.isInteger(seat) || seat < 0 || seat >= game.players.length) {
      throw new Error('A valid active seat is required');
    }
    const legal = typeof game.legal === 'function' ? game.legal(seat) : null;
    const actions = Array.isArray(game.publicActions) ? game.publicActions : [];
    let previous = null;
    for (let i = actions.length - 1; i >= 0; i--) {
      const event = actions[i];
      if (event && event.hand === game.handNumber && event.street === game.street) {
        previous = event;
        break;
      }
    }
    return Object.freeze({
      street: clamp(finite(game.street), 0, 3),
      potBB: clamp(finite(game.pot) / Math.max(1, finite(game.bigBlind, 20)), 0, 200),
      toCallBB: clamp(finite(legal && legal.toCall) / Math.max(1, finite(game.bigBlind, 20)), 0, 200),
      opponents: game.players.reduce((n, p, i) =>
        n + (i !== seat && p.inHand && !p.folded ? 1 : 0), 0),
      // These are already-public wager events, NEVER inferred hand strength.
      facingPublicRaise: !!(previous && previous.type === 'raise' &&
        previous.seat !== seat && finite(legal && legal.toCall) > 0)
    });
  }

  // Character style is a consistent visible mannerism. The situation inputs
  // are public; the action is deliberately NOT computed until this is over.
  // A reduction in motion must never silently enable a faster/poker tell mode.
  function plan(character, situation, { rng = Math.random } = {}) {
    const style = character && typeof character.style === 'string' ? character.style : 'balanced';
    const base = BASE_MS[style] || BASE_MS.balanced;
    const info = situation || {};
    const potBB = clamp(finite(info.potBB), 0, 200);
    const toCallBB = clamp(finite(info.toCallBB), 0, 200);
    const street = clamp(finite(info.street), 0, 3);
    const opponents = clamp(finite(info.opponents), 0, 5);
    const publicPressure = (info.facingPublicRaise ? 190 : 0) +
      Math.min(170, Math.round(Math.log2(1 + potBB) * 43)) +
      Math.min(130, Math.round(Math.log2(1 + toCallBB) * 39)) +
      (street >= 2 ? 85 : street === 1 ? 35 : 0) +
      (opponents > 1 ? 55 : 0);
    const thinkMs = clamp(Math.round(base + publicPressure +
      (randomUnit(rng) - 0.5) * 250), 425, 1750);
    // Pre-action pause is neutral: it does not indicate bet/check/fold intent.
    const commitMs = Math.round(110 + randomUnit(rng) * 95);
    // A readable beat between consecutive AI turns. Human turns are immediate.
    const followMs = Math.round(205 + randomUnit(rng) * 155);
    return Object.freeze({ thinkMs, commitMs, followMs });
  }

  return { publicContext, plan, BASE_MS };
});
