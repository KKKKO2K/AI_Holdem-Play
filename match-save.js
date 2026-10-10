/* Explicit, local-only, finished-hand checkpoints. Never stores an
 * unfinished deck, burns, any hole cards, or secretly inferred ranks.
 * On resume the engine deals a BRAND NEW next hand using its real rules.
 */
(function(root,factory){
 const history=typeof module==='object'&&module.exports?require('./hand-history'):root.HoldemHandHistory;
 const api=factory(history);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.HoldemMatchSave=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(History){
 'use strict';
 const KEY='felt-fable-match-boundary-v1';
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 function safeRoster(roster){
   if(!Array.isArray(roster)||roster.length<2||roster.length>6)return null;
   const out=roster.map(p=>{
     if(!p||!['human','ai'].includes(p.type))return null;
     const traits={};
     for(const k of ['aggression','looseness','bluff','sizing','risk'])
       if(p.aiTraits&&Number.isFinite(p.aiTraits[k]))traits[k]=p.aiTraits[k];
     return {name:String(p.name||'Guest').slice(0,36),
       type:p.type,mascot:['fox','owl','cat','rabbit','lion'].includes(p.mascot)?
         p.mascot:'fox',
       aiStyle:typeof p.aiStyle==='string'?p.aiStyle:undefined,
       aiSkill:typeof p.aiSkill==='string'?p.aiSkill:undefined,
       aiStyleMode:typeof p.aiStyleMode==='string'?p.aiStyleMode:undefined,
       aiSkillMode:typeof p.aiSkillMode==='string'?p.aiSkillMode:undefined,
       aiTraits:traits};
   });
   return out.includes(null)?null:out;
 }
 function normalize(raw){
   if(!raw||raw.version!==1) return null;
   const roster=safeRoster(raw.roster);
   const sourceBoundary=raw.boundary;
   const boundary=sourceBoundary&&typeof sourceBoundary==='object' ? {
     version:sourceBoundary.version,hand:sourceBoundary.hand,
     button:sourceBoundary.button,bb:sourceBoundary.bb,
     previousSeatCount:sourceBoundary.previousSeatCount,
     totalChips:sourceBoundary.totalChips,
     stacks:Array.isArray(sourceBoundary.stacks)?sourceBoundary.stacks.slice():null,
     stats:sourceBoundary.stats&&typeof sourceBoundary.stats==='object' ?
       Object.fromEntries(['played','wins','losses','ties'].map(k=>
         [k,sourceBoundary.stats[k]])):null,
     publicActions:Array.isArray(sourceBoundary.publicActions)?
       sourceBoundary.publicActions.map(a=>a&&typeof a==='object'?{
         hand:a.hand,street:a.street,seat:a.seat,type:a.type,
         paid:a.paid,facing:a.facing,potBefore:a.potBefore,
         raiseTo:a.raiseTo
       }:null):null
   }:null;
   if(!roster||!roster.some(p=>p.type==='human')||!boundary||
      boundary.version!==1||!integer(boundary.hand)||boundary.hand<1||
      !Array.isArray(boundary.stacks)||boundary.stacks.length!==roster.length||
      boundary.totalChips!==roster.length*1500||
      boundary.stacks.some(n=>!integer(n))||
      boundary.stacks.reduce((n,v)=>n+v,0)!==boundary.totalChips||
      !Number.isInteger(boundary.button)||boundary.button<0||
      boundary.button>=roster.length||!Number.isInteger(boundary.bb)||
      boundary.bb<0||boundary.bb>=roster.length||
      !integer(boundary.previousSeatCount)||boundary.previousSeatCount<2||
      boundary.previousSeatCount>roster.length||
      !boundary.stats||!['played','wins','losses','ties'].every(k=>integer(boundary.stats[k]))||
      !Array.isArray(boundary.publicActions)||boundary.publicActions.length>240||
      boundary.publicActions.some(a=>!a||!integer(a.hand)||a.hand<1||
        a.hand>boundary.hand||!Number.isInteger(a.street)||a.street<0||
        a.street>3||!integer(a.seat)||a.seat>=roster.length||
        !['fold','check','call','raise'].includes(a.type)||!integer(a.paid)||
        !integer(a.facing)||!integer(a.potBefore)||
        a.raiseTo!==null&&!integer(a.raiseTo))||
      !Array.isArray(raw.aiStates)||raw.aiStates.length!==
        roster.filter(p=>p.type==='ai').length)return null;
   // AI public-memory is further validated against actual roster and hand by
   // HoldemAICharacter.restore when a new session is constructed.
   const styleSet=new Set(['nit','tag','lag','calling-station','tricky','balanced']);
   const skillSet=new Set(['novice','casual','standard','expert']);
   const allowedAI=new Set(roster.flatMap((p,i)=>p.type==='ai'?[i]:[]));
   const aiStates=raw.aiStates.map(x=>{
     if(!x||typeof x!=='object'||!allowedAI.has(x.seat)||
        !styleSet.has(x.style)||!skillSet.has(x.skill)||
        !['confidence','frustration','pressure'].every(k=>
          Number.isFinite(x[k])&&x[k]>=0&&x[k]<=1)||
        !integer(x.lastPublicHand)||x.lastPublicHand>boundary.hand||
        !integer(x.lastResultHand)||x.lastResultHand>boundary.hand||
        !Number.isSafeInteger(x.lastActionIndex)||x.lastActionIndex < -1||
        !x.opponents||typeof x.opponents!=='object'||
        Array.isArray(x.opponents))return null;
     const opponents={};
     for(const [k,p] of Object.entries(x.opponents)){
       if(!/^[0-5]$/.test(k)||Number(k)===x.seat||
          Number(k)>=roster.length||!p||typeof p!=='object'||
          !['raises','calls','folds','observed'].every(prop=>
             Number.isFinite(p[prop])&&p[prop]>=0))return null;
       opponents[k]={raises:p.raises,calls:p.calls,
         folds:p.folds,observed:p.observed};
     }
     return {seat:x.seat,style:x.style,skill:x.skill,
       confidence:x.confidence,frustration:x.frustration,pressure:x.pressure,
       lastPublicHand:x.lastPublicHand,lastActionIndex:x.lastActionIndex,
       lastResultHand:x.lastResultHand,opponents,
       lastSelfAction:x.lastSelfAction===null?null:
         ['fold','check','call','raise'].includes(x.lastSelfAction)?
         x.lastSelfAction:null,
       lastEvent:['idle','self','observed-raise','observed-action','won','lost']
         .includes(x.lastEvent)?x.lastEvent:'idle'};
   });
   if(aiStates.includes(null)||
      new Set(aiStates.map(x=>x.seat)).size!==allowedAI.size)return null;
   const records=Array.isArray(raw.history)?raw.history.slice(0,20):[];
   const archive=[];
   for(const entry of records){
     const safe=History.restore(entry);
     if(!safe||safe.hand>boundary.hand)return null;
     archive.push(safe);
   }
   return {version:1,roster,boundary,aiStates,history:archive};
 }
 function capture(game,roster,session,records=[]){
   if(!game||typeof game.boundary!=='function'||!session)return null;
   const boundary=game.boundary();
   if(!boundary)return null; // NEVER save a hand in progress
   const aiStates=session.seats().map(seat=>session.state(seat));
   return normalize({version:1,roster,boundary,aiStates,history:records});
 }
 function store(){
   try{return typeof localStorage==='undefined'?null:localStorage;}
   catch(_){return null;}
 }
 function load(storage){
   try{
     const source=storage||store(),raw=source&&source.getItem(KEY);
     return typeof raw==='string'&&raw.length<260000?
       normalize(JSON.parse(raw)):null;
   }catch(_){return null;}
 }
 function save(snapshot,storage){
   const record=normalize(snapshot);
   if(!record)return false;
   try{
     const source=storage||store();
     if(!source)return false;
     const contents=JSON.stringify(record);
     if(contents.length>240000)return false;
     source.setItem(KEY,contents);
     return true;
   }catch(_){return false;}
 }
 function clear(storage){
   try{const source=storage||store();if(source)source.removeItem(KEY);}
   catch(_){/* blocked file/private storage */ }
 }
 return Object.freeze({KEY,normalize,capture,load,save,clear});
});