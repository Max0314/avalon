import {GameError,playerView,randomInt,ROLES,shuffle} from './engine.mjs';

function needsBotAction(view){
  const {game,me}=view;
  switch(game.phase){
    case 'reveal':return !game.confirmed.includes(me);
    case 'nominate':return game.leaderId===me;
    case 'vote':return !game.voted.includes(me);
    case 'quest':return game.team.includes(me)&&game.myQuest===null;
    case 'lady':return game.ladyHolder===me;
    case 'assassin':return game.myRole==='assassin';
    default:return false;
  }
}

export function nextBotView(room){
  if(!room.game||room.closed)return null;
  for(const player of room.players){
    if(!player.bot)continue;
    const view=playerView(room,player.id);
    if(needsBotAction(view))return view;
  }
  return null;
}

// The strategy receives only this bot's private clues and the public table.
export function botAction(view,rng=randomInt){
  const {game,me,players}=view;
  const evil=ROLES[game.myRole].side==='evil';
  const knownEvil=new Set(game.intel.filter(p=>['邪恶阵营','邪恶同伴'].includes(p.label)).map(p=>p.id));
  for(const clue of game.privateIntel)if(clue.side==='evil')knownEvil.add(clue.playerId);
  const otherIds=players.filter(p=>p.id!==me).map(p=>p.id);
  switch(game.phase){
    case 'reveal':return ['confirmRole',{}];
    case 'nominate': {
      const shuffled=shuffle(otherIds,rng);
      const preferred=shuffled.filter(id=>evil===knownEvil.has(id));
      const remaining=shuffled.filter(id=>evil!==knownEvil.has(id));
      return ['nominate',{players:[me,...preferred,...remaining].slice(0,game.needed)}];
    }
    case 'vote': {
      const knownOnTeam=game.team.some(id=>knownEvil.has(id));
      const ownOnTeam=game.team.includes(me);
      let threshold=evil?(knownOnTeam||ownOnTeam?86:43):(knownOnTeam?22:74);
      if(!evil&&game.rejections>=3)threshold=Math.max(threshold,64);
      return ['vote',{approve:rng(100)<threshold}];
    }
    case 'quest': {
      const endgame=game.results.filter(result=>!result.success).length>=2||game.threshold===2;
      return ['quest',{success:!evil||!endgame&&rng(100)>=84}];
    }
    case 'lady': {
      const choices=otherIds.filter(id=>!game.ladyHolders.includes(id));
      return ['inspect',{playerId:choices[rng(choices.length)]}];
    }
    case 'assassin': {
      const unknown=otherIds.filter(id=>!knownEvil.has(id));
      return ['assassinate',{playerId:unknown[rng(unknown.length)]}];
    }
    default:throw new GameError('BOT_WAIT','请先完成你的当前操作。');
  }
}
