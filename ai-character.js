/* Character memory and expression kernel for narrative Hold'em AI.
 * Public-event-only, deterministic, bounded, immutable state transitions.
 * Not wired to UI or wagering decisions yet: no game/DOM/timer dependencies.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemAICharacter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STYLES = Object.freeze(['nit','tag','lag','calling-station','tricky','balanced']);
  const SKILLS = Object.freeze(['novice','casual','standard','expert']);
  const ACTIONS = Object.freeze(['fold','check','call','raise']);
  const clamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));
  const number = (n, fallback=0) => Number.isFinite(n)?n:fallback;
  const allowedSeat = n => Number.isInteger(n)&&n>=0&&n<6;
  const allowedHand = n => Number.isSafeInteger(n)&&n>=1;
  const round = n => Math.round(n*10000)/10000;
  function create({seat,style='balanced',skill='standard'}={}) {
    if(!allowedSeat(seat))throw new RangeError('Character requires seat 0..5');
    if(!STYLES.includes(style))throw new RangeError('Unknown style');
    if(!SKILLS.includes(skill))throw new RangeError('Unknown skill');
    return {
      seat,style,skill,confidence:.5,frustration:0,pressure:0,
      lastPublicHand:0,lastActionIndex:-1,lastResultHand:0,
      opponents:{},lastSelfAction:null,lastEvent:'idle'
    };
  }
  function newHand(state,hand) {
    if(hand<=state.lastPublicHand)return state;
    const skipped=Math.min(50,hand-state.lastPublicHand);
    const retention=Math.pow(.76,skipped);
    const opponents={};
    for(const [key,record] of Object.entries(state.opponents)) {
      opponents[key]={...record,
        raises:round(record.raises*Math.pow(.97,skipped)),
        calls:round(record.calls*Math.pow(.97,skipped)),
        folds:round(record.folds*Math.pow(.97,skipped))};
    }
    return {...state,lastPublicHand:hand,lastActionIndex:-1,
      confidence:round(.5+(state.confidence-.5)*Math.pow(.94,skipped)),
      frustration:round(state.frustration*Math.pow(.84,skipped)),
      pressure:round(state.pressure*retention),opponents,
      lastEvent:'idle',lastSelfAction:null};
  }
  function observePublicAction(state,event) {
    if(!state||!allowedSeat(state.seat))throw new TypeError('Invalid character state');
    if(!event||!allowedHand(event.hand)||!allowedSeat(event.seat)||
      !Number.isInteger(event.street)||event.street<0||event.street>3||
      !Number.isSafeInteger(event.actionIndex)||event.actionIndex<0||
      !ACTIONS.includes(event.type)) return state;
    if(event.hand<=state.lastResultHand ||
      event.hand<state.lastPublicHand ||
      (event.hand===state.lastPublicHand&&
       event.actionIndex<=state.lastActionIndex))return state;
    const fresh=newHand(state,event.hand);
    const next={...fresh,lastActionIndex:event.actionIndex};
    if(event.seat===state.seat){
      return {...next,lastSelfAction:event.type,lastEvent:'self'};
    }
    const key=String(event.seat);
    const former=fresh.opponents[key]||{raises:0,calls:0,folds:0,observed:0};
    const record={...former,observed:Math.min(1000,former.observed+1)};
    if(event.type==='raise')record.raises=Math.min(64,record.raises+1);
    if(event.type==='call')record.calls=Math.min(64,record.calls+1);
    if(event.type==='fold')record.folds=Math.min(64,record.folds+1);
    const relative=event.type==='raise'&&Number.isFinite(event.paid)&&
      event.paid>=0&&Number.isFinite(event.potBefore)&&event.potBefore>0 ?
      clamp(event.paid/event.potBefore,0,2) : 0;
    return {...next,opponents:{...fresh.opponents,[key]:record},
      pressure:round(clamp(fresh.pressure+
        (event.type==='raise'?.10+.10*relative:
         event.type==='call'?.016:-.012),0,1)),
      lastEvent:event.type==='raise'?'observed-raise':'observed-action'};
  }
  function observeHandEnd(state,result) {
    if(!state||!allowedSeat(state.seat))throw new TypeError('Invalid character state');
    if(!result||!allowedHand(result.hand)||
      (result.hand<=state.lastResultHand || result.hand<state.lastPublicHand)||
      !Array.isArray(result.winners)||
      !['fold','showdown'].includes(result.reason))return state;
    const settled=newHand(state,result.hand);
    // Only read public winners/reason/size. Never touch ranks/hole/deck.
    const won=result.winners.includes(state.seat);
    const folded=settled.lastSelfAction==='fold';
    const bigPot=Number.isFinite(result.potSize)&&result.potSize>=160;
    // Folding is often a correct decision, not an emotional bad beat.
    // Avoid manufacturing tilt when a careful opponent simply sat out.
    const confidenceDelta=won?.075:folded?-.008:-.065;
    const frustrationDelta=won?-.07:folded?.004:bigPot?.12:.045;
    return {...settled,lastResultHand:result.hand,
      confidence:round(clamp(settled.confidence+confidenceDelta,0,1)),
      frustration:round(clamp(settled.frustration+frustrationDelta,0,1)),
      pressure:round(settled.pressure*.62),
      lastEvent:won?'won':'lost'};
  }
  function cue(state,{kind='turn',hand}={}) {
    if(!state||!allowedSeat(state.seat))throw new TypeError('Invalid character state');
    if(!['turn','result'].includes(kind))return null;
    if(kind==='result'&&(!allowedHand(hand)||state.lastResultHand!==hand))
      return null;
    if(kind==='turn'&&state.lastPublicHand===0)return null;
    const intense=state.frustration>.22 || state.pressure>.31;
    const cues={
      nit:['cautious','composed'],
      tag:['measured','satisfied'],
      lag:['defiant','proud'],
      'calling-station':['unfazed','pleased'],
      tricky:['enigmatic','amused'],
      balanced:['watchful','composed']
    };
    const [turnCue,resultCue]=cues[state.style];
    const cueId=kind==='result'?
      (state.lastEvent==='won'?resultCue:'shaken'):
      intense?(state.style==='lag'?'defiant':state.style==='calling-station'?'unfazed':'watchful'):
      (state.lastEvent==='idle'?null:turnCue);
    if(!cueId)return null;
    const tempoHint=(state.style==='nit'||state.style==='tricky')?'deliberate':
      state.style==='lag'?'brisk':'steady';
    return {cueId,intensity:round(clamp(
      .20+state.frustration*.30+state.pressure*.24+
      (kind==='result'?.16:0),.15,.82)),tempoHint};
  }
  // Emotional behavior is not one global tilt dial. Each character keeps
  // a readable weakness: the nit grows more cautious, LAG pushes harder,
  // calling-station becomes stickier, and TAG regains composure.
  // Mood is derived ONLY from prior public actions and settled outcomes.
  const MOOD_LIMITS=Object.freeze({
    aggression:.09,risk:.065,looseness:.055,bluff:.04
  });
  function policyModifiers(state) {
    if(!state||!allowedSeat(state.seat))throw new TypeError('Invalid character state');
    const confidence=clamp(number(state.confidence,.5)-.5,-.5,.5);
    const upset=clamp(number(state.frustration),0,1);
    const pressure=clamp(number(state.pressure),0,1);
    const response={
      nit:{
        aggression:confidence*.05-upset*.04-pressure*.023,
        risk:upset*.035+pressure*.055-confidence*.025,
        looseness:-upset*.025-pressure*.018,bluff:-upset*.012
      },
      tag:{
        aggression:confidence*.07-upset*.035-pressure*.015,
        risk:upset*.042+pressure*.045-confidence*.018,
        looseness:-upset*.012,bluff:-upset*.01
      },
      lag:{
        aggression:confidence*.018+upset*.072+pressure*.045,
        risk:-upset*.032-pressure*.026,
        looseness:upset*.022+pressure*.014,
        bluff:upset*.025+pressure*.014
      },
      'calling-station':{
        aggression:confidence*.025-upset*.015,
        risk:-upset*.042-pressure*.052,
        looseness:upset*.038+pressure*.033,bluff:-upset*.009
      },
      tricky:{
        aggression:confidence*.045+upset*.012-pressure*.012,
        risk:pressure*.028,
        looseness:-pressure*.012,bluff:upset*.030+pressure*.012
      },
      balanced:{
        aggression:confidence*.06-upset*.015,
        risk:upset*.028+pressure*.038,
        looseness:-upset*.010,bluff:confidence*.015
      }
    }[state.style];
    if(!response)throw new RangeError('Unknown character style');
    return Object.fromEntries(Object.entries(MOOD_LIMITS).map(([key,max])=>
      [key,round(clamp(response[key],-max,max))]));
  }
  // Restore public-memory-only state from a completed-hand checkpoint.
  // Strip every unknown field (including hidden cards or future intentions).
  function restore(input,{seat,style,skill,maxHand}={}){
    const base=create({seat,style,skill});
    if(!input || input.seat!==seat || input.style!==style ||
       input.skill!==skill || !Number.isSafeInteger(maxHand) ||
       maxHand<1)throw Error('Invalid public character checkpoint');
    const clampValue=(x,min,max)=>Number.isFinite(x)?clamp(x,min,max):0;
    const handField=k=>{
      const n=input[k];
      if(!Number.isSafeInteger(n)||n<0||n>maxHand)
        throw Error('Invalid public character checkpoint hand');
      return n;
    };
    const opponents=Object.create(null);
    if(input.opponents && typeof input.opponents==='object' &&
       !Array.isArray(input.opponents)){
      for(const [key,r] of Object.entries(input.opponents)){
        if(!/^[0-5]$/.test(key)||Number(key)===seat||!r||
           typeof r!=='object'||Array.isArray(r))continue;
        opponents[key]={
          raises:clampValue(r.raises,0,64),calls:clampValue(r.calls,0,64),
          folds:clampValue(r.folds,0,64),
          observed:Number.isSafeInteger(r.observed)?
            clamp(r.observed,0,1000):0
        };
      }
    }
    const lastPublicHand=handField('lastPublicHand'),
      lastResultHand=handField('lastResultHand');
    if(lastResultHand>lastPublicHand && lastPublicHand!==0)
      throw Error('Invalid character event chronology');
    return {...base,
      confidence:clampValue(input.confidence,0,1),
      frustration:clampValue(input.frustration,0,1),
      pressure:clampValue(input.pressure,0,1),
      lastPublicHand,lastResultHand,
      lastActionIndex:Number.isSafeInteger(input.lastActionIndex)?
        clamp(input.lastActionIndex,-1,1000):-1,
      lastSelfAction:ACTIONS.includes(input.lastSelfAction)?
        input.lastSelfAction:null,
      lastEvent:['idle','self','observed-raise','observed-action',
        'won','lost'].includes(input.lastEvent)?input.lastEvent:'idle',
      opponents};
  }
  function reset(state){
    if(!state||!allowedSeat(state.seat))throw new TypeError('Invalid character state');
    return create({seat:state.seat,style:state.style,skill:state.skill});
  }
  return {create,observePublicAction,observeHandEnd,cue,policyModifiers,MOOD_LIMITS,reset,restore,STYLES,SKILLS};
});