/* Public-action storytelling, after the move only. No opponent hole cards,
 * proposed decision, AI memory, skill/private state or inferred bluff labels.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemTableStory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LINES = Object.freeze({
    nit: Object.freeze({raise:'makes a deliberate raise',call:'stays in the pot',check:'waits for the next card',fold:'lets this hand go',allin:'commits the whole stack'}),
    tag: Object.freeze({raise:'sets a firm price',call:'matches the bet',check:'checks the action',fold:'steps away this time',allin:'puts the stack in'}),
    lag: Object.freeze({raise:'pushes the pace',call:'comes along',check:'slows down for a beat',fold:'backs off this one',allin:'goes all the way'}),
    'calling-station': Object.freeze({raise:'turns up the stakes',call:'sticks around',check:'waits it out',fold:'finally steps aside',allin:'stays in with everything'}),
    tricky: Object.freeze({raise:'changes the tempo with a raise',call:'quietly matches',check:'keeps the action moving',fold:'slips out of the pot',allin:'commits the stack'}),
    balanced: Object.freeze({raise:'takes the initiative',call:'keeps the hand alive',check:'checks around',fold:'chooses another spot',allin:'moves all-in'})
  });
  // Alternate dialogue describes completed PUBLIC actions, never a plan or
  // hidden intent. Deterministic hand/action indexing does not use game RNG.
  const ALTERNATES = Object.freeze({
    nit: Object.freeze({raise:'raises with care',call:'counts out a call',check:'takes a quiet check',fold:'passes on this one',allin:'slides the full stack forward'}),
    tag: Object.freeze({raise:'makes a clear raise',call:'puts in the match',check:'lets the turn pass',fold:'leaves the chips for now',allin:'makes a full commitment'}),
    lag: Object.freeze({raise:'turns up the pressure',call:'drops in a call',check:'taps the table',fold:'yields this round',allin:'slides everything in'}),
    'calling-station': Object.freeze({raise:'adds a surprising raise',call:'puts in another call',check:'takes the free look',fold:'releases this one',allin:'puts the rest in the middle'}),
    tricky: Object.freeze({raise:'finds a new angle with a raise',call:'adds chips without a word',check:'taps the felt',fold:'quietly lets go',allin:'pushes in the last chips'}),
    balanced: Object.freeze({raise:'makes the next raise',call:'matches the amount',check:'takes a check',fold:'leaves the hand behind',allin:'commits the remaining chips'})
  });
  const VALID = new Set(['raise','call','check','fold','allin']);
  const sanitized = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  function create() {
    let gameId = null, hand = null, cursor = 0, current = null;
    function reset() { gameId = null; hand = null; cursor = 0; current = null; }
    function observe(game) {
      if (!game || !Array.isArray(game.players)) return null;
      const entries = Array.isArray(game.publicActions) ? game.publicActions : [];
      if (gameId !== game || hand !== game.handNumber || entries.length < cursor) {
        gameId = game; hand = game.handNumber;
        // New-hand existing ledger entries must not replay an old hand.
        cursor = entries.findIndex(e => e && e.hand === hand);
        cursor = cursor < 0 ? entries.length : cursor;
        current = null;
      }
      for (let i = cursor; i < entries.length; i++) {
        const e = entries[i];
        if (!e || e.hand !== hand || !Number.isInteger(e.seat) ||
            e.seat < 0 || e.seat >= game.players.length ||
            !VALID.has(e.type)) continue;
        const player = game.players[e.seat];
        if (!player || player.type !== 'ai') continue;
        // Style is a stable presentation preference, not a hidden hand tell.
        const style = typeof player.aiStyle === 'string' ? player.aiStyle :
          (gameStyle(player.mascot) || 'balanced');
        const safeStyle = Object.hasOwn(LINES,style) ? style : 'balanced';
        const lines = LINES[safeStyle], alternatives = ALTERNATES[safeStyle];
        // A stable rotation across publicly observed hands and seats. A repeated
        // render of one action never changes its sentence.
        const alternate = (hand + e.seat) % 2 === 1;
        current = Object.freeze({
          seat:e.seat, hand, action:e.type,
          text:alternate ? alternatives[e.type] : lines[e.type],
          name:String(player.name || 'A guest').slice(0,24)
        });
      }
      cursor = entries.length;
      return current;
    }
    return { observe, reset };
  }
  function gameStyle(mascot) {
    return {fox:'tag',owl:'nit',lion:'lag',cat:'calling-station',rabbit:'balanced'}[mascot];
  }
  function showdown(game) {
    // Exactly public settlement, never ranks or cards. A folded pot is NOT
    // a showdown. AI names may be configured but have no HTML interpretation.
    const s=game && game.result && game.result.publicSettlement;
    if (!game || game.status !== 'finished' || !s ||
        s.reason !== 'showdown' || s.hand !== game.handNumber) return null;
    const winners=Array.isArray(s.totals) ? s.totals.filter(a =>
      Number.isInteger(a.seat) && sanitized(a.amount)>0 &&
      a.seat<game.players.length) : [];
    const split=winners.length > 1 || (s.pots && s.pots.length > 1);
    return Object.freeze({
      hand:s.hand,
      intro: 'SHOWDOWN · THE CARDS ARE IN',
      outcome: split ? 'THE POTS ARE AWARDED' : 'A WINNER EMERGES',
      payout: sanitized(s.payout)
    });
  }
  return Object.freeze({create,showdown,LINES});
});
