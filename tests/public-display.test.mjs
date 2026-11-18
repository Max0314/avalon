import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectDisplay} from '../web/public-display.mjs';

test('大屏在终局前只共享公开状态，终局共享已揭晓角色',()=>{
  const player={id:'self',name:'旅人',avatar:'',ready:true,online:true,session:'sensitive'};
  const view={id:'room',code:'ABCD012345',version:7,me:'self',players:[player],game:{
    id:'game',phase:'vote',leaderId:'self',team:['self'],voted:['self'],
    needed:2,questIndex:0,proposals:[],results:[],rejections:0,myRole:'merlin',
    privateIntel:[{playerId:'secret-clue'}],myVote:false, myQuest:false,
  }};
  const display=projectDisplay(view);
  assert.equal(display.players[0].voted,true);
  assert.equal(display.players[0].publicRole,null);
  const wire=JSON.stringify(display);
  for(const privateValue of ['sensitive','merlin','secret-clue','myVote','myQuest','privateIntel'])assert(!wire.includes(privateValue));
  view.game.phase='finished';
  view.game.roles={self:'merlin'};
  view.game.winner='good';
  assert.equal(projectDisplay(view).players[0].publicRole,'merlin');
  assert.equal(projectDisplay({...view,closed:true}),null);
});
