import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {buildApp} from '../server/app.mjs';
import {joinRoom,applyCommand} from '../shared/engine.mjs';
const app=buildApp({rateLimit:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.publicOrigin=base;
const browser=await chromium.launch({headless:true});mkdirSync('test-results',{recursive:true});
try{
  const page=await browser.newPage();await page.goto(base);await page.locator('#create-online').waitFor();
  const person=await page.evaluate(async()=>(await(await fetch('/api/session')).json()).person);person.name='天地玄黄宇宙洪荒';
  let r=app.store.create(person,{});
  for(let i=1;i<10;i++)r=joinRoom(r,{id:crypto.randomUUID(),name:'天地玄黄宇宙洪'+i,avatar:'🦊'});
  for(const p of r.players)r=applyCommand(r,p.id,'ready',{ready:true});r=applyCommand(r,r.hostId,'start');
  r.game.phase='vote';r.game.team=r.players.slice(0,5).map(p=>p.id);r.game.votes=Object.fromEntries(r.players.slice(0,9).map(p=>[p.id,true]));app.store.save(r);
  for(const width of [320,390,960,1360]){
    await page.setViewportSize({width,height:900});await page.reload();await page.locator('.seat-button').first().waitFor();
    const boxes=await page.locator('.seat-button').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};}));assert.equal(boxes.length,10);
    for(let a=0;a<10;a++)for(let b=a+1;b<10;b++){const x=Math.min(boxes[a].x+boxes[a].w,boxes[b].x+boxes[b].w)-Math.max(boxes[a].x,boxes[b].x),y=Math.min(boxes[a].y+boxes[a].h,boxes[b].y+boxes[b].h)-Math.max(boxes[a].y,boxes[b].y);assert(x<=1||y<=1,`${width}px：座位 ${a+1}/${b+1} 重叠`);}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px 横向溢出`);
    if(width===390)await page.screenshot({path:'test-results/mobile-ten-players.png',fullPage:true});
  }
  console.log('PASS：十人最长昵称、组队/表决标记在 320/390/960/1360px 下无重叠或横向溢出');
}finally{await browser.close();await app.close();}
