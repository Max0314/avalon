import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import jsQR from 'jsqr';
import {buildApp} from '../server/app.mjs';

const app=buildApp({rateLimit:false,botTurnDelay:65});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${app.server.address().port}`;app.publicOrigin=base;
// Some isolated runners have no working mDNS. Numeric ICE still exercises the real data channel.
const browser=await chromium.launch({headless:true,
  args:process.env.AVALON_TEST_NUMERIC_ICE==='1'?['--disable-features=WebRtcHideLocalIpsWithMdns']:[]});
const contexts=[],errors=[];mkdirSync('test-results',{recursive:true});
const names=new WeakMap();
async function player(name,mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1360,height:960},reducedMotion:'reduce'});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(base);await page.locator('#network-state').filter({hasText:'在线服务就绪'}).waitFor();
  names.set(page,name);return page;
}
async function click(page,id){await page.locator('#'+id).click();}
async function setupOnline(page,code){
  await click(page,code?'join-online':'create-online');
  if(code)await page.locator('#join-code').fill(code);
  await page.locator('#nickname').fill(names.get(page));
  await click(page,'submit-online');
  await page.locator('.room-code').waitFor();
}
async function setupOffline(page,joining=false){
  await click(page,'offline-menu');await click(page,joining?'join-offline':'create-offline');
  await page.locator('#nickname').fill(names.get(page));
  await click(page,'submit-offline');
}
async function fixedViewport(page){
  assert(await page.evaluate(()=>{
    window.scrollTo(0,9999);
    return scrollY===0&&document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight;
  }),'应用整页保持固定视口');
}
async function snapshot(page){return page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();return s.room;});}
async function phase(page,text){await page.locator('.phase-heading h2').filter({hasText:text}).waitFor();}
async function reveal(p){
  await p.locator('#peek-role').first().click();
  const role=await p.locator('.identity-details .role-name').textContent();
  await click(p,'confirm-role');
  return role;
}
async function qr(page,id){return page.locator('#'+id).evaluate(canvas=>{const c=canvas.getContext('2d');return {width:canvas.width,height:canvas.height,data:Array.from(c.getImageData(0,0,canvas.width,canvas.height).data)};});}
async function pair(host,guest,{retry=false}={}){
  await click(host,'pair-host');await host.locator('#offer-text').waitFor({state:'attached'});
  const offer=await host.locator('#offer-text').inputValue();
  const pixels=await qr(host,'pair-qr');assert.equal(jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height)?.data,offer,'真实邀请二维码可被扫描器解码');
  await setupOffline(guest,true);await guest.locator('#paste-code').fill(offer);await click(guest,'use-pasted');await guest.locator('#answer-result').waitFor({state:'attached'});
  if(retry){
    await guest.locator('#pair-status').filter({hasText:'等待房主扫描'}).waitFor();
    await click(guest,'retry-offline-pair');
    await guest.locator('#paste-code').fill(offer);
    await click(guest,'use-pasted');
    await guest.locator('#answer-result').waitFor({state:'attached'});
  }
  assert(await guest.locator('#answer-qr').evaluate(canvas=>{
    const qr=canvas.getBoundingClientRect(),modal=canvas.closest('dialog').getBoundingClientRect();
    return qr.width>0&&qr.left>=modal.left&&qr.right<=modal.right;
  }),'回答二维码完整显示在弹窗内');
  const answer=await guest.locator('#answer-result').inputValue();
  await host.locator('#answer-text').fill(answer);await click(host,'accept-answer');
  await guest.locator('.room-code').waitFor({timeout:45000});await guest.locator('#modal').waitFor({state:'hidden'});
}
try{
  console.log('在线：5 个独立访客浏览器，完整三次任务及刺杀流程');
  const pages=[];for(let i=0;i<5;i++)pages.push(await player(i===4?'长昵称'.repeat(10):'在线玩家'+(i+1),i===4));
  assert.match(await pages[0].locator('link[rel="stylesheet"]').getAttribute('href'),/^\/assets\/styles-[a-f0-9]{16}\.css$/,'升级不复用旧 SW 的固定样式 URL');
  await fixedViewport(pages[4]);
  await pages[0].screenshot({path:'test-results/desktop-home.png',fullPage:true});
  await pages[4].screenshot({path:'test-results/mobile-home.png',fullPage:true});
  const mobile=pages[4], stage=await mobile.locator('.portrait-stage').boundingBox();
  await mobile.mouse.move(stage.x+stage.width*.55,stage.y+stage.height*.55);
  await mobile.mouse.down();
  await mobile.mouse.move(stage.x+stage.width*.25,stage.y+stage.height*.55,{steps:6});
  await mobile.mouse.up();
  assert.equal(await mobile.locator('[data-portrait-count]').textContent(),'2 — 8');
  await click(mobile,'join-online');
  await mobile.locator('#nickname').fill('保留的昵称');
  await mobile.locator('#join-code').fill('A0B1C2D3E4');
  await mobile.locator('[data-entry-mode="create"]').click();
  assert.equal(await mobile.locator('#nickname').inputValue(),'保留的昵称');
  assert.equal(await mobile.locator('#join-code').count(),0);
  await mobile.locator('[data-entry-mode="join"]').click();
  assert.equal(await mobile.locator('#join-code').inputValue(),'A0B1C2D3E4');
  assert.equal(await mobile.locator('#nickname').inputValue(),'保留的昵称');
  await mobile.setViewportSize({width:390,height:406});
  await fixedViewport(mobile);
  const submit=await mobile.locator('#submit-online').boundingBox();
  assert(submit.y+submit.height<=406,'可视区缩小时加入确认始终可达');
  await mobile.setViewportSize({width:390,height:844});
  await mobile.evaluate(()=>{
    const viewport=window.visualViewport;
    Object.defineProperties(viewport,{
      height:{configurable:true,value:330},
      offsetTop:{configurable:true,value:95},
    });
    viewport.dispatchEvent(new Event('resize'));
  });
  const keyboardSubmit=await mobile.locator('#submit-online').boundingBox();
  assert(keyboardSubmit.y>=95&&keyboardSubmit.y+keyboardSubmit.height<=425,
    `键盘只改变可视视口时确认按钮仍在可视区，实际在 ${keyboardSubmit.y}–${keyboardSubmit.y+keyboardSubmit.height}px`);
  await click(mobile,'modal-close');
  await mobile.evaluate(()=>{
    const viewport=window.visualViewport;
    delete viewport.height;
    delete viewport.offsetTop;
    viewport.dispatchEvent(new Event('resize'));
  });
  await click(pages[0],'home-handbook');
  await pages[0].getByRole('tab',{name:'角色图鉴'}).waitFor();
  await pages[0].locator('.handbook-role-button[data-role="merlin"]').click();
  assert.equal(await pages[0].locator('.handbook-profile img').first().getAttribute('src'),'/art/court/merlin.webp');
  await pages[0].locator('[data-role-back]').first().click();
  await click(pages[0],'modal-close');
  await click(pages[0],'audio-settings');
  await pages[0].locator('#audio-track').selectOption('dusk');
  await pages[0].locator('[data-audio=effects]').uncheck();
  await click(pages[0],'modal-close');
  await click(pages[0],'audio-settings');
  assert.equal(await pages[0].locator('#audio-track').inputValue(),'dusk');
  assert.equal(await pages[0].locator('[data-audio=effects]').isChecked(),false);
  await click(pages[0],'modal-close');
  await setupOnline(pages[0]);const code=await pages[0].locator('.room-code').textContent();
  assert.equal(await pages[0].locator('body').getAttribute('data-lighting'),'day','随对局时大厅使用日景');
  for(const p of pages.slice(1))await setupOnline(p,code);
  await fixedViewport(mobile);
  const lobby=(await snapshot(pages[0])).players;
  const from=await pages[0].locator('.roster-item').nth(0).boundingBox();
  const to=await pages[0].locator('.roster-item').nth(2).boundingBox();
  await pages[0].mouse.move(from.x+25,from.y+from.height/2);
  await pages[0].mouse.down();await pages[0].waitForTimeout(670);
  await pages[0].mouse.move(to.x+25,to.y+to.height*.8,{steps:9});await pages[0].mouse.up();
  await pages[0].waitForFunction(id=>document.querySelector('.roster-item')?.dataset.playerRow===id,lobby[1].id);
  assert.equal((await snapshot(pages[0])).players[0].id,lobby[1].id,'长按排序由服务端保存');
  for(const p of pages)await click(p,'ready');await click(pages[0],'start');
  await phase(pages[0],'确认身份');
  assert.equal(await pages[0].locator('body').getAttribute('data-lighting'),'night','随对局时身份确认使用夜景');
  await pages[0].screenshot({path:'test-results/desktop-reveal.png',fullPage:true});
  const before=await snapshot(pages[0]);assert(!('roles'in before.game));assert(!('questCards'in before.game));
  const first=pages[0];
  assert.equal(await first.locator('.identity-details').count(),0,'牌桌不渲染未打开的身份');
  await first.locator('#peek-role').first().click();
  assert(await first.locator('.identity-details').isVisible(),'单击直接显示身份');
  await click(first,'cover-identity');
  assert.equal(await first.locator('.identity-details').count(),0,'盖住后移除身份内容');
  await first.locator('#peek-role').first().click();
  await first.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await first.locator('.identity-details').count(),0,'失焦后移除身份内容');
  assert.equal((await snapshot(first)).game.phase,'reveal');
  for(const p of pages)await reveal(p);
  const views=await Promise.all(pages.map(snapshot));const ids=views.map(v=>v.me),good=views.filter(v=>['merlin','percival','servant'].includes(v.game.myRole)).map(v=>v.me);
  await fixedViewport(mobile);
  const table=await mobile.locator('.round-table').boundingBox();
  assert(Math.abs(table.width-table.height)<1,'手机桌面保持圆形');
  const displayPromise=pages[0].context().waitForEvent('page');
  await click(pages[0],'public-screen');
  const display=await displayPromise;
  await display.locator('.screen-seat').first().waitFor();
  assert.equal(await display.locator('.screen-seat').count(),5);
  assert.equal(await display.locator('#peek-role,.private-role,.intel').count(),0);
  for(const [width,height] of [[1920,1080],[3840,2160]]){
    await display.setViewportSize({width,height});
    await fixedViewport(display);
    const score=await display.locator('.screen-score').boundingBox();
    assert(score.x+score.width<=width&&score.y+score.height<=height,'1080p 与 4K 大屏完整显示比分');
  }
  await display.close();
  assert.equal(good.length,3);
  for(let round=0;round<3;round++){
    await phase(pages[0],'队长组队');const v=await snapshot(pages[0]),leader=pages[ids.indexOf(v.game.leaderId)],team=good.slice(0,v.game.needed);
    for(const id of team)await leader.locator(`[data-seat="${id}"]`).click();await click(leader,'nominate');
    for(const [i,p] of pages.entries()){
      if(round===0&&i===0){
        await click(p,'guide');
        await click(p,'guide-vote-yes');
        assert(await p.locator('#handbook').isVisible(),'手册内投票后仍在原处');
        await click(p,'modal-close');
      }else await click(p,'vote-yes');
    }
    for(const id of team)await click(pages[ids.indexOf(id)],'quest-success');
    await click(pages[0],'continue');
  }
  await phase(pages[0],'刺杀梅林');
  const assassinSeat=views.find(v=>v.game.myRole==='assassin').me;
  const assassin=pages[ids.indexOf(assassinSeat)],target=views.find(v=>v.game.myRole==='percival').me;
  for(const current of await Promise.all(pages.map(snapshot)))assert.equal(current.game.assassinId,current.me===assassinSeat?assassinSeat:undefined);
  await assassin.locator(`[data-seat="${target}"]`).click();await click(assassin,'assassinate');await click(assassin,'confirm-action');await pages[0].locator('.result-layout h2').filter({hasText:'好人守住了卡美洛'}).waitFor();
  await fixedViewport(mobile);
  console.log('游戏档案：游客完整记录、详情、排行榜空态和常玩伙伴入口');
  await click(pages[0],'player-records');await pages[0].locator('.journal-numbers b').first().filter({hasText:'1'}).waitFor();await pages[0].locator('[data-journal-match]').first().click();await pages[0].locator('.journal-detail').getByText('本场详情',{exact:true}).waitFor();assert.equal(await pages[0].locator('[data-journal-consent]').count(),0);await pages[0].getByRole('button',{name:'排行榜',exact:true}).click();await pages[0].getByText('暂无满足条件且自愿公开的玩家。普通游玩不要求参加榜单。',{exact:true}).waitFor();await pages[0].getByRole('button',{name:'常玩伙伴',exact:true}).click();await pages[0].getByText('与已登录玩家完成对局后，这里会显示共同场次。',{exact:true}).waitFor();await click(pages[0],'modal-close');
  await click(pages[0],'rematch');await pages[4].reload();await pages[4].locator('.room-code').waitFor();assert.equal((await snapshot(pages[4])).me,ids[4]);assert.equal((await snapshot(pages[4])).players.length,5);
  await pages[4].context().setOffline(true);
  await pages[4].locator('#network-state[data-state="reconnecting"]').waitFor();
  await click(pages[0],'ready');
  await pages[4].context().setOffline(false);
  await pages[4].locator('#network-state[data-state="live"]').waitFor();
  assert.equal((await snapshot(pages[4])).me,ids[4]);
  await pages[4].locator(`[data-player-row="${ids[0]}"] [data-ready="true"]`).waitFor();
  await Promise.all(pages.map(p=>p.context().close()));
  console.log('离线：5 个独立浏览器实际 WebRTC 连接、二维码解码、刷新恢复座位');
  const off=[];for(let i=0;i<5;i++)off.push(await player('同桌玩家'+(i+1),i===4));
  await setupOffline(off[0]);await off[0].locator('.room-code').waitFor();
  for(const [i,guest] of off.slice(1).entries())await pair(off[0],guest,{retry:i===0});
  assert.equal(await off[0].locator('.roster-item').count(),5);
  await off[4].reload();await off[4].locator('#network-state').filter({hasText:'在线服务就绪'}).waitFor();await pair(off[0],off[4]);assert.equal(await off[0].locator('.roster-item').count(),5);
  for(const p of off)await click(p,'ready');await click(off[0],'start');for(const p of off)await reveal(p);await phase(off[4],'队长组队');
  await off[4].screenshot({path:'test-results/mobile-round-table.png',fullPage:true});
  assert(await off[4].evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px 页面无横向溢出');
  for(let turn=0;turn<5;turn++){
    await Promise.all(off.map(p=>phase(p,'队长组队')));
    const leader=await(async()=>{for(const p of off)if(await p.locator('#nominate').count())return p;throw new Error('没有队长');})();
    for(const seat of (await leader.locator('[data-seat]').all()).slice(0,2))await seat.click();await click(leader,'nominate');for(const p of off)await click(p,'vote-no');
    if(turn<4)await phase(off[0],'队长组队');
  }
  await off[0].locator('.result-layout h2').filter({hasText:'邪恶笼罩了卡美洛'}).waitFor();
  await click(off[0],'player-records');await click(off[0],'offline-records');await off[0].getByRole('heading',{name:'离线记录 · 仅本机'}).waitFor();assert.equal(await off[0].locator('#modal .notice').count(),1);await click(off[0],'modal-close');
  await off[0].reload();await click(off[0],'offline-menu');await click(off[0],'restore-offline');await off[0].locator('.result-layout h2').filter({hasText:'邪恶笼罩了卡美洛'}).waitFor();
  await Promise.all(off.map(p=>p.context().close()));
  console.log('离线缓存：准备卡面后，网络关闭仍可重新打开并创建本机牌桌');
  const cached=await player('缓存玩家');await click(cached,'offline-menu');await click(cached,'prepare-offline');await cached.getByText('离线素材已准备好。断网后可再次打开本站或主屏幕入口。',{exact:true}).waitFor();
  await cached.context().setOffline(true);await cached.reload();await setupOffline(cached);await cached.locator('.room-code').waitFor();
  const cachedMedia=await cached.evaluate(async()=>{
    const art=await fetch('/art/court/merlin.webp');
    const table=await fetch('/art/council-table.webp');
    const legacyArt=await fetch('/art/merlin.webp');
    const variant=await fetch('/art/court/servant-4.webp');
    const day=await fetch('/art/court/hall-day.webp');
    const entrance=await fetch('/art/court/entry-join.webp');
    const turn=await fetch('/audio/cinematics/handbook-turn-1.mp3',{headers:{Range:'bytes=0-31'}});
    const music=await fetch('/audio/hall.mp3',{headers:{Range:'bytes=0-31'}});
    return [art.status,table.status,legacyArt.status,variant.status,day.status,entrance.status,turn.status,music.status,(await music.arrayBuffer()).byteLength];
  });
  assert.deepEqual(cachedMedia,[200,200,200,200,200,200,206,206,32]);
  await cached.goto(base+'/?preview=effects');
  await cached.getByRole('heading',{name:'视听体验'}).waitFor();
  await cached.locator('[data-experience-group="cue"]').click();
  assert.equal(await cached.locator('#experience-label').textContent(),'手册翻页');
  assert.equal(await cached.locator('[data-experience-item="handbook-turn-1"]').getAttribute('aria-pressed'),'true');
  await cached.locator('[data-experience-group="scene"]').click();
  await cached.locator('[data-experience-item="lady"]').click();
  await cached.locator('#experience-sound').uncheck();
  await click(cached,'experience-play');
  const lakeArt=cached.locator('#experience-stage .cinematic-portrait');
  assert.equal(await lakeArt.getAttribute('src'),'/art/court/lady.webp');
  await lakeArt.evaluate(img=>img.decode());
  await click(cached,'experience-stop');
  assert.equal(await cached.locator('#experience-stage .cinematic-dialog').count(),0);
  const practice=await player('练习玩家',true);
  await click(practice,'offline-menu');await click(practice,'practice-menu');
  await practice.locator('#practice-count').selectOption('7');await practice.locator('#practice-role').selectOption('merlin');
  await click(practice,'enter-practice');
  assert.equal(await practice.locator('.roster-item').count(),7);
  await click(practice,'ready');await click(practice,'start');
  assert.match(await reveal(practice),/梅林/);
  await click(practice,'room-menu');await click(practice,'practice-pause');
  assert.match(await practice.locator('#practice-pause').textContent(),/继续/);
  const assisted=await player('联机房主',true);
  await setupOnline(assisted);
  await click(assisted,'fill-room-bots');
  await assisted.locator('.roster-item').nth(4).waitFor();
  assert.equal((await snapshot(assisted)).players.filter(p=>p.bot).length,4);
  await click(assisted,'ready');await click(assisted,'start');await reveal(assisted);
  await assisted.waitForFunction(async()=>{
    const room=(await (await fetch('/api/session')).json()).room;
    return room?.game?.confirmed.length===5&&room.game.botAssisted===true;
  });
  assert.deepEqual(errors,[]);console.log('PASS：在线及离线完整局、重连、QR 解码与重扫、缓存、视口和大屏、线上补位与单页练习，无浏览器脚本错误');
}catch(error){console.error(error);for(let i=0;i<contexts.length;i++)for(const p of contexts[i].pages())await p.screenshot({path:`test-results/failure-${i}.png`,fullPage:true}).catch(()=>{});process.exitCode=1;
}finally{await browser.close();await app.close();}
