/* Tiny offline-only public-action audio. No assets, telemetry or card access.
 * A user gesture must unlock Web Audio first; browsers can reject audio.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'felt-fable-sound-v1';
  const DEFAULT = Object.freeze({enabled: true, volume: .32});
  const PATTERNS = Object.freeze({
    deal: [[390,0,.042,.30],[515,.075,.055,.25]],
    check: [[455,0,.06,.28]],
    call: [[385,0,.07,.4],[540,.065,.055,.27]],
    fold: [[325,0,.10,.26]],
    raise: [[470,0,.07,.35],[665,.085,.10,.37]],
    allin: [[340,0,.075,.4],[470,.095,.09,.45],[700,.195,.14,.30]],
    reveal: [[575,0,.065,.30],[750,.085,.10,.35]],
    award: [[510,0,.09,.34],[660,.10,.11,.34],[820,.225,.16,.3]]
  });
  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT.enabled,
      volume: Number.isFinite(s.volume) ? Math.min(1,Math.max(0,s.volume)) : DEFAULT.volume
    });
  }
  function create(options={}) {
    const storage = options.storage === undefined ?
      (() => {try {return typeof localStorage === 'undefined' ? null : localStorage;} catch (_) {return null;}})() :
      options.storage;
    const audioFactory = options.audioFactory || (() => {
      const A = typeof window === 'undefined' ? null : (window.AudioContext || window.webkitAudioContext);
      return A ? new A() : null;
    });
    let pref = DEFAULT, audio = null, unlocked = false;
    try {
      const raw = storage && storage.getItem(KEY);
      pref = normalize(raw ? JSON.parse(raw) : null);
    } catch (_) { pref = DEFAULT; }
    function settings(){return pref;}
    function configure(patch){
      pref = normalize({...pref,...patch});
      try {if (storage) storage.setItem(KEY,JSON.stringify(pref));} catch (_) {}
      if (!pref.enabled && audio && typeof audio.suspend === 'function')
        Promise.resolve(audio.suspend()).catch(()=>{});
      return pref;
    }
    // The first invocation must be from a real button/key press.
    function unlock(){
      if (!pref.enabled || pref.volume===0) return false;
      try {
        if (!audio) audio = audioFactory();
        if (!audio) return false;
        unlocked = true;
        if (audio.state === 'suspended' && typeof audio.resume === 'function')
          Promise.resolve(audio.resume()).catch(()=>{});
        return true;
      } catch (_) {return false;}
    }
    function play(kind){
      if (!pref.enabled || pref.volume<=0 || !unlocked ||
          !Object.hasOwn(PATTERNS,kind) ||
          (typeof document !== 'undefined' && document.hidden))return false;
      try {
        if (!audio || typeof audio.createOscillator !== 'function')return false;
        const now=audio.currentTime;
        for (const [frequency,delay,duration,intensity] of PATTERNS[kind]) {
          const osc=audio.createOscillator();
          const gain=audio.createGain();
          const start=now+delay, end=start+duration;
          osc.type = kind==='fold' ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(frequency,start);
          if (kind==='fold') osc.frequency.exponentialRampToValueAtTime(Math.max(80,frequency*.68),end);
          gain.gain.setValueAtTime(.0001,start);
          gain.gain.linearRampToValueAtTime(Math.max(.0002,pref.volume*.11*intensity),start+.009);
          gain.gain.exponentialRampToValueAtTime(.0001,end);
          osc.connect(gain);
          gain.connect(audio.destination);
          osc.start(start);osc.stop(end+.01);
          if (typeof osc.addEventListener==='function')
            osc.addEventListener('ended',()=>{osc.disconnect();gain.disconnect();},{once:true});
        }
        return true;
      } catch (_) {return false;}
    }
    function suspend(){
      if (audio && typeof audio.suspend==='function')
        try {Promise.resolve(audio.suspend()).catch(()=>{});}catch(_){}
    }
    return Object.freeze({settings,configure,unlock,play,suspend,isUnlocked:()=>unlocked,
      available:()=>unlocked||typeof window !== 'undefined' &&
      !!(window.AudioContext||window.webkitAudioContext)});
  }
  return Object.freeze({KEY,DEFAULT,PATTERNS,normalize,create});
});