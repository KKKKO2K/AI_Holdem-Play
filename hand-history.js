/* Replay of settled PUBLIC facts. Never captures a human hole card,
 * hidden AI hole cards, burns, deck, private reads or AI mood/state.
 * Fixed-size in-memory snapshots (no storage until explicitly designed).
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports) module.exports=api;
 else root.HoldemHandHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const suit=/^[shdc]$/;
 const card=c=>c&&Number.isInteger(c.rank)&&c.rank>=2&&c.rank<=14&&
   suit.test(c.suit)?Object.freeze({rank:c.rank,suit:c.suit}):null;
 const int=n=>Number.isSafeInteger(n)&&n>=0?n:0;
 const STREETS=['Preflop','Flop','Turn','River'];
 const VISIBILITY='Public replay · private human cards are never archived.';
 function capture(game){
   if(!game||game.status!=='finished'||!game.result||
      !game.result.publicSettlement||!Array.isArray(game.players)) return null;
   const settlement=game.result.publicSettlement;
   if(settlement.hand!==game.handNumber||!['fold','showdown'].includes(settlement.reason))return null;
   const names=game.players.map(p=>({name:String(p.name).slice(0,36),type:p.type}));
   const board=(Array.isArray(game.board)?game.board:[]).map(card);
   if(board.includes(null))return null;
   const events=(Array.isArray(game.publicActions)?game.publicActions:[])
     .filter(e=>e&&e.hand===game.handNumber&&Number.isInteger(e.seat)&&
       e.seat>=0&&e.seat<names.length&&Number.isInteger(e.street)&&
       e.street>=0&&e.street<=3&&['raise','fold','call','check'].includes(e.type))
     .map(e=>Object.freeze({seat:e.seat,street:e.street,type:e.type,
       paid:int(e.paid),potBefore:int(e.potBefore),
       facing:int(e.facing),raiseTo:e.raiseTo==null?null:int(e.raiseTo)}));
   // No access to human p.cards, even if the user originally saw them.
   const revealed=game.players.flatMap((p,seat)=>{
     if(settlement.reason!=='showdown'||p.type!=='ai'||p.folded||
        p.inHand===false)return [];
     const cards=Array.isArray(p.cards)?p.cards.map(card):[];
     return cards.length===2&&!cards.includes(null)?
       [Object.freeze({seat,cards:Object.freeze(cards)})]:[];
   });
   const pots=settlement.pots.map(p=>Object.freeze({
     kind:p.kind,index:p.index,amount:int(p.amount),
     awards:Object.freeze(p.awards.map(a=>Object.freeze({
       seat:a.seat,amount:int(a.amount)})))
   }));
   return Object.freeze({
     hand:game.handNumber,reason:settlement.reason,blinds:[game.smallBlind,game.bigBlind],
     names:Object.freeze(names),board:Object.freeze(board),
     events:Object.freeze(events),revealed:Object.freeze(revealed),
     settlement:Object.freeze({payout:int(settlement.payout),pots:Object.freeze(pots)})
   });
 }
 function timeline(record){
   if(!record)return [];
   const result=[{kind:'start',street:0,board:[],
     label:'Blinds '+record.blinds[0]+'/'+record.blinds[1],pot:null}];
   let street=0;
   function reveal(next){
     street=next;
     const n=street===1?3:street===2?4:5;
     const shown=record.board.slice(0,n);
     result.push({kind:'street',street,board:shown,
       label:STREETS[street]+' dealt',pot:null});
   }
   for(const e of record.events){
     while(street<e.street)reveal(street+1);
     const actor=record.names[e.seat]?.name||'Seat '+(e.seat+1);
     const verb=e.type==='raise'?'raises to '+e.raiseTo:
       e.type==='call'?'calls '+e.paid:e.type==='check'?'checks':'folds';
     result.push({kind:'action',street:e.street,board:record.board.slice(0,
       e.street===0?0:e.street===1?3:e.street===2?4:5),
       label:actor+' '+verb,pot:e.potBefore+e.paid});
   }
   while(street<(record.board.length===5?3:record.board.length===4?2:
     record.board.length===3?1:0))reveal(street+1);
   const awards=record.settlement.pots.flatMap(p=>p.awards.map(a=>
     (record.names[a.seat]?.name||'Seat '+(a.seat+1))+
     ' +'+a.amount+' ('+ (p.kind==='main'?'main':'side') +' pot)'));
   result.push({kind:'result',street,board:record.board.slice(),
     label:(record.reason==='showdown'?'Showdown · ':'Won by folds · ')+
       awards.join(' · '),pot:0,
     revealed:record.revealed}); // AI hole cards disclosed only at true showdown
   return result;
 }
 function append(records,record,limit=20){
   if(!record)return records.slice();
   return [record,...records.filter(r=>r.hand!==record.hand)].slice(0,limit);
 }
 // Saved-match archives must remain public-only after decoding localStorage.
 function restore(raw){
   if(!raw||!Number.isSafeInteger(raw.hand)||raw.hand<1||
      !['fold','showdown'].includes(raw.reason)||
      !Array.isArray(raw.names)||raw.names.length<2||raw.names.length>6||
      !Array.isArray(raw.board)||raw.board.length>5||
      !Array.isArray(raw.events)||raw.events.length>300||
      !Array.isArray(raw.revealed)||raw.revealed.length>6||
      !raw.settlement||!Array.isArray(raw.settlement.pots)||
      raw.settlement.pots.length>6||!Array.isArray(raw.blinds)||
      raw.blinds.length!==2)return null;
   const names=raw.names.map(n=>({name:String(n.name||'Guest').slice(0,36),
     type:n.type==='ai'?'ai':'human'}));
   const board=raw.board.map(card);
   if(board.includes(null))return null;
   const events=[];
   for(const e of raw.events){
     if(!e||!Number.isInteger(e.seat)||e.seat<0||e.seat>=names.length||
        !Number.isInteger(e.street)||e.street<0||e.street>3||
        !['fold','call','check','raise'].includes(e.type)||!Number.isSafeInteger(e.paid)||
        e.paid<0||!Number.isSafeInteger(e.potBefore)||e.potBefore<0)return null;
     events.push({seat:e.seat,street:e.street,type:e.type,paid:e.paid,
       potBefore:e.potBefore,facing:int(e.facing),
       raiseTo:e.raiseTo==null?null:int(e.raiseTo)});
   }
   const revealed=[];
   for(const r of raw.revealed){
     if(raw.reason!=='showdown'||!r||!Number.isInteger(r.seat)||
        r.seat<0||r.seat>=names.length||names[r.seat].type!=='ai'||
        !Array.isArray(r.cards)||r.cards.length!==2)return null;
     const cards=r.cards.map(card);
     if(cards.includes(null))return null;
     revealed.push({seat:r.seat,cards});
   }
   const pots=[];
   for(const p of raw.settlement.pots){
     if(!p||!Number.isSafeInteger(p.amount)||p.amount<0||
        !Array.isArray(p.awards)||p.awards.length>6)return null;
     const awards=[];
     for(const award of p.awards){
       if(!award||!Number.isInteger(award.seat)||award.seat<0||
          award.seat>=names.length||!Number.isSafeInteger(award.amount)||
          award.amount<0)return null;
       awards.push({seat:award.seat,amount:award.amount});
     }
     pots.push({kind:p.kind==='main'?'main':'side',index:pots.length,
       amount:p.amount,awards});
   }
   const payout=pots.reduce((n,p)=>n+p.amount,0);
   if(payout!==raw.settlement.payout)return null;
   return {hand:raw.hand,reason:raw.reason,blinds:raw.blinds.map(int),
     names,board,events,revealed,settlement:{payout,pots}};
 }
 return Object.freeze({capture,timeline,append,restore,VISIBILITY});
});