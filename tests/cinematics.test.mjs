import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sceneEvents,createSceneQueue} from '../web/scenes.mjs';

function view(version,phase,patch={}) {
  return {id:'room',version,me:'self',players:[{id:'self',name:'自己'},{id:'other',name:'同桌'}],
    game:phase&&{id:'game',phase,confirmed:[],team:['self','other'],questSubmitted:[],voted:[],
      results:[],proposals:[],privateIntel:[],myRole:'percival',...patch}};
}

test('首个快照、恢复和身份变化不重播，只有已确认的本人接收角色演出', () => {
  const lobby=view(2,null), reveal=view(3,'reveal');
  assert.deepEqual(sceneEvents(null,reveal),[]);
  assert.deepEqual(sceneEvents(lobby,reveal,{live:false}),[]);
  assert.deepEqual(sceneEvents(lobby,{...reveal,me:'other'}),[]);
  assert.deepEqual(sceneEvents(lobby,reveal).map(e=>e.kind),['deal']);
  assert.deepEqual(sceneEvents(reveal,view(4,'reveal',{confirmed:['other']})),[]);
  const confirmed=view(5,'nominate',{confirmed:['self','other']});
  const [identity]=sceneEvents(reveal,confirmed);
  assert.equal(identity.portrait,'/art/court/percival.webp');
  assert.equal(identity.private,true);
  assert.equal(sceneEvents(reveal,confirmed,{publicOnly:true}).some(e=>e.private||e.portrait),false);
});

test('私密表决和任务牌使用相同回执，最后一票先播放回执再揭晓', () => {
  const before=view(6,'vote',{voted:['other']});
  const result=view(7,'quest',{voted:['other','self'],myVote:true, proposals:[
    {approved:true,votes:{self:true,other:true}}
  ]});
  const output=sceneEvents(before,result);
  assert.deepEqual(output.map(e=>e.kind),['receipt','verdict']);
  assert.equal(output[0].cue,'wax');
  assert.deepEqual(output[0],sceneEvents(before,{...result,game:{...result.game,myVote:false}})[0]);

  const quest=view(8,'quest',{questSubmitted:['other'],myQuest:null});
  const revealed=view(9,'questResult',{results:[{quest:1,success:true,successes:2,fails:0,team:['self','other']}],myQuest:null});
  assert.deepEqual(sceneEvents(quest,revealed).map(e=>e.kind),['receipt','quest']);
  assert.deepEqual(sceneEvents(quest,revealed,{publicOnly:true}).map(e=>e.kind),['quest']);
  assert.deepEqual(sceneEvents(revealed,revealed),[]);
});

test('湖中仙女结果仅原持有者可见，公共终局使用已揭晓的指认对象', () => {
  const before=view(10,'lady',{ladyHolder:'self'});
  const after=view(11,'nominate',{privateIntel:[{playerId:'other',side:'good'}]});
  const [check]=sceneEvents(before,after);
  assert.equal(check.detail,'同桌 · 好人阵营');
  assert.equal(check.private,true);
  assert.equal(sceneEvents(before,after,{publicOnly:true}).some(e=>e.detail?.includes('好人阵营')),false);
  const [end]=sceneEvents(view(12,'assassin'),view(13,'finished',{winner:'good',reason:'merlin-survived',assassinated:'other'}));
  assert.equal(end.mode,'critical');
  assert.equal(end.winner,'good');
  assert.match(end.detail,/同桌/);
});

test('个人回执不会被新阶段截断，轻提示让位，取消会丢弃待播场景', () => {
  const timers = new Map(), seen = [], cleared = [];
  let next=0, skip;
  const queue=createSceneQueue({
    present(entry,dismiss) { skip=dismiss; seen.push(entry.kind); return abrupt=>cleared.push([entry.kind,abrupt]); },
    duration:()=>1,
    clock:{setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);}},
  });
  const events = (...kinds)=>kinds.map(kind=>({kind}));
  queue.push(events('notice'));
  queue.push(events('receipt','quest'));
  queue.push(events('ending'));
  assert.deepEqual(seen,['notice','receipt']);
  timers.get(next)();
  assert.deepEqual(seen,['notice','receipt','quest']);
  skip();
  assert.deepEqual(seen,['notice','receipt','quest','ending']);
  queue.push(events('notice'));
  queue.reset();
  assert.deepEqual(cleared,[['notice',true],['receipt',false],['quest',true],['ending',true]]);
  assert.equal(timers.size,0);
  assert.equal(queue.busy,false);
});
