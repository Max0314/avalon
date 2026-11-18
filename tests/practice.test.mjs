import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Practice} from '../web/practice.mjs';

const seat={id:'real-seat',name:'圆桌旅人',avatar:'pet-eleven'};

test('练习支持十人和指定本人身份，公开投影只在终局公开所有角色',async()=>{
  const views=[];
  const practice=new Practice(seat,view=>views.push(view),()=>{},
    {count:10,role:'oberon',paused:true,random:()=>0});
  try{
    const lobby=practice.view;
    assert.equal(lobby.players.length,10);
    assert.equal(lobby.players.filter(p=>p.bot&&p.ready).length,9);
    assert.equal(new Set(lobby.players.map(p=>p.avatar)).size,10);
    assert.equal(practice.step(),false);
    await assert.rejects(practice.command('start'),{code:'NOT_READY'});
    await practice.command('ready',{ready:true});
    await practice.command('start');
    assert.equal(practice.view.game.myRole,'oberon');
    assert.deepEqual(practice.view.game.intel,[]);
    assert(!Object.hasOwn(practice.view.game,'roles'));
    assert(!Object.hasOwn(practice,'room'));
    assert.equal(practice.view.game.confirmed.length,0);
    assert.equal(practice.step(),true);
    assert.equal(practice.view.game.confirmed.length,1);
    assert(!practice.view.game.confirmed.includes(seat.id));
    assert.equal(views.at(-1),practice.view);
  }finally{practice.close();}
});

test('五人练习用标准动作从确认身份走到终局，并等待真人房主推进任务',async()=>{
  const practice=new Practice(seat,()=>{},()=>{},{role:'minion',paused:true,random:()=>0});
  try{
    assert.equal(practice.view.settings.morgana,false);
    await assert.rejects(practice.command('settings',{settings:{morgana:true}}),{code:'PRACTICE_ROLE'});
    await practice.command('ready',{ready:true});
    await practice.command('start');
    assert.equal(practice.view.game.myRole,'minion');
    let sawQuestResult=false;
    for(let action=0;action<160&&practice.view.game.phase!=='finished';action++){
      if(practice.step())continue;
      const {game,players,me}=practice.view;
      switch(game.phase){
        case 'reveal':await practice.command('confirmRole');break;
        case 'nominate':await practice.command('nominate',{players:players.slice(0,game.needed).map(p=>p.id)});break;
        case 'vote':await practice.command('vote',{approve:true});break;
        case 'quest':
          assert(game.team.includes(me));
          await practice.command('quest',{success:false});break;
        case 'questResult':
          sawQuestResult=true;
          assert.equal(practice.canStep,false);
          await practice.command('continue');break;
        default:assert.fail('Unreachable real-player action: '+game.phase);
      }
    }
    assert(sawQuestResult);
    assert.equal(practice.view.game.phase,'finished');
    assert.equal(Object.keys(practice.view.game.roles).length,5);
    assert.equal(practice.view.game.roles[seat.id],'minion');
    await practice.command('reset');
    assert.equal(practice.view.game,null);
    assert(practice.view.players.every(p=>Boolean(p.bot)===p.ready));
  }finally{practice.close();}
});
