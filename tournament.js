/* Offline practice-chip timed tournament clock, no deck/AI access. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HoldemTournament=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LEVEL_BLINDS=Object.freeze([
    [10,20],[15,30],[25,50],[40,80],[50,100],
    [75,150],[100,200],[150,300],[200,400],[300,600]
  ].map(pair=>Object.freeze(pair)));
  const DEFAULT=Object.freeze({levelMinutes:3,registrationCloseLevel:5,startingStack:1500});
  const allowedMinutes=Object.freeze([1,3,5,10]);
  const allowedCutoffs=Object.freeze([3,5,7]);
  function normalize(options={}){
    const input=options&&typeof options==='object'?options:{};
    const levelMinutes=Number(input.levelMinutes===undefined?DEFAULT.levelMinutes:input.levelMinutes);
    const registrationCloseLevel=Number(input.registrationCloseLevel===undefined?
      DEFAULT.registrationCloseLevel:input.registrationCloseLevel);
    if(!allowedMinutes.includes(levelMinutes)||!allowedCutoffs.includes(registrationCloseLevel))
      throw Error('Invalid tournament level duration or registration deadline');
    return Object.freeze({levelMinutes,registrationCloseLevel,startingStack:DEFAULT.startingStack});
  }
  function blindsForLevel(level){
    if(!Number.isSafeInteger(level)||level<1)throw Error('Invalid blind level');
    if(level<=LEVEL_BLINDS.length){
      const [smallBlind,bigBlind]=LEVEL_BLINDS[level-1];
      return Object.freeze({smallBlind,bigBlind});
    }
    const factor=Math.pow(2,Math.ceil((level-LEVEL_BLINDS.length)/2));
    const smallBlind=Math.min(100000,300*factor);
    return Object.freeze({smallBlind,bigBlind:Math.min(200000,smallBlind*2)});
  }
  function frame(config,startedAt,now=Date.now()){
    const settings=normalize(config);
    if(!Number.isSafeInteger(startedAt)||startedAt<0||!Number.isFinite(now))
      throw Error('Invalid tournament clock');
    const elapsedMs=Math.max(0,Math.floor(now)-startedAt);
    const levelDurationMs=settings.levelMinutes*60000;
    const level=1+Math.floor(elapsedMs/levelDurationMs);
    const remainingMs=levelDurationMs-(elapsedMs%levelDurationMs);
    const blinds=blindsForLevel(level);
    return Object.freeze({level,elapsedMs,remainingMs,levelDurationMs,
      registrationOpen:level<=settings.registrationCloseLevel,
      registrationCloseLevel:settings.registrationCloseLevel,
      ...blinds});
  }
  function create(config={}, options={}){
    const settings=normalize(config);
    const now=typeof options.now==='function'?options.now:()=>Date.now();
    const startedAt=options.startedAt===undefined?Math.floor(now()):options.startedAt;
    if(!Number.isSafeInteger(startedAt)||startedAt<0)throw Error('Invalid start timestamp');
    let humanRebuysUsed=0;
    function clock(){return frame(settings,startedAt,now());}
    function canRebuy(){return humanRebuysUsed<1&&clock().registrationOpen;}
    function consumeRebuy(){
      if(!canRebuy())return false;
      humanRebuysUsed++;
      return true;
    }
    return Object.freeze({config:settings,startedAt,clock,canRebuy,consumeRebuy,
      rebuysUsed:()=>humanRebuysUsed,
      rebuysRemaining:()=>1-humanRebuysUsed});
  }
  return Object.freeze({DEFAULT,LEVEL_BLINDS,normalize,blindsForLevel,frame,create});
});
