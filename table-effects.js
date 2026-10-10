/* Felt & Fable: purely presentational turn/pot/chip movement.
 * Never changes game state or reads any hidden cards. Uses public action events.
 * The pot amount is authoritative from game.js; chip icons represent scale only.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemTableEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function potSize(game) {
    const live = game && Number(game.pot);
    return Number.isFinite(live) && live > 0 ? live : 0;
  }

  // Visual impression of chip volume, not a representation of denominations.
  function chipCount(pot) {
    if (!(Number(pot) > 0)) return 0;
    return Math.min(16, Math.max(4, Math.ceil(Math.log2(1 + pot / 20) * 2.5)));
  }

  function publicChipActions(game, cursor) {
    const actions = game && Array.isArray(game.publicActions) ? game.publicActions : [];
    return actions.slice(Math.max(0, cursor)).filter(event =>
      event && event.hand === game.handNumber &&
      Number.isInteger(event.seat) && event.seat >= 0 &&
      Number.isFinite(event.paid) && event.paid > 0);
  }

  // Read only engine-authored awards. Do not derive shares, odd chips, or
  // seat totals in this presentation layer.
  function publicPayoutAwards(settlement) {
    if (!settlement || !Number.isInteger(settlement.hand) ||
        !['fold', 'showdown'].includes(settlement.reason) ||
        !Array.isArray(settlement.pots)) return [];
    const awards = [], potIndices = new Set();
    for (const pot of settlement.pots) {
      if (!pot || !Number.isInteger(pot.index) || pot.index < 0 ||
          !Number.isInteger(pot.amount) || pot.amount <= 0 ||
          !Array.isArray(pot.awards) || !pot.awards.length ||
          potIndices.has(pot.index)) return [];
      potIndices.add(pot.index);
      const seats = new Set();
      for (const award of pot.awards) {
        if (!award || !Number.isInteger(award.seat) || award.seat < 0 ||
            !Number.isInteger(award.amount) || award.amount <= 0 ||
            seats.has(award.seat)) return [];
        seats.add(award.seat);
        awards.push({ potIndex: pot.index, seat: award.seat, amount: award.amount });
      }
    }
    return awards;
  }

  function create(options) {
    const stage = options.stage;
    const pile = options.pile;
    const potPill = options.potPill;
    const indicator = options.indicator;
    const panel = options.panel;
    let previousGame = null;
    let previousHand = null;
    let previousActionCount = 0;
    let previousPot = -1;
    const flights = new Set();
    const effectAnimations = new Set();
    const settledHands = new WeakSet();
    const motionQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function motionAllowed() {
      return typeof document !== 'undefined' && !document.hidden &&
        !(motionQuery && motionQuery.matches);
    }

    function clearFlights() {
      effectAnimations.forEach(animation => {
        if (animation && typeof animation.cancel === 'function') animation.cancel();
      });
      effectAnimations.clear();
      flights.forEach(node => {
        if (node.getAnimations) node.getAnimations().forEach(a => a.cancel());
        node.remove();
      });
      flights.clear();
    }

    function paintPot(pot) {
      if (pot === previousPot) return;
      const count = chipCount(pot);
      pile.innerHTML = Array.from({ length: count }, (_, i) =>
        '<i class="pot-chip-token" style="--column:' + (i % 2) +
        ';--level:' + Math.floor(i / 2) + '"></i>').join('');
      pile.dataset.count = String(count);
      pile.dataset.amount = String(pot);
      if (pot > previousPot && previousPot >= 0 && motionAllowed() && potPill.animate) {
        const animation = potPill.animate([
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.07)', filter: 'brightness(1.27)' },
          { transform: 'scale(1)', filter: 'brightness(1)' }
        ], { duration: 460, easing: 'ease-out' });
        effectAnimations.add(animation);
        const remove = () => effectAnimations.delete(animation);
        animation.onfinish = remove;
        animation.oncancel = remove;
      }
      previousPot = pot;
    }

    function flyChips(seat, paid) {
      if (!motionAllowed() || !(paid > 0) || !stage.isConnected ||
          !pile.isConnected || typeof stage.getBoundingClientRect !== 'function') return;
      const from = stage.querySelector('.seat[data-seat-index="' + seat + '"]');
      if (!from) return;
      const container = stage.getBoundingClientRect();
      const origin = from.getBoundingClientRect();
      const destination = pile.getBoundingClientRect();
      if (!container.width || !origin.width || !destination.width) return;
      const x0 = origin.left - container.left + origin.width / 2;
      const y0 = origin.top - container.top + origin.height / 2;
      const x1 = destination.left - container.left + destination.width / 2;
      const y1 = destination.top - container.top + destination.height / 2;
      const count = paid >= 100 ? 3 : paid >= 40 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const chip = document.createElement('span');
        chip.className = 'chip-flight';
        chip.setAttribute('aria-hidden', 'true');
        chip.style.left = x0 + 'px';
        chip.style.top = y0 + 'px';
        stage.appendChild(chip);
        flights.add(chip);
        if (!chip.animate) { chip.remove(); flights.delete(chip); continue; }
        const dx = x1 - x0 + (n - 1) * 5;
        const dy = y1 - y0 + (n - 1) * 3;
        const anim = chip.animate([
          { transform: 'translate(-50%, -50%) scale(.85)', opacity: 0.95, offset: 0 },
          { transform: 'translate(calc(-50% + ' + (dx * .52) + 'px), calc(-50% + ' + (dy * .52 - 28) + 'px)) scale(1.18)', opacity: 1, offset: .52 },
          { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.68)', opacity: 0, offset: 1 }
        ], { duration: 530, delay: n * 65, easing: 'ease-in-out', fill: 'forwards' });
        const remove = () => { chip.remove(); flights.delete(chip); };
        anim.onfinish = remove;
        anim.oncancel = remove;
      }
    }

    function flyPayouts(settlement) {
      const awards = publicPayoutAwards(settlement);
      if (!awards.length || !motionAllowed() || !stage.isConnected ||
          !pile.isConnected || typeof stage.getBoundingClientRect !== 'function') return;
      const container = stage.getBoundingClientRect();
      const origin = pile.getBoundingClientRect();
      if (!container.width || !origin.width) return;
      const x0 = origin.left - container.left + origin.width / 2;
      const y0 = origin.top - container.top + origin.height / 2;
      awards.forEach((award, order) => {
        const recipient = stage.querySelector('.seat[data-seat-index="' + award.seat + '"]');
        if (!recipient || !recipient.isConnected) return;
        const destination = recipient.getBoundingClientRect();
        if (!destination.width) return;
        const x1 = destination.left - container.left + destination.width / 2;
        const y1 = destination.top - container.top + destination.height / 2;
        const chip = document.createElement('span');
        chip.className = 'chip-flight payout-chip-flight';
        chip.setAttribute('aria-hidden', 'true');
        chip.dataset.potIndex = String(award.potIndex);
        chip.dataset.seat = String(award.seat);
        chip.dataset.amount = String(award.amount);
        chip.style.left = x0 + 'px';
        chip.style.top = y0 + 'px';
        stage.appendChild(chip);
        flights.add(chip);
        if (!chip.animate) { chip.remove(); flights.delete(chip); return; }
        const dx = x1 - x0, dy = y1 - y0;
        const anim = chip.animate([
          { transform: 'translate(-50%, -50%) scale(.72)', opacity: 0, offset: 0 },
          { transform: 'translate(calc(-50% + ' + (dx * .54) + 'px), calc(-50% + ' + (dy * .54 - 24) + 'px)) scale(1.12)', opacity: 1, offset: .54 },
          { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.82)', opacity: 0, offset: 1 }
        ], { duration: 560, delay: Math.min(90, order * 3), easing: 'ease-in-out', fill: 'forwards' });
        const remove = () => { chip.remove(); flights.delete(chip); };
        anim.onfinish = remove;
        anim.oncancel = remove;
      });
    }

    function renderTurn(game, viewer, blocked) {
      const active = !!game && game.status === 'active' && game.players[game.turn];
      const player = active ? game.players[game.turn] : null;
      const ready = !!player && player.type === 'human' && viewer === game.turn && !blocked;
      const state = !active ? 'complete' : player.type === 'ai' ? 'ai' :
        ready ? 'human' : 'handoff';
      panel.dataset.turnState = state;
      stage.dataset.turnState = state;
      indicator.hidden = !active;
      indicator.textContent = !active ? '' : state === 'human' ? '✦ YOUR TURN' :
        state === 'ai' ? (player.name + ' · AI TURN') : 'PRIVATE HAND · PASS DEVICE';
    }

    function render(game, info) {
      const changedHand = previousGame !== game || previousHand !== game.handNumber;
      const events = Array.isArray(game.publicActions) ? game.publicActions : [];
      if (changedHand) {
        clearFlights();
        previousGame = game;
        previousHand = game.handNumber;
        previousActionCount = events.length;
        previousPot = -1;
      }
      const blocked = !!info.blocked;
      if (blocked || game.status === 'matchover') clearFlights();
      renderTurn(game, info.viewer, blocked);
      paintPot(potSize(game));
      const fresh = changedHand ? [] : publicChipActions(game, previousActionCount);
      previousActionCount = events.length;
      // The action that settles a hand is represented by payout flights below,
      // never by a second seat-to-pot bet flight.
      if (!blocked && game.status === 'active' && fresh.length) {
        fresh.slice(-3).forEach(event => flyChips(event.seat, event.paid));
      }
      const settlement = game.status === 'finished' && game.result &&
        game.result.publicSettlement;
      if (settlement && settlement.hand === game.handNumber &&
          !settledHands.has(settlement)) {
        settledHands.add(settlement);
        if (!blocked) flyPayouts(settlement);
      }
    }

    function onVisibilityChange() {
      if (document.hidden) clearFlights();
    }
    function onMotionChange(event) {
      if (event.matches) clearFlights();
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener('change', onMotionChange);
    }

    function destroy() {
      clearFlights();
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (motionQuery && motionQuery.removeEventListener) {
        motionQuery.removeEventListener('change', onMotionChange);
      }
    }

    return { render, clearFlights, destroy };
  }

  return { create, potSize, chipCount, publicChipActions, publicPayoutAwards };
});
