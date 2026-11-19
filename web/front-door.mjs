import {ROLES} from '../shared/engine.mjs';
import {roleArt} from '../shared/media.mjs';

const roles=Object.entries(ROLES);
let chosen=0;
const loop=index=>(index+roles.length)%roles.length;

export function frontDoorMarkup(){
  return `<section class="front-door" aria-label="阿瓦隆首页">
    <header class="portrait-readout">
      <p class="front-format">5–10 人<span aria-hidden="true"> / </span>身份推理</p>
      <h1>阿瓦隆</h1>
      <p class="front-premise">组队出征，在五次任务中识破叛徒，守住梅林的秘密。</p>
    </header>
    <section class="portrait-gallery" aria-label="角色图鉴预览">
    <div class="portrait-stage" aria-label="角色轮播" tabindex="0">
      <div class="portrait-track">${roles.map(([id,role],index)=>`
        <button type="button" class="portrait-card" data-portrait="${index}" aria-label="查看${role.name}">
          <img src="${roleArt(id)}" width="384" height="512" alt="" decoding="async" draggable="false">
          <span class="portrait-caption"><small>${role.side==='good'?'好人阵营':'邪恶阵营'}</small><strong>${role.name}</strong></span>
        </button>`).join('')}</div>
    </div>
    <div class="portrait-controls"><button data-carousel-step="-1" aria-label="上一角色">‹</button>
      <output data-portrait-count></output><button data-carousel-step="1" aria-label="下一角色">›</button></div>
    </section>
    <div class="front-actions">
      <div class="front-play"><button id="create-online" class="primary">创建房间</button><button id="join-online">加入房间</button></div>
      <div class="front-library"><button id="guide-home">游戏教程</button><button id="home-handbook">角色图鉴</button><button id="offline-menu">离线同桌</button><button id="home-records">游戏档案</button></div>
      <div class="resume-actions"><button id="resume-current" hidden>继续牌桌</button><button id="close-own-room" hidden>离开房间</button></div>
    </div></section>`;
}

export function mountFrontDoor(root,openRole){
  const stage=root.querySelector('.portrait-stage');
  const cards=Array.from(stage.querySelectorAll('[data-portrait]'));
  const count=root.querySelector('[data-portrait-count]');
  let pointer,preventClick=false;

  function draw(offset=0){
    for(const [index,card] of cards.entries()){
      const relative=((index-chosen+roles.length/2+roles.length)%roles.length)-roles.length/2+offset;
      const distance=Math.abs(relative);
      card.style.setProperty('--portrait-x',String(relative));
      card.style.setProperty('--portrait-scale',String(1-Math.min(distance,2)*.14));
      card.style.setProperty('--portrait-depth',String(9-Math.round(distance*2)));
      card.style.setProperty('--portrait-opacity',String(Math.max(0,Math.min(1,2-distance))));
      card.tabIndex=index===chosen?0:-1;
      card.setAttribute('aria-current',String(index===chosen));
      card.inert=distance>1.7;
    }
    if(!offset){
      count.value=`${chosen+1} — ${roles.length}`;
      count.setAttribute('aria-label',`角色 ${chosen+1}，共 ${roles.length} 位，${roles[chosen][1].name}`);
    }
  }
  function move(delta){chosen=loop(chosen+delta);draw();}
  root.querySelectorAll('[data-carousel-step]').forEach(button=>button.addEventListener('click',()=>move(Number(button.dataset.carouselStep))));
  stage.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();
    move(event.key==='ArrowRight'?1:-1);
    stage.focus({preventScroll:true});
  });
  stage.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    preventClick=false;
    pointer={id:event.pointerId,x:event.clientX,offset:0};
  });
  stage.addEventListener('pointermove',event=>{
    if(pointer?.id!==event.pointerId)return;
    const delta=event.clientX-pointer.x;
    if(Math.abs(delta)<7&&!preventClick)return;
    if(!preventClick)stage.setPointerCapture(event.pointerId);
    preventClick=true;
    stage.dataset.dragging='true';
    pointer.offset=Math.max(-1.22,Math.min(1.22,delta/Math.max(72,stage.clientWidth*.35)));
    draw(pointer.offset);
  });
  const end=(event,commit)=>{
    if(pointer?.id!==event.pointerId)return;
    const {offset}=pointer;
    pointer=null;
    delete stage.dataset.dragging;
    if(commit&&Math.abs(offset)>.29)move(offset<0?1:-1);else draw();
  };
  stage.addEventListener('pointerup',event=>end(event,true));
  stage.addEventListener('pointercancel',event=>end(event,false));
  stage.addEventListener('lostpointercapture',event=>{if(event.target===stage)end(event,false);});
  stage.addEventListener('click',event=>{
    if(preventClick){preventClick=false;return;}
    const card=event.target.closest('[data-portrait]');
    if(!card)return;
    const index=Number(card.dataset.portrait);
    if(index===chosen)openRole(roles[index][0]);
    else{chosen=index;draw();}
  });
  draw();
}
