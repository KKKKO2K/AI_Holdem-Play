/* Public-only character adapter; default-on bounded mood, explicit opt-out. */
(function(root,factory){
  const C=typeof module==='object'&&module.exports?require('./ai-character'):root.HoldemAICharacter;
  const AI=typeof module==='object'&&module.exports?require('./ai'):root.HoldemAI;
  const api=factory(C,AI);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HoldemAICharacterSession=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(C,AI){
  'use strict';
  if(!C||!AI)throw Error('Character and AI modules required');
  const isSeat=(i,n)=>Number.isInteger(i)&&i>=0&&i<n;
  function create(game, restoredStates=null) {
    if(!game||!Array.isArray(game.players)||game.players.length<2||
      game.players.length>6||!Array.isArray(game.publicActions))
      throw Error('Expected two-to-six seat Game');
    const count=game.players.length;
    const makeStates=()=>{
      const map=new Map();
      game.players.forEach((p,seat)=>{
        if(p.type!=='ai')return;
        // Do NOT pass p.cards or any private state to the character.
        const profile=AI.normalizeProfile({
          name:p.name,mascot:p.mascot,aiStyle:p.aiStyle,aiSkill:p.aiSkill
        },seat);
        map.set(seat,C.create({seat,style:profile.style,skill:profile.skill}));
      });
      return map;
    };
    let states=makeStates(),lastAction=null,lastHand=game.handNumber,
      ordinalHand=-1,ordinal=-1,lastResult=0;
    if(restoredStates!==null){
      if(!Array.isArray(restoredStates)||restoredStates.length!==states.size)
        throw Error('Invalid restored AI character count');
      const maxHand=game.handNumber-1;
      for(const [seat,baseline] of states){
        const prior=restoredStates.find(x=>x&&x.seat===seat);
        states.set(seat,C.restore(prior,{
          seat,style:baseline.style,skill:baseline.skill,maxHand
        }));
      }
      // These historical actions are already incorporated in restored
      // public-memory states; resume after their last event, never replay
      // them into memory a second time.
      lastAction=game.publicActions[game.publicActions.length-1]||null;
      lastResult=maxHand;
    }
    let sent=new Set();
    const copy=v=>v===null?null:JSON.parse(JSON.stringify(v));
    function reset(){
      states=makeStates();lastAction=null;lastHand=game.handNumber;
      ordinalHand=-1;ordinal=-1;lastResult=0;sent=new Set();
    }
    function sync(){
      const actions=game.publicActions;
      if(!Array.isArray(actions))throw Error('Missing public-action ledger');
      if(game.handNumber<lastHand||(lastAction!==null&&actions.length===0))
        reset();
      lastHand=game.handNumber;
      let start=0;
      if(lastAction!==null){
        const at=actions.indexOf(lastAction);
        if(at<0)throw Error('Character cursor expired: sync after every action');
        start=at+1;
      }
      const events=[];
      for(let i=start;i<actions.length;i++){
        const a=actions[i];
        if(a.hand!==ordinalHand){ordinalHand=a.hand;ordinal=-1;}
        ordinal++;
        const e={hand:a.hand,street:a.street,seat:a.seat,type:a.type,
          paid:a.paid,potBefore:a.potBefore,actionIndex:ordinal};
        for(const [seat,previous] of states){
          const next=C.observePublicAction(previous,e);
          states.set(seat,next);
          const key=e.hand+':'+seat+':raise';
          if(e.type==='raise'&&e.seat!==seat&&!sent.has(key)&&
            game.players[seat].inHand !== false && !game.players[seat].folded &&
            next.lastPublicHand===e.hand){
            const cue=C.cue(next,{kind:'turn',hand:e.hand});
            if(cue){events.push({kind:'reaction',seat,hand:e.hand,style:next.style,...cue});sent.add(key);}
          }
        }
        lastAction=a;
      }
      if(game.status==='finished'&&game.result&&
        Number.isSafeInteger(game.handNumber)&&game.handNumber>lastResult){
        const r=game.result;
        // Important: do NOT pass or spread Game.result (contains ranks).
        const publicResult={hand:game.handNumber,reason:r.reason,
          winners:Array.isArray(r.winners)?r.winners.filter(s=>isSeat(s,count)):[],
          potSize:r.payout};
        for(const [seat,s] of states){
          const next=C.observeHandEnd(s,publicResult);
          states.set(seat,next);
          const cue=C.cue(next,{kind:'result',hand:game.handNumber});
          // Folding is often prudent; don't assign bad-beat emotions to
          // early folds, and reserve shaken cues for meaningful pots.
          if(cue && !game.players[seat].folded &&
              !(cue.cueId==='shaken' && r.payout < 160))
            events.push({kind:'result',seat,hand:game.handNumber,style:next.style,...cue});
        }
        lastResult=game.handNumber;
      }
      return events;
    }
    function state(seat){
      if(!isSeat(seat,count))throw Error('Invalid character seat');
      return copy(states.get(seat)||null);
    }
    function decisionSnapshot(seat,options={}){
      if(!states.has(seat))throw Error('AI seat required');
      sync();
      const snapshot=AI.snapshot(game,seat);
      if(options.useMood!==false){
        const modifier=C.policyModifiers(states.get(seat));
        const owner=snapshot.players[seat];
        const base=AI.normalizeProfile(owner,seat);
        const traits={...owner.aiTraits};
        for(const [key,delta] of Object.entries(modifier)){
          const [min,max]=AI.TRAIT_BOUNDS[key];
          traits[key]=Math.max(min,Math.min(max,base[key]+delta));
        }
        owner.aiTraits=traits;
      }
      return snapshot;
    }
    function decision(seat,options={}){
      return AI.decision(decisionSnapshot(seat,options),{
        rng:options.rng,difficulty:options.difficulty,equityFn:options.equityFn
      });
    }
    function act(seat,options={}){
      const move=decision(seat,options);
      game.act(seat,move.type,move.amount);
      return {move,cues:sync()};
    }
    return {sync,state,decisionSnapshot,decision,act,reset,
      seats:()=>Array.from(states.keys())};
  }
  return {create};
});