import {ROLES} from '../shared/engine.mjs';
// Never attach account IDs to projected room.players. This context is authority-only.
export function captureTransition(store,before,next,now) {
  if(!before.game&&next.game)next.journal={id:next.game.id,startedAt:now,players:next.players.map(p=>({seatId:p.id,name:p.name,avatar:p.avatar,accountId:store.personAccount?.(p.id)??null}))};
  if(next.game?.phase==='finished')settleGame(store,next,'completed',now);
  else if(before.game&&!next.game)settleGame(store,before,before.game.phase==='finished'?'completed':'aborted',now);
}
export function settleGame(store,room,status,now) {
  const context=room.journal;if(!context||context.settled)return;
  context.settled=true;const g=room.game,completed=status==='completed';
  const accounts=context.players.map(p=>p.accountId).filter(Boolean);
  const players=context.players.map(p=>({...p,accountId:p.accountId??store.personAccount?.(p.seatId)??null,side:completed?ROLES[g.roles[p.seatId]].side:null,role:completed?g.roles[p.seatId]:null,won:completed&&ROLES[g.roles[p.seatId]].side===g.winner}));
  store.journal.record({id:context.id,startedAt:context.startedAt,endedAt:now,status,mode:'online',eligible:completed&&accounts.length===players.length&&new Set(accounts).size===players.length,players,reason:completed?({'three-fails':'三次任务失败','five-rejections':'连续五次组队被否决','merlin-assassinated':'梅林被刺杀','merlin-survived':'梅林存活'}[g.reason]??'阵营胜负已结算'):'房主结束或房间过期',settings:{...room.settings},quests:completed?g.results:[],proposals:completed?g.proposals:[],winner:completed?g.winner:null});
}
