/* Highlight five cards from an ACTUALLY settled, authorized showdown only.
 * Uses the engine's evaluated five cards for a public pot winner; NEVER
 * recomputes pot eligibility or examines hidden player ranks/hole cards.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object' && module.exports) module.exports=api;
 else root.HoldemShowdownFive=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const key = c => c && Number.isInteger(c.rank) && /^[shdc]$/.test(c.suit) ?
   c.rank+':'+c.suit : '';
 function select(game, canShow, potIndex=0){
   const result=game && game.result,settlement=result && result.publicSettlement;
   if(!game||game.status!=='finished'||!result||result.reason!=='showdown'||
      !settlement||!Array.isArray(settlement.pots)||
      !Array.isArray(game.board)||game.board.length!==5||
      !Number.isInteger(potIndex)||potIndex<0||potIndex>=settlement.pots.length||
      typeof canShow!=='function')return null;
   const pot=settlement.pots[potIndex];
   if(!pot||!Array.isArray(pot.awards))return null;
   for(const winner of pot.awards){
     const seat=winner && winner.seat;
     if(!Number.isInteger(seat)||seat<0||seat>=game.players.length||
        !canShow(seat))continue; // mandatory privacy guard BEFORE private access
     const player=game.players[seat];
     const rank=result.ranks && result.ranks[seat];
     if(!player||!rank||!Array.isArray(rank.cards)||rank.cards.length!==5)continue;
     const five=rank.cards.map(c=>({rank:c.rank,suit:c.suit}));
     const seen=new Set(five.map(key));
     if(seen.size!==5||seen.has(''))continue;
     const boardIndices=game.board.flatMap((card,i)=>seen.has(key(card))?[i]:[]);
     const holeIndices=(Array.isArray(player.cards)?player.cards:[]).
       flatMap((card,i)=>seen.has(key(card))?[i]:[]);
     if(boardIndices.length+holeIndices.length!==5)continue;
     return Object.freeze({
       seat,potIndex,kind:pot.kind,name:String(player.name),
       handName:rank.name||'',description:rank.description||'',
       five:Object.freeze(five),boardIndices:Object.freeze(boardIndices),
       holeIndices:Object.freeze(holeIndices)
     });
   }
   return null;
 }
 return Object.freeze({select,key});
});