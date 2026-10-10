/* Felt & Fable: gesture-gated, offline sounds for completed PUBLIC events.
 * Deterministic procedural one-shot material recordings (no asset requests,
 * hidden hands, deck/RNG use, or audio before a user's gesture).
 * Peaks and offline rendering are engineering QA, not a physical listening test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'felt-fable-sound-v1';
  const DEFAULT = Object.freeze({enabled: true, volume: .45});
  // [material, start seconds, relative impact, lifetime seconds, relative pitch].
  // Contrast comes from the *material/envelope* and rhythmic fingerprint,
  // rather than composing similar pitched oscillator melodies for every event.
  const PATTERNS = Object.freeze({
    deal: Object.freeze({label:'Shuffle and deal · paper flicks',family:'cards',
      duration:.28,events:[['card',0,.88,.105,.96],['card',.13,.83,.105,1.08]]}),
    check: Object.freeze({label:'Check · double wood knock',family:'wood',
      duration:.20,events:[['wood',0,.97,.075,1],['wood',.10,.63,.065,1.16]]}),
    call: Object.freeze({label:'Call · two ceramic chips',family:'chips',
      duration:.22,events:[['chip',0,.94,.075,.98],['chip',.088,.80,.075,1.12]]}),
    fold: Object.freeze({label:'Fold · card drawn across felt',family:'cards',
      duration:.34,events:[['felt',0,.95,.265,.87],['card',.245,.56,.060,.9]]}),
    raise: Object.freeze({label:'Raise · chips stacked',family:'chips',
      duration:.36,events:[['chip',0,.72,.055,1],['chip',.052,.77,.064,1.17],
        ['chip',.112,.90,.065,.93],['chip',.185,.80,.075,1.10],['chip',.259,.69,.065,1.02]]}),
    allin: Object.freeze({label:'All in · a heap of chips pushed',family:'stack',
      duration:.57,events:[['rake',0,.68,.42,.95],['chip',.04,.58,.065,.91],
        ['chip',.084,.62,.067,1.12],['chip',.131,.72,.068,.87],
        ['chip',.177,.73,.068,1.20],['chip',.226,.85,.073,.98],
        ['chip',.291,.80,.078,1.09],['chip',.365,.80,.082,.96],
        ['wood',.447,.70,.082,.81]]}),
    reveal: Object.freeze({label:'Community cards · three crisp flips',family:'cards',
      duration:.38,events:[['flip',0,.81,.09,.94],['flip',.115,.84,.09,1.04],
        ['flip',.235,.78,.095,1.10]]}),
    award: Object.freeze({label:'Pot awarded · rake and victory chimes',family:'payout',
      duration:.79,events:[['rake',0,.66,.23,.85],['chip',.06,.67,.08,.98],
        ['chip',.155,.60,.08,1.13],['bell',.27,.74,.34,1],
        ['bell',.455,.67,.32,1.26]]})
  });

  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT.enabled,
      volume: Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : DEFAULT.volume
    });
  }
  function outputGain(pref) {
    return pref.enabled && pref.volume > 0 ? Math.pow(pref.volume, .85) : 0;
  }

  // Isolated, seeded audio-only noise. Audio never consumes or predicts deck RNG.
  function noiseGenerator(kind) {
    let seed = 0xA17E5BCD;
    for (let i=0;i<kind.length;i++) seed = (Math.imul(seed ^ kind.charCodeAt(i), 16777619)) >>> 0;
    return function () {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 2147483648 - 1;
    };
  }

  function renderTexture(kind, sampleRate=44100) {
    if (!Object.hasOwn(PATTERNS,kind)) return null;
    const rate = Number.isFinite(sampleRate) ? Math.max(22050,Math.min(96000,Math.round(sampleRate))) : 44100;
    const cue = PATTERNS[kind];
    const data = new Float32Array(Math.ceil(rate * cue.duration));
    const noise = noiseGenerator(kind);
    const tau = 2 * Math.PI;
    for (const [material,at,strength,duration,pitch] of cue.events) {
      let low=0, slow=0;
      const start=Math.round(at*rate), length=Math.min(Math.ceil(duration*rate),data.length-start);
      if (length<=0) continue;
      for(let i=0;i<length;i++){
        const t=i/rate, phase=t/duration, n=noise();
        // Fast smoothed band for paper / felt friction; differentiation does
        // not rely solely on cutoff frequencies (bad on phone speakers).
        low+=.21*(n-low);
        slow+=.028*(n-slow);
        const bright=n-low, grain=low-slow;
        let v=0;
        if (material==='wood') {
          const thud=Math.sin(tau*185*pitch*t)*Math.exp(-63*t);
          const knock=Math.sin(tau*670*pitch*t)*Math.exp(-79*t);
          v=.68*thud+.30*knock+.42*grain*Math.exp(-115*t);
        } else if(material==='chip'){
          // Short, inharmonic ceramic/metal resonances after a sharp clack.
          const edge=(.74*bright+.46*grain)*Math.exp(-190*t);
          const ring=.39*Math.sin(tau*2140*pitch*t)*Math.exp(-76*t)
            +.26*Math.sin(tau*3100*pitch*t)*Math.exp(-93*t)
            +.15*Math.sin(tau*1290*pitch*t)*Math.exp(-65*t);
          v=edge+ring;
        } else if(material==='card'){
          const scrub=.70*grain+.25*bright;
          const edge=Math.sin(tau*710*pitch*t)*Math.exp(-93*t);
          v=.98*scrub*Math.exp(-37*t)+.14*edge;
        } else if(material==='felt'){
          // A sustained, rolling swish, unlike two short card DEAL flicks.
          const arc=Math.pow(Math.sin(Math.PI*phase),.72);
          const grainPulse=.80+.20*Math.sin(tau*27*t);
          v=(.85*grain+.12*bright)*arc*grainPulse;
        } else if(material==='flip'){
          const contact=(.84*grain+.27*bright)*Math.exp(-33*t);
          const snap=Math.sin(tau*530*pitch*t)*Math.exp(-92*t);
          v=contact+.16*snap;
        } else if(material==='rake'){
          const arc=Math.sin(Math.PI*Math.min(1,phase));
          const rattle=.68*grain+.32*bright;
          v=rattle*arc*(.80+.20*Math.sin(tau*36*t));
        } else if(material==='bell'){
          const ring=Math.sin(tau*790*pitch*t)*Math.exp(-7.8*t)
            +.38*Math.sin(tau*1190*pitch*t)*Math.exp(-16*t)
            +.16*Math.sin(tau*1730*pitch*t)*Math.exp(-24*t);
          const attack=Math.min(1,t*410);
          v=ring*attack;
        }
        // Fade each event's final 3ms so waves do not click at the cutoff.
        const endFade=Math.min(1,Math.max(0,(duration-t)/.003));
        data[start+i]+=v*strength*endFade;
      }
    }
    let peak=0;
    for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
    // Fixed bounded PCM normalization: per-gesture volume still on master.
    const target=kind==='check'?.58:kind==='award'?.61:.60;
    const scale=peak?target/peak:0;
    for(let i=0;i<data.length;i++)data[i]*=scale;
    return data;
  }

  function create(options={}) {
    const storage=options.storage===undefined ?
      (()=>{try{return typeof localStorage==='undefined'?null:localStorage;}catch(_){return null;}})() :
      options.storage;
    const audioFactory=options.audioFactory || (()=>{
      const A=typeof window==='undefined'?null:(window.AudioContext||window.webkitAudioContext);
      return A?new A():null;
    });
    let pref=DEFAULT, audio=null, bus=null, master=null;
    const samples=new Map();
    let unlocked=false;
    try {
      const raw=storage&&storage.getItem(KEY);
      pref=normalize(raw?JSON.parse(raw):null);
    } catch(_) {pref=DEFAULT;}
    function settings(){return pref;}
    function setMaster() {
      if(!audio||!master)return;
      const level=outputGain(pref),g=master.gain;
      try{
        if(typeof g.cancelScheduledValues==='function')
          g.cancelScheduledValues(audio.currentTime);
        if(typeof g.setTargetAtTime==='function')
          g.setTargetAtTime(level,audio.currentTime,.009);
        else if(typeof g.setValueAtTime==='function')
          g.setValueAtTime(level,audio.currentTime);
        else g.value=level;
      }catch(_){try{g.value=level;}catch(_2){}}
    }
    function configure(patch) {
      pref=normalize({...pref,...patch});
      try{if(storage)storage.setItem(KEY,JSON.stringify(pref));}catch(_){}
      // Do not queue stale notes by suspending the audio graph on mute.
      setMaster();
      return pref;
    }
    function initialize() {
      if(audio)return true;
      audio=audioFactory();
      if(!audio)return false;
      master=audio.createGain();
      bus=audio.createGain();
      if(typeof audio.createDynamicsCompressor==='function'){
        const limit=audio.createDynamicsCompressor();
        if(limit.threshold)limit.threshold.value=-13;
        if(limit.knee)limit.knee.value=6;
        if(limit.ratio)limit.ratio.value=7;
        if(limit.attack)limit.attack.value=.002;
        if(limit.release)limit.release.value=.15;
        bus.connect(limit);limit.connect(master);
      }else bus.connect(master);
      master.connect(audio.destination);
      setMaster();
      return true;
    }
    function unlock() {
      if(!pref.enabled||pref.volume===0)return false;
      try {
        if(!initialize())return false;
        unlocked=true;
        if(audio.state==='suspended'&&typeof audio.resume==='function')
          Promise.resolve(audio.resume()).catch(()=>{});
        return true;
      }catch(_){return false;}
    }
    function bufferFor(kind) {
      if(samples.has(kind))return samples.get(kind);
      if(!audio||typeof audio.createBuffer!=='function')return null;
      const pcm=renderTexture(kind,audio.sampleRate||44100);
      if(!pcm)return null;
      const buffer=audio.createBuffer(1,pcm.length,audio.sampleRate||44100);
      buffer.getChannelData(0).set(pcm);
      samples.set(kind,buffer);
      return buffer;
    }
    function play(kind,options={}) {
      if(!pref.enabled||pref.volume<=0||!unlocked||
        !Object.hasOwn(PATTERNS,kind)||
        (typeof document!=='undefined'&&document.hidden))return false;
      try {
        if(!audio||!bus||typeof audio.createBufferSource!=='function')return false;
        const buffer=bufferFor(kind);
        if(!buffer)return false;
        const delay=Number.isFinite(options.delay)?Math.min(.8,Math.max(0,options.delay)):0;
        const source=audio.createBufferSource();
        source.buffer=buffer;
        source.connect(bus);
        if(typeof source.addEventListener==='function')
          source.addEventListener('ended',()=>{try{source.disconnect();}catch(_){}},{once:true});
        source.start(audio.currentTime+delay);
        return true;
      }catch(_){return false;}
    }
    function suspend() {
      if(audio&&typeof audio.suspend==='function')
        try{Promise.resolve(audio.suspend()).catch(()=>{});}catch(_){}
    }
    return Object.freeze({settings,configure,unlock,play,suspend,
      isUnlocked:()=>unlocked,
      available:()=>unlocked||typeof window!=='undefined'&&
        !!(window.AudioContext||window.webkitAudioContext)});
  }
  return Object.freeze({KEY,DEFAULT,PATTERNS,normalize,outputGain,renderTexture,create});
});
