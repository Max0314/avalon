import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import jsQR from 'jsqr';
import {buildApp} from '../server/app.mjs';

const app=buildApp({rateLimit:false});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${app.server.address().port}`;app.publicOrigin=base;
const browser=await chromium.launch({headless:true});
const contexts=[],errors=[];mkdirSync('test-results',{recursive:true});
async function player(name,mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1360,height:960}});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(base);await page.locator('#network-state').filter({hasText:'在线服务就绪'}).waitFor();await page.locator('#nickname').fill(name);return page;
}
async function click(page,id){await page.locator('#'+id).click();}
async function snapshot(page){return page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();return s.room;});}
async function phase(page,text){await page.locator('.phase-heading h2').filter({hasText:text}).waitFor();}
async function reveal(p){await p.locator('#peek-role').first().click();const role=await p.locator('.role-name').textContent();await p.locator('#hold-role').focus();await p.keyboard.down(' ');await p.waitForTimeout(300);await p.keyboard.up(' ');await click(p,'confirm-role');return role;}
async function qr(page,id){return page.locator('#'+id).evaluate(canvas=>{const c=canvas.getContext('2d');return {width:canvas.width,height:canvas.height,data:Array.from(c.getImageData(0,0,canvas.width,canvas.height).data)};});}
async function pair(host,guest){
  await click(host,'pair-host');await host.locator('#offer-text').waitFor({state:'attached'});
  const offer=await host.locator('#offer-text').inputValue();
  const pixels=await qr(host,'pair-qr');assert.equal(jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height)?.data,offer,'真实邀请二维码可被扫描器解码');
  await click(guest,'join-offline');await guest.locator('#paste-code').fill(offer);await click(guest,'use-pasted');await guest.locator('#answer-result').waitFor({state:'attached'});
  const answer=await guest.locator('#answer-result').inputValue();await host.locator('#answer-text').fill(answer);await click(host,'accept-answer');await guest.locator('.room-code').waitFor();await guest.locator('#modal').waitFor({state:'hidden'});
}
try{
  console.log('在线：5 个独立访客浏览器，完整三次任务及刺杀流程');
  const pages=[];for(let i=0;i<5;i++)pages.push(await player('在线玩家'+(i+1),i===4));
  await click(pages[0],'create-online');const code=await pages[0].locator('.room-code').textContent();
  for(const p of pages.slice(1)){await p.locator('#join-code').fill(code);await click(p,'join-online');await p.locator('.room-code').waitFor();}
  for(const p of pages)await click(p,'ready');await click(pages[0],'start');
  await phase(pages[0],'确认身份');
  await pages[0].screenshot({path:'test-results/desktop-reveal.png',fullPage:true});
  const before=await snapshot(pages[0]);assert(!('roles'in before.game));assert(!('questCards'in before.game));
  await pages[0].locator('#peek-role').first().click();await click(pages[0],'modal-close');assert.equal((await snapshot(pages[0])).game.phase,'reveal');
  for(const p of pages)await reveal(p);
  const views=await Promise.all(pages.map(snapshot));const ids=views.map(v=>v.me),good=views.filter(v=>['merlin','percival','servant'].includes(v.game.myRole)).map(v=>v.me);
  assert.equal(good.length,3);
  for(let round=0;round<3;round++){
    await phase(pages[0],'队长组队');const v=await snapshot(pages[0]),leader=pages[ids.indexOf(v.game.leaderId)],team=good.slice(0,v.game.needed);
    for(const id of team)await leader.locator(`[data-seat="${id}"]`).click();await click(leader,'nominate');
    for(const p of pages)await click(p,'vote-yes');
    for(const id of team)await click(pages[ids.indexOf(id)],'quest-success');
    await click(pages[0],'continue');
  }
  await phase(pages[0],'刺杀梅林');const v=await snapshot(pages[0]),assassin=pages[ids.indexOf(v.game.assassinId)],target=views.find(v=>v.game.myRole==='percival').me;
  await assassin.locator(`[data-seat="${target}"]`).click();await click(assassin,'assassinate');await click(assassin,'confirm-action');await pages[0].getByText('好人守住了卡美洛',{exact:true}).waitFor();
  await click(pages[0],'rematch');await pages[4].reload();await pages[4].locator('.room-code').waitFor();assert.equal((await snapshot(pages[4])).me,ids[4]);assert.equal((await snapshot(pages[4])).players.length,5);
  console.log('离线：5 个独立浏览器实际 WebRTC 连接、二维码解码、刷新恢复座位');
  const off=[];for(let i=0;i<5;i++)off.push(await player('同桌玩家'+(i+1),i===4));
  await click(off[0],'create-offline');await off[0].locator('.room-code').waitFor();
  for(const guest of off.slice(1))await pair(off[0],guest);
  assert.equal(await off[0].locator('.roster-item').count(),5);
  await off[4].reload();await off[4].locator('#network-state').filter({hasText:'在线服务就绪'}).waitFor();await pair(off[0],off[4]);assert.equal(await off[0].locator('.roster-item').count(),5);
  for(const p of off)await click(p,'ready');await click(off[0],'start');for(const p of off)await reveal(p);await phase(off[4],'队长组队');
  await off[4].screenshot({path:'test-results/mobile-round-table.png',fullPage:true});
  assert(await off[4].evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px 页面无横向溢出');
  for(let turn=0;turn<5;turn++){
    const leader=await(async()=>{for(const p of off)if(await p.locator('#nominate').count())return p;throw new Error('没有队长');})();
    for(const seat of (await leader.locator('[data-seat]').all()).slice(0,2))await seat.click();await click(leader,'nominate');for(const p of off)await click(p,'vote-no');
    if(turn<4)await phase(off[0],'队长组队');
  }
  await off[0].getByText('邪恶笼罩了卡美洛',{exact:true}).waitFor();
  await off[0].reload();await off[0].locator('#restore-offline').waitFor();await click(off[0],'restore-offline');await off[0].getByText('邪恶笼罩了卡美洛',{exact:true}).waitFor();
  console.log('离线缓存：准备卡面后，网络关闭仍可重新打开并创建本机牌桌');
  const cached=await player('缓存玩家');await click(cached,'prepare-offline');await cached.getByText('离线素材已准备好。断网后可再次打开本站或主屏幕入口。',{exact:true}).waitFor();
  await cached.context().setOffline(true);await cached.reload();await cached.locator('#create-offline').waitFor();await click(cached,'create-offline');await cached.locator('.room-code').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS：完整在线局 / 离线局 / 重连 / QR 解码 / 离线缓存 / 移动布局，无浏览器脚本错误');
}catch(error){console.error(error);for(let i=0;i<contexts.length;i++)for(const p of contexts[i].pages())await p.screenshot({path:`test-results/failure-${i}.png`,fullPage:true}).catch(()=>{});process.exitCode=1;
}finally{await browser.close();await app.close();}
