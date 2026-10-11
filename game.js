/* Offline 2–6 seat no-limit Texas Hold'em. Raise amounts are street TOTALS.
 * Raise/reopening rules: https://www.pokertda.com/view-poker-tda-rules/
 * Short opening wagers: https://www.pokertda.com/forum/index.php?topic=842.0
 */
(function (root, factory) {
  const dep = typeof module === 'object' && module.exports ? require('./poker') : root.Poker;
  const api = factory(dep);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Poker) {
  'use strict';
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const STREET_NAMES = ['Preflop', 'Flop', 'Turn', 'River'];
  const integer = (n, minimum = 0) => Number.isSafeInteger(n) && n >= minimum;

  class Game {
    constructor(opts = {}) {
      this.initialStack = opts.stack === undefined ? 1500 : opts.stack;
      this.smallBlind = opts.smallBlind === undefined ? 10 : opts.smallBlind;
      this.bigBlind = opts.bigBlind === undefined ? 20 : opts.bigBlind;
      if (!integer(this.initialStack, 1) || !integer(this.smallBlind, 1) ||
          !integer(this.bigBlind, this.smallBlind)) throw new Error('Invalid stacks or blinds');
      this.rng = opts.rng || Math.random;
      const roster = opts.players || [
        { name: 'YOU', type: 'human', mascot: 'rabbit' },
        { name: 'NOVA', type: 'ai', mascot: 'fox' }
      ];
      if (!Array.isArray(roster) || roster.length < 2 || roster.length > 6) throw new Error('Choose 2–6 seats');
      this.roster = roster.map((p, i) => {
        const stack = p.stack === undefined ? this.initialStack : p.stack;
        if (!integer(stack)) throw new Error('Invalid player stack');
        const type = p.type || (i === 0 ? 'human' : 'ai');
        if (!['human', 'ai'].includes(type)) throw new Error('Invalid seat type');
        // Keep requested engine settings independent of the presentation mascot.
        // The AI resolves aliases/defaults and bounds these finite trait overrides.
        const aiTraits = {};
        for (const key of ['aggression', 'looseness', 'bluff', 'sizing', 'risk']) {
          if (p.aiTraits && Number.isFinite(p.aiTraits[key])) aiTraits[key] = p.aiTraits[key];
        }
        return { name: String(p.name || `Guest ${i + 1}`), type, mascot: p.mascot || 'fox', stack,
          aiStyle: typeof p.aiStyle === 'string' ? p.aiStyle : undefined,
          aiSkill: typeof p.aiSkill === 'string' ? p.aiSkill : undefined, aiTraits };
      });
      this.totalChips = this.roster.reduce((sum, p) => sum + p.stack, 0);
      if (!integer(this.totalChips)) throw new Error('Chip total exceeds safe integer range');
      this.reset(opts.deferInitialHand === true);
    }

    reset(deferInitialHand = false) {
      this.players = this.roster.map(p => ({ ...p, aiTraits: { ...p.aiTraits }, cards: [], committed: 0, invested: 0,
        folded: false, acted: false, actedAt: null, inHand: false, eliminated: p.stack === 0 }));
      this.button = this.players.length - 1;
      this.sb = -1; this.bb = -1; this.handNumber = 0; this.previousSeatCount = 0;
      this.pot = 0; this.street = 0; this.board = []; this.burns = []; this.deck = [];
      this.status = 'idle'; this.turn = -1; this.winner = null; this.result = null;
      this.logs = []; this.history = []; this.refunds = []; this.publicActions = [];
      this.stats = { played: 0, wins: 0, losses: 0, ties: 0 };
      if (!deferInitialHand) this.startHand();
    }

    // A completed-hand checkpoint contains NO cards, deck, burns, private
    // ranks, in-progress wagers or future RNG. Restoring begins the NEXT hand.
    // Never try to reconstruct an unfinished hand from untrusted localStorage.
    boundary() {
      if (this.status !== 'finished' || !this.result) return null;
      this.assertConservation();
      return Object.freeze({version:1,hand:this.handNumber,button:this.button,
        bb:this.bb,previousSeatCount:this.previousSeatCount,
        totalChips:this.totalChips,stacks:this.players.map(p=>p.stack),
        // AI.snapshot consumes the most recent 240 PUBLIC betting actions.
        // Restore them to preserve range/behavior reads without private cards.
        publicActions:this.publicActions.slice(-240).map(a=>({
          hand:a.hand,street:a.street,seat:a.seat,type:a.type,
          paid:a.paid,facing:a.facing,potBefore:a.potBefore,raiseTo:a.raiseTo
        })),
        stats:{...this.stats}});
    }

    restoreBoundary(saved) {
      if (this.status !== 'idle' || this.handNumber !== 0) throw Error('Restore requires a deferred new match');
      if (!saved || saved.version !== 1 || !integer(saved.hand,1) ||
          !integer(saved.totalChips,1) || saved.totalChips!==this.totalChips ||
          !Array.isArray(saved.stacks) || saved.stacks.length!==this.players.length ||
          saved.stacks.some(n=>!integer(n)) ||
          saved.stacks.reduce((a,b)=>a+b,0)!==this.totalChips ||
          !Number.isInteger(saved.button) || saved.button<0 || saved.button>=this.players.length ||
          !Number.isInteger(saved.bb) || saved.bb<0 || saved.bb>=this.players.length ||
          !integer(saved.previousSeatCount,2) || saved.previousSeatCount>this.players.length ||
          !saved.stats || !['played','wins','losses','ties'].every(k=>integer(saved.stats[k])) ||
          !Array.isArray(saved.publicActions) || saved.publicActions.length>240 ||
          saved.publicActions.some(a=>!a || !integer(a.hand,1) ||
            a.hand>saved.hand || !Number.isInteger(a.street) ||
            a.street<0 || a.street>3 || !integer(a.seat) ||
            a.seat>=this.players.length || !['fold','check','call','raise'].includes(a.type) ||
            !integer(a.paid) || !integer(a.facing) ||
            !integer(a.potBefore) || a.raiseTo!==null && !integer(a.raiseTo)))
        throw Error('Invalid finished-hand checkpoint');
      this.players.forEach((p,i)=>{p.stack=saved.stacks[i];p.eliminated=p.stack===0;});
      this.handNumber=saved.hand;
      this.button=saved.button;
      this.bb=saved.bb;
      this.previousSeatCount=saved.previousSeatCount;
      this.stats=Object.fromEntries(['played','wins','losses','ties'].map(k=>[k,saved.stats[k]]));
      this.publicActions=saved.publicActions.map(a=>({
        hand:a.hand,street:a.street,seat:a.seat,type:a.type,
        paid:a.paid,facing:a.facing,potBefore:a.potBefore,raiseTo:a.raiseTo
      }));
      this.assertConservation();
      this.status='finished';
      // Use the real dealer/blind-advancement rules to start one fresh hand.
      return this.startHand();
    }

    // New tournament entries and a human's approved rebuy occur ONLY once all
    // current-hand bets have settled. A new buy-in adds real practice chips
    // to the match supply; it never modifies pot, deck, or any active wager.
    replaceEliminatedSeat(index, entrant) {
      if (!['finished', 'matchover'].includes(this.status) || this.pot !== 0)
        throw Error('A new entry requires a settled hand boundary');
      if (!Number.isInteger(index) || index < 0 || index >= this.players.length ||
          this.players[index].stack !== 0) throw Error('Seat is not eliminated');
      if (!entrant || !['human', 'ai'].includes(entrant.type))
        throw Error('A valid incoming seat is required');
      const stack = entrant.stack === undefined ? this.initialStack : entrant.stack;
      if (!integer(stack, 1) || stack !== this.initialStack ||
          !Number.isSafeInteger(this.totalChips + stack))
        throw Error('Invalid tournament starting stack');
      const aiTraits = {};
      for (const key of ['aggression', 'looseness', 'bluff', 'sizing', 'risk'])
        if (entrant.aiTraits && Number.isFinite(entrant.aiTraits[key]))
          aiTraits[key] = entrant.aiTraits[key];
      const incoming = {
        name: String(entrant.name || 'Guest ' + (index + 1)).slice(0, 36),
        type: entrant.type, mascot: entrant.mascot || 'fox', stack,
        aiStyle: typeof entrant.aiStyle === 'string' ? entrant.aiStyle : undefined,
        aiSkill: typeof entrant.aiSkill === 'string' ? entrant.aiSkill : undefined,
        aiTraits
      };
      this.roster[index] = { ...incoming, aiTraits: { ...aiTraits } };
      this.players[index] = { ...incoming, aiTraits: { ...aiTraits },
        cards: [], committed: 0, invested: 0, folded: false, acted: false,
        actedAt: null, inHand: false, eliminated: false };
      this.totalChips += stack;
      this.assertConservation();
      return this.players[index];
    }

    note(message, kind = 'info') {
      this.logs.unshift({ message, kind, street: STREET_NAMES[this.street] });
      this.logs = this.logs.slice(0, 40);
    }

    next(index, predicate) {
      for (let offset = 1; offset <= this.players.length; offset++) {
        const candidate = (index + offset + this.players.length) % this.players.length;
        if (predicate(this.players[candidate], candidate)) return candidate;
      }
      return -1;
    }

    live() { return this.players.map((p, i) => p.inHand && !p.folded ? i : -1).filter(i => i >= 0); }
    funded() { return this.live().filter(i => this.players[i].stack > 0); }

    contribute(index, amount) {
      if (!integer(amount)) throw new Error('Contributions must be whole chips');
      const p = this.players[index], paid = Math.min(p.stack, amount);
      p.stack -= paid; p.committed += paid; p.invested += paid; this.pot += paid;
      return paid;
    }

    startHand() {
      if (this.status === 'active') throw new Error('Current hand still active');
      const seats = this.players.map((p, i) => p.stack > 0 ? i : -1).filter(i => i >= 0);
      this.players.forEach(p => { p.eliminated = p.stack === 0; });
      if (seats.length < 2) {
        this.status = 'matchover'; this.turn = -1; this.winner = seats[0] === undefined ? null : seats[0];
        this.assertConservation();
        return false;
      }
      // Home-game moving button: with 3+ seats, dealer and blinds advance past
      // eliminated seats rather than retaining an empty/dead dealer position.
      // On the transition to heads-up advance the BB, avoiding two consecutive BBs.
      if (seats.length === 2 && this.previousSeatCount > 2) {
        this.bb = this.next(this.bb, p => p.stack > 0);
        this.button = seats.find(i => i !== this.bb);
      } else this.button = this.next(this.button, p => p.stack > 0);
      this.sb = seats.length === 2 ? this.button : this.next(this.button, p => p.stack > 0);
      this.bb = this.next(this.sb, p => p.stack > 0);
      this.previousSeatCount = seats.length;
      this.players.forEach(p => {
        p.cards = []; p.committed = 0; p.invested = 0; p.folded = false;
        p.acted = false; p.actedAt = null; p.inHand = p.stack > 0;
      });
      this.handNumber++; this.stats.played++;
      this.board = []; this.burns = []; this.pot = 0; this.street = 0;
      this.currentBet = this.bigBlind; this.lastFullRaise = this.bigBlind;
      this.deck = Poker.shuffle(Poker.deck(), this.rng);
      // First card left of the button; in heads-up this is the BB.
      const first = this.next(this.button, p => p.inHand);
      for (let round = 0; round < 2; round++) {
        let seat = first;
        do { this.players[seat].cards.push(this.deck.pop()); seat = this.next(seat, p => p.inHand); } while (seat !== first);
      }
      this.contribute(this.sb, this.smallBlind); this.contribute(this.bb, this.bigBlind);
      this.status = 'active'; this.turn = -1; this.winner = null; this.result = null;
      this.refunds = []; this.logs = [];
      this.note(`Hand #${this.handNumber} · blinds ${this.smallBlind}/${this.bigBlind}`);
      this.note(`${this.players[this.sb].name} SB ${this.players[this.sb].committed} · ${this.players[this.bb].name} BB ${this.players[this.bb].committed}`);
      this.advance(this.bb);
      this.assertConservation();
      return true;
    }

    requiredBet(index) {
      // With only one player able to wager, never require chips nobody can contest.
      if (this.funded().length <= 1) {
        return Math.max(0, ...this.live().filter(i => i !== index).map(i => this.players[i].committed));
      }
      return this.currentBet;
    }

    needsAction(index) {
      const p = this.players[index];
      return p.inHand && !p.folded && p.stack > 0 && (!p.acted || p.committed < this.requiredBet(index));
    }

    legal(index = this.turn) {
      if (this.status !== 'active' || index !== this.turn) return null;
      const actor = this.players[index];
      const toCall = Math.max(0, this.requiredBet(index) - actor.committed);
      const maxTotal = actor.committed + actor.stack;
      // Short all-ins do not alter the last full raise. Their cumulative increase
      // reopens action only for seats facing at least a full raise since last acting.
      const raiseRight = actor.actedAt === null || this.currentBet - actor.actedAt >= this.lastFullRaise;
      const responder = this.live().some(i => i !== index && this.players[i].stack > 0);
      const canRaise = raiseRight && responder && maxTotal > this.currentBet;
      const minTotal = this.currentBet + this.lastFullRaise;
      return { toCall, callAmount: Math.min(toCall, actor.stack), minTotal, maxTotal, canRaise,
        canFullRaise: canRaise && maxTotal >= minTotal, canCheck: toCall === 0,
        canCall: toCall > 0, canFold: true, allIn: maxTotal, stack: actor.stack,
        canAllIn: maxTotal <= this.currentBet ? toCall > 0 : canRaise, raiseRight };
    }

    act(index, type, amount) {
      const legal = this.legal(index);
      if (!legal) throw new Error('Not this player’s turn');
      const p = this.players[index];
      const potBefore = this.pot, facing = legal.toCall, committedBefore = p.committed;
      if (type === 'allin' && legal.maxTotal <= this.currentBet) type = 'call';
      if (type === 'fold') {
        p.folded = true; p.acted = true;
        this.note(`${p.name} folds`, 'fold');
      } else if (type === 'check') {
        if (!legal.canCheck) throw new Error('Cannot check when facing a bet');
        p.acted = true; p.actedAt = this.currentBet;
        this.note(`${p.name} checks`);
      } else if (type === 'call') {
        if (!legal.canCall) throw new Error('Nothing to call');
        const paid = this.contribute(index, legal.callAmount);
        p.acted = true; p.actedAt = this.currentBet;
        this.note(`${p.name} calls ${paid}${p.stack === 0 ? ' · all in' : ''}`);
      } else if (type === 'raise' || type === 'allin') {
        if (!legal.canRaise) throw new Error('Raise not available: action has not reopened or nobody can respond');
        const target = type === 'allin' ? legal.maxTotal : Number(amount);
        if (!integer(target) || target > legal.maxTotal || target <= this.currentBet) throw new Error('Invalid raise amount');
        if (target < legal.minTotal && target !== legal.maxTotal) throw new Error('Only an all-in may be below the minimum raise');
        const oldBet = this.currentBet;
        this.contribute(index, target - p.committed);
        this.currentBet = target;
        const increase = target - oldBet;
        if (increase >= this.lastFullRaise) this.lastFullRaise = increase;
        p.acted = true; p.actedAt = target;
        this.note(`${p.name} ${oldBet ? 'raises to' : 'bets'} ${target}${p.stack === 0 ? ' · all in' : ''}`, 'raise');
      } else throw new Error('Unknown action: ' + type);
      // Retain only public action data, across hands, for AI opponent modeling.
      // No private cards, deck order or burn cards enter this log.
      this.publicActions.push({
        hand: this.handNumber, street: this.street, seat: index,
        type: type === 'allin' ? 'raise' : type,
        paid: p.committed - committedBefore, facing, potBefore,
        raiseTo: type === 'raise' || type === 'allin' ? p.committed : null
      });
      if (this.publicActions.length > 600) this.publicActions.shift();
      this.advance(index);
      this.assertConservation();
      return this.result;
    }

    refundUncalled() {
      const ordered = this.players.map((p, index) => ({ index, amount: p.committed })).sort((a, b) => b.amount - a.amount);
      const excess = ordered[0].amount - ordered[1].amount;
      if (excess <= 0) return;
      const index = ordered[0].index, p = this.players[index];
      p.stack += excess; p.committed -= excess; p.invested -= excess; this.pot -= excess;
      this.refunds.push({ player: index, amount: excess, street: this.street });
      this.note(`${p.name} receives ${excess} uncalled chips back`, 'refund');
    }

    advance(after) {
      if (this.live().length === 1) {
        this.refundUncalled(); this.finish('fold'); return;
      }
      const funded = this.funded();
      // A sole funded player acts only if still facing an unmatched all-in wager.
      const noBetting = funded.length <= 1 && funded.every(i => this.players[i].committed >= this.requiredBet(i));
      const next = noBetting ? -1 : this.next(after, (p, i) => this.needsAction(i));
      if (next >= 0) { this.turn = next; return; }
      this.refundUncalled();
      if (this.street === 3) { this.finish('showdown'); return; }
      if (this.funded().length <= 1) { this.runout(); return; }
      this.nextStreet();
      this.turn = this.next(this.button, (p, i) => this.needsAction(i));
    }

    nextStreet() {
      if (this.street >= 3) throw new Error('River already dealt');
      this.street++;
      this.burns.push(this.deck.pop());
      for (let n = this.street === 1 ? 3 : 1; n > 0; n--) this.board.push(this.deck.pop());
      this.players.forEach(p => { p.committed = 0; p.acted = false; p.actedAt = null; });
      this.currentBet = 0; this.lastFullRaise = this.bigBlind;
      this.note(`${STREET_NAMES[this.street]} · ${this.board.map(c => Poker.rankText(c.rank) + Poker.SUIT_SYMBOL[c.suit]).join(' ')}`, 'street');
    }

    runout() {
      while (this.street < 3) this.nextStreet();
      this.finish('showdown');
    }

    finish(reason) {
      const live = this.live();
      const ranks = this.players.map((p, i) => reason === 'showdown' && live.includes(i)
        ? Poker.evaluate7([...p.cards, ...this.board]) : null);
      const levels = [...new Set(this.players.map(p => p.invested).filter(n => n > 0))].sort((a, b) => a - b);
      const pots = [], winnersSet = new Set();
      let previous = 0;
      for (const level of levels) {
        const contributors = this.players.map((p, i) => p.invested >= level ? i : -1).filter(i => i >= 0);
        const amount = (level - previous) * contributors.length;
        const eligible = reason === 'fold' ? live.slice() : contributors.filter(i => !this.players[i].folded);
        if (!eligible.length) throw new Error('Side pot has no eligible player');
        // A folded player's contribution cap is bookkeeping, not a new pot.
        // Merge its layer before any split rounding; genuine all-in caps change
        // the eligible set and therefore retain a separate main/side pot.
        const priorPot = pots[pots.length - 1];
        if (priorPot && priorPot.eligible.length === eligible.length &&
            priorPot.eligible.every((seat, i) => seat === eligible[i])) {
          priorPot.amount += amount; priorPot.level = level;
        } else pots.push({ amount, eligible, level });
        previous = level;
      }
      if (pots.reduce((sum, pot) => sum + pot.amount, 0) !== this.pot) throw new Error('Side pot amounts do not balance');
      const seatTotals = Array(this.players.length).fill(0);
      for (const pot of pots) {
        const { amount, eligible } = pot;
        let winners = [eligible[0]];
        if (reason === 'showdown') for (const index of eligible.slice(1)) {
          const comparison = Poker.compareRanks(ranks[index], ranks[winners[0]]);
          if (comparison > 0) winners = [index];
          else if (comparison === 0) winners.push(index);
        }
        // Odd chips go to tied winners in seat order left of the button.
        winners.sort((a, b) => ((a - this.button - 1 + this.players.length) % this.players.length)
          - ((b - this.button - 1 + this.players.length) % this.players.length));
        const share = Math.floor(amount / winners.length), odd = amount % winners.length;
        pot.awards = winners.map((seat, order) => ({
          seat, amount: share + (order < odd ? 1 : 0)
        }));
        pot.awards.forEach(award => {
          this.players[award.seat].stack += award.amount;
          seatTotals[award.seat] += award.amount;
          winnersSet.add(award.seat);
        });
        pot.winners = winners;
      }
      const winners = [...winnersSet], payout = this.pot;
      // Copy only engine-computed public payouts. Keep this deliberately separate
      // from ranks/cards so presentation cannot inspect or recalculate settlement.
      const publicSettlement = Object.freeze({
        hand: this.handNumber,
        reason,
        payout,
        pots: Object.freeze(pots.map((pot, index) => Object.freeze({
          index,
          kind: index === 0 ? 'main' : 'side',
          amount: pot.amount,
          awards: Object.freeze(pot.awards.map(award => Object.freeze({
            seat: award.seat, amount: award.amount
          })))
        }))),
        totals: Object.freeze(seatTotals.map((amount, seat) => Object.freeze({ seat, amount })))
      });
      const message = pots.length > 1
        ? pots.map((pot, i) => `${i ? `Side pot ${i}` : 'Main pot'}: ${pot.winners.map(j => this.players[j].name).join(' & ')} (${pot.amount})`).join(' · ')
        : `${winners.map(i => this.players[i].name).join(' & ')} ${winners.length > 1 ? 'split' : 'wins'} ${payout}`;
      this.result = { reason, winners, winner: winners.length === 1 ? winners[0] : -1,
        payout, pots, ranks, message, refunds: this.refunds.slice(), board: this.board.slice(),
        publicSettlement };
      this.winner = this.result.winner;
      if (winners.includes(0)) { if (winners.length > 1) this.stats.ties++; else this.stats.wins++; }
      else this.stats.losses++;
      this.history.unshift({ hand: this.handNumber, result: message, pot: payout });
      this.history = this.history.slice(0, 12);
      this.note(message, 'result');
      this.pot = 0; this.status = 'finished'; this.turn = -1;
      this.players.forEach(p => { p.eliminated = p.stack === 0; });
      this.assertConservation();
    }

    assertConservation() {
      if (!integer(this.pot) || this.players.some(p => !integer(p.stack) || !integer(p.committed) || !integer(p.invested)) ||
          this.players.reduce((sum, p) => sum + p.stack, this.pot) !== this.totalChips) throw new Error('Chip conservation violated');
      if (this.status === 'active' && this.players.reduce((sum, p) => sum + p.invested, 0) !== this.pot) throw new Error('Pot contributions do not balance');
    }
  }
  return { Game, STREETS, STREET_NAMES };
});
