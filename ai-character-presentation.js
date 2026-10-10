/* Presentation-only character hints. Public cue IDs are not tell signals.
 * A visual component may discard these without changing any game result.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HoldemAICharacterPresentation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MESSAGES=Object.freeze({
    cautious:'Taking their time',
    composed:'Keeping their cool',
    measured:'Watching carefully',
    satisfied:'A quiet smile',
    defiant:'Sits a little straighter',
    proud:'Looking pleased',
    unfazed:'Keeps a calm face',
    pleased:'Looking content',
    enigmatic:'Hard to read',
    amused:'A knowing grin',
    watchful:'Watching the table',
    shaken:'A little rattled'
  });
  // These are reactions to PUBLISHED events, never intended future moves.
  const REACTION_ALTERNATES=Object.freeze({
    cautious:'A thoughtful pause',measured:'Eyes on the pot',
    defiant:'A crooked half-smile',unfazed:'A steady glance',
    enigmatic:'An unreadable expression',watchful:'Taking it all in'
  });
  // A publicly settled defeat has style-specific mannerisms, not a universal
  // "rattled" label. No private rank or unshown opponent hand is inspected.
  const SETTLED_LOSS=Object.freeze({
    nit:'A slow, thoughtful nod',tag:'Recounts the chips quietly',
    lag:'A wry little grin','calling-station':'Takes a moment to regroup',
    tricky:'An unreadable shrug',balanced:'Quietly gathers their thoughts'
  });
  function displayText(cue,hand){
    if(cue.cueId==='shaken' && cue.kind==='result' &&
       typeof cue.style==='string' && Object.hasOwn(SETTLED_LOSS,cue.style))
      return SETTLED_LOSS[cue.style];
    if(cue.kind==='reaction' && (hand+cue.seat)%2===1 &&
       Object.hasOwn(REACTION_ALTERNATES,cue.cueId))
      return REACTION_ALTERNATES[cue.cueId];
    return MESSAGES[cue.cueId];
  }
  const TONE=Object.freeze({brisk:520,steady:650,deliberate:790});
  function create({clock=()=>Date.now(),duration=2100}={}){
    if(typeof clock!=='function'||!Number.isFinite(duration)||
      duration<100||duration>10000)throw Error('Invalid presentation settings');
    const shown=new Map();
    function clear(){shown.clear();}
    function publish(cues,hand){
      if(!Array.isArray(cues)||!Number.isSafeInteger(hand))return 0;
      let count=0;
      for(const cue of cues){
        if(!cue||cue.hand!==hand||!Number.isInteger(cue.seat)||
          cue.seat<0||cue.seat>5||
          !Object.hasOwn(MESSAGES,cue.cueId)||
          !['reaction','result'].includes(cue.kind))continue;
        shown.set(cue.seat,{
          hand,text:displayText(cue,hand),cueId:cue.cueId,kind:cue.kind,
          until:clock()+duration});
        count++;
      }
      return count;
    }
    function forSeat(seat,hand){
      const entry=shown.get(seat);
      if(!entry||entry.hand!==hand||entry.until<=clock())return null;
      return {text:entry.text,cueId:entry.cueId,kind:entry.kind};
    }
    function expire(){
      for(const [seat,entry] of shown)
        if(entry.until<=clock())shown.delete(seat);
    }
    function thinkDelay(character,{reducedMotion=false,fast=false,rng=Math.random}={}){
      if(fast||reducedMotion)return 60;
      const tempo=character&&character.style==='lag'?'brisk':
        character&&['nit','tricky'].includes(character.style)?'deliberate':'steady';
      const upset=character&&Number.isFinite(character.frustration)?
        Math.max(0,Math.min(1,character.frustration)):0;
      const random=Math.max(0,Math.min(1,Number(rng())||0));
      return Math.max(340,Math.min(1100,
        Math.round(TONE[tempo]+upset*90+(random-.5)*155)));
    }
    return {publish,forSeat,expire,clear,thinkDelay};
  }
  return {create,MESSAGES};
});