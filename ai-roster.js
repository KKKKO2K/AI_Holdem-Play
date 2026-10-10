/* Offline table roster: human-chosen presets, fixed-per-match random opponents.
 * UI-only profile selection. The authoritative AI engine remains unchanged.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemAIRoster = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STYLES = Object.freeze([
    Object.freeze({ id: 'nit', name: 'Cautious', short: 'Patient and selective', character: 'Nit' }),
    Object.freeze({ id: 'tag', name: 'Strategic', short: 'Disciplined and assertive', character: 'TAG' }),
    Object.freeze({ id: 'lag', name: 'Daring', short: 'Loose and aggressive', character: 'LAG' }),
    Object.freeze({ id: 'calling-station', name: 'Stubborn', short: 'Calls and sticks around', character: 'Calling Station' }),
    Object.freeze({ id: 'tricky', name: 'Tricky', short: 'Unpredictable traps', character: 'Tricky' }),
    Object.freeze({ id: 'balanced', name: 'Adaptive', short: 'A measured all-rounder', character: 'Balanced' })
  ]);
  const SKILLS = Object.freeze([
    Object.freeze({ id: 'novice', name: 'Novice', description: 'Still learning the table' }),
    Object.freeze({ id: 'casual', name: 'Casual', description: 'Plays by familiar instincts' }),
    Object.freeze({ id: 'standard', name: 'Standard', description: 'Steady regular' }),
    Object.freeze({ id: 'expert', name: 'Expert', description: 'Reads public action more carefully' })
  ]);
  const DEFAULT_STYLE_BY_MASCOT = Object.freeze({
    fox:'tag', owl:'nit', cat:'calling-station', rabbit:'balanced', lion:'lag'
  });
  const styleSet = new Set(STYLES.map(s => s.id));
  const skillSet = new Set(SKILLS.map(s => s.id));
  function mode(modeValue, known, fallback) {
    return modeValue === 'random' || modeValue === fallback || known.has(modeValue) ? modeValue : fallback;
  }
  function styleMode(seat) {
    if (seat && seat.aiStyleMode !== undefined)
      return mode(seat.aiStyleMode, styleSet, 'mascot');
    return seat && styleSet.has(seat.aiStyle) ? seat.aiStyle : 'mascot';
  }
  function skillMode(seat) {
    if (seat && seat.aiSkillMode !== undefined)
      return mode(seat.aiSkillMode, skillSet, 'standard');
    return seat && skillSet.has(seat.aiSkill) ? seat.aiSkill : 'standard';
  }
  function pick(pool, rng) {
    const sample = Number(rng());
    const index = Math.min(pool.length - 1, Math.max(0,
      Math.floor((Number.isFinite(sample) ? Math.max(0, sample) : .5) * pool.length)));
    return pool[index];
  }
  function resolve(seats, { rng = Math.random } = {}) {
    if (!Array.isArray(seats) || typeof rng !== 'function') throw Error('Invalid roster');
    // Preserve the user's saved selection separately from the rolled result.
    // Explicit choices and mascot defaults are reserved before randomization,
    // so a random table gets distinct styles when possible.
    const roster = seats.map(p => {
      if (p.type === 'human') {
        const { aiStyle, aiSkill, aiStyleMode, aiSkillMode, aiTraits, ...human } = p;
        return human;
      }
      const next = { ...p, aiStyleMode: styleMode(p), aiSkillMode: skillMode(p) };
      next.aiStyle = next.aiStyleMode === 'mascot' ?
        undefined : next.aiStyleMode === 'random' ? null : next.aiStyleMode;
      next.aiSkill = next.aiSkillMode === 'random' ? null : next.aiSkillMode;
      return next;
    });
    const claimed = new Set(roster.filter(p => p.type === 'ai' && p.aiStyle !== null)
      .map(p => p.aiStyle || DEFAULT_STYLE_BY_MASCOT[p.mascot] || 'balanced'));
    for (const p of roster) {
      if (p.type !== 'ai' || p.aiStyleMode !== 'random') continue;
      const pool = STYLES.map(s => s.id).filter(id => !claimed.has(id));
      p.aiStyle = pick(pool.length ? pool : STYLES.map(s => s.id), rng);
      claimed.add(p.aiStyle);
    }
    for (const p of roster) {
      if (p.type !== 'ai' || p.aiSkillMode !== 'random') continue;
      p.aiSkill = pick(SKILLS.map(s => s.id), rng);
    }
    return roster;
  }
  function display(seat) {
    const style = seat.aiStyle || DEFAULT_STYLE_BY_MASCOT[seat.mascot] || 'balanced';
    const skill = seat.aiSkill || 'standard';
    return {
      style: (STYLES.find(s => s.id === style) || STYLES[5]).name,
      skill: (SKILLS.find(s => s.id === skill) || SKILLS[2]).name,
      note: (STYLES.find(s => s.id === style) || STYLES[5]).short
    };
  }
  return Object.freeze({STYLES, SKILLS, DEFAULT_STYLE_BY_MASCOT,
    styleMode, skillMode, resolve, display});
});
