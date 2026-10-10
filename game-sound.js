/* Offline Web Audio effects for completed PUBLIC game events only.
 * No files, network, private cards, RNG/deck reads, or autoplay.
 * Distinct textures: cloth/cards, wood, chips, fold, stack, and payout bells.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'felt-fable-sound-v1';
  const DEFAULT = Object.freeze({enabled: true, volume: .45});

  // Each tone: [Hz, delay, seconds, peak gain, waveform, optional ending Hz].
  // Each noise: [delay, seconds, peak gain, center Hz]. Filtering produces
  // card/shuffle/chip texture instead of eight nearly identical sine beeps.
  const PATTERNS = Object.freeze({
    deal: {
      label: 'Shuffle and deal', family: 'cards',
      tones: [[640,0,.045,.15,'triangle',460],[590,.095,.04,.12,'triangle',425]],
      noises: [[0,.095,.34,1850],[.11,.095,.32,2100]]
    },
    check: {
      label: 'Check · wood tap', family: 'wood',
      tones: [[465,0,.095,.41,'triangle',290]],
      noises: [[0,.035,.23,1680]]
    },
    call: {
      label: 'Call · two chips', family: 'chips',
      tones: [[880,0,.15,.27,'sine',720],[1210,.105,.17,.24,'sine',950]],
      noises: [[0,.025,.13,2600],[.11,.022,.13,2800]]
    },
    fold: {
      label: 'Fold · card slide', family: 'cards',
      tones: [[530,.005,.17,.32,'triangle',265]],
      noises: [[0,.18,.56,1040]]
    },
    raise: {
      label: 'Raise · chip stack', family: 'chips',
      tones: [[720,0,.135,.24,'sine',590],[970,.077,.15,.27,'sine',790],
        [1160,.16,.17,.23,'sine',940]],
      noises: [[0,.025,.15,2950],[.08,.026,.16,2700],[.165,.028,.15,3200]]
    },
    allin: {
      label: 'All-in · chips pushed', family: 'stack',
      tones: [[410,0,.15,.23,'triangle',280],[560,.065,.13,.24,'sine',470],
        [710,.13,.14,.24,'sine',600],[870,.20,.14,.22,'sine',740],
        [1070,.275,.21,.30,'sine',900]],
      noises: [[0,.046,.21,2400],[.14,.055,.24,2700],[.275,.055,.21,3200]]
    },
    reveal: {
      label: 'Community cards flipped', family: 'cards',
      tones: [[720,.065,.12,.16,'triangle',865],[1080,.135,.18,.23,'sine',1240]],
      noises: [[0,.11,.39,1380]]
    },
    award: {
      label: 'Pot awarded · three bells', family: 'bells',
      tones: [[523.25,0,.36,.28,'sine'],[659.25,.13,.38,.30,'sine'],
        [783.99,.28,.44,.31,'sine'],[1046.5,.29,.28,.10,'sine']],
      noises: [[0,.025,.12,3150]]
    }
  });

  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT.enabled,
      volume: Number.isFinite(s.volume) ?
        Math.min(1, Math.max(0, s.volume)) : DEFAULT.volume
    });
  }
  // At volume=1, levels are now ~6–15x the original design's peak,
  // before the limiter, but no unbounded amplification or hard clipping.
  function outputGain(pref) {
    return pref.enabled && pref.volume>0 ? Math.pow(pref.volume,.85) : 0;
  }
  function create(options={}) {
    const storage=options.storage===undefined ?
      (()=>{try{return typeof localStorage==='undefined'?null:localStorage;}catch(_){return null;}})() :
      options.storage;
    const audioFactory=options.audioFactory || (()=>{
      const A=typeof window==='undefined'?null:(window.AudioContext||window.webkitAudioContext);
      return A?new A():null;
    });
    let pref=DEFAULT, audio=null, bus=null, master=null, noiseBuffer=null;
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
      // Muting only lowers gain. Suspending the context used to queue old
      // completed notes, which could unexpectedly play upon unmute.
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
        if(limit.threshold) limit.threshold.value=-16;
        if(limit.knee) limit.knee.value=9;
        if(limit.ratio) limit.ratio.value=7;
        if(limit.attack) limit.attack.value=.002;
        if(limit.release) limit.release.value=.18;
        bus.connect(limit);limit.connect(master);
      }else bus.connect(master);
      master.connect(audio.destination);
      setMaster();
      return true;
    }
    // AudioContext must be unlocked from an actual button/keyboard gesture.
    function unlock() {
      if(!pref.enabled||pref.volume===0)return false;
      try{
        if(!initialize())return false;
        unlocked=true;
        if(audio.state==='suspended'&&typeof audio.resume==='function')
          Promise.resolve(audio.resume()).catch(()=>{});
        return true;
      }catch(_){return false;}
    }
    function allocateNoise() {
      if(noiseBuffer || typeof audio.createBuffer!=='function')return noiseBuffer;
      const rate=audio.sampleRate||44100;
      const length=Math.ceil(rate*.48);
      const buffer=audio.createBuffer(1,length,rate);
      const data=buffer.getChannelData(0);
      // Fixed isolated xorshift. Audio never consumes the game's shuffle RNG.
      let seed=0xA17E5BCD;
      for(let i=0;i<length;i++){
        seed ^= seed<<13;seed ^= seed>>>17;seed ^= seed<<5;
        data[i]=(seed>>>0)/2147483648-1;
      }
      noiseBuffer=buffer;
      return buffer;
    }
    function envelope(gain,start,duration,level,attack=.004){
      const g=gain.gain,end=start+duration,attackEnd=Math.min(end-.002,start+attack);
      g.setValueAtTime(.0001,start);
      g.linearRampToValueAtTime(level,attackEnd);
      g.exponentialRampToValueAtTime(.0001,end);
    }
    function attachCleanup(source,gain,filter) {
      if(typeof source.addEventListener==='function'){
        source.addEventListener('ended',()=>{
          try{source.disconnect();gain.disconnect();if(filter)filter.disconnect();}catch(_){}
        },{once:true});
      }
    }
    function playTone(note,now) {
      const [freq,delay,duration,level,wave,endFreq]=note;
      const start=now+delay,end=start+duration;
      const osc=audio.createOscillator(),gain=audio.createGain();
      osc.type=wave;
      osc.frequency.setValueAtTime(freq,start);
      if(endFreq)osc.frequency.exponentialRampToValueAtTime(endFreq,end);
      envelope(gain,start,duration,level,wave==='sine'?.005:.003);
      osc.connect(gain);gain.connect(bus);
      attachCleanup(osc,gain,null);
      osc.start(start);osc.stop(end+.012);
    }
    function playNoise(note,now) {
      if(typeof audio.createBufferSource!=='function')return;
      const buffer=allocateNoise();
      if(!buffer)return;
      const [delay,duration,level,freq]=note;
      const start=now+delay,end=start+duration;
      const source=audio.createBufferSource(),gain=audio.createGain();
      source.buffer=buffer;
      let filter=null;
      if(typeof audio.createBiquadFilter==='function'){
        filter=audio.createBiquadFilter();
        filter.type='bandpass';
        filter.frequency.value=freq;
        filter.Q.value=.7;
      }
      envelope(gain,start,duration,level,.003);
      if(filter){source.connect(filter);filter.connect(gain);}
      else source.connect(gain);
      gain.connect(bus);
      attachCleanup(source,gain,filter);
      source.start(start,0,duration);source.stop(end+.012);
    }
    function play(kind,options={}) {
      if(!pref.enabled||pref.volume<=0||!unlocked||
        !Object.hasOwn(PATTERNS,kind)||
        (typeof document!=='undefined'&&document.hidden))return false;
      try {
        if(!audio||!bus)return false;
        const delay=Number.isFinite(options.delay)?
          Math.min(.8,Math.max(0,options.delay)):0;
        const now=audio.currentTime+delay;
        const cue=PATTERNS[kind];
        for(const note of cue.tones)playTone(note,now);
        for(const note of cue.noises)playNoise(note,now);
        return true;
      }catch(_){return false;}
    }
    function suspend(){
      // Pause only for explicit page teardown. Never pause on mute.
      if(audio&&typeof audio.suspend==='function')
        try{Promise.resolve(audio.suspend()).catch(()=>{});}catch(_){}
    }
    return Object.freeze({settings,configure,unlock,play,suspend,
      isUnlocked:()=>unlocked,
      available:()=>unlocked||typeof window!=='undefined'&&
        !!(window.AudioContext||window.webkitAudioContext)});
  }
  return Object.freeze({KEY,DEFAULT,PATTERNS,normalize,outputGain,create});
});
