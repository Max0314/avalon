import {avatarPath} from './avatars.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const ROLE={merlin:'梅林',percival:'派西维尔',servant:'忠臣',assassin:'刺客',morgana:'莫甘娜',mordred:'莫德雷德',oberon:'奥伯伦',minion:'爪牙'};
const picture=p=>`<img class="journal-avatar" src="${avatarPath(/^\d+$/.test(String(p.avatar))?Number(p.avatar):p.avatar)}" width="36" height="36" alt="" loading="lazy">`;
export function mountJournal(host,{modes=[],request}={}) {
  let tab='mine',page=0,period='all',mode='all',metric='wins',dead=false,generation=0,controller;
  const modeName=id=>modes.find(m=>m.id===id)?.name??id;
  const call=request??(async(path,data)=>{const r=await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.message??'暂时无法读取游戏档案，请重试。');return v;});
  function shell(body) {
    host.innerHTML=`<div class="player-journal"><p class="journal-intro">记录真实完成的牌局，留下每次同桌的故事。战绩从本次功能上线后开始累计。</p><nav aria-label="游戏档案">${[['mine','我的战绩'],['ranking','排行榜'],['companions','常玩伙伴']].map(([id,label])=>`<button type="button" data-journal-tab="${id}" aria-pressed="${tab===id}">${label}</button>`).join('')}</nav><div class="journal-filters"${tab==='companions'?' hidden':''}><label>时间<select data-journal-filter="period"><option value="all"${period==='all'?' selected':''}>全部</option><option value="month"${period==='month'?' selected':''}>本月（北京时间）</option></select></label>${tab!=='companions'?`<label>玩法<select data-journal-filter="mode">${tab==='mine'?`<option value="all"${mode==='all'?' selected':''}>全部玩法</option>`:''}${modes.map(m=>`<option value="${esc(m.id)}"${mode===m.id?' selected':''}>${esc(m.name)}</option>`).join('')}</select></label>`:''}${tab==='ranking'?`<label>排序<select data-journal-filter="metric">${[['wins','获胜场次'],['games','完成场次'],['winRate','胜率']].map(([id,name])=>`<option value="${id}"${metric===id?' selected':''}>${name}</option>`).join('')}</select></label>`:''}</div><div class="journal-body" aria-live="polite">${body}</div></div>`;
  }
  async function load() {
    const own=++generation;controller?.abort();controller=new AbortController();shell('<p role="status">正在读取游戏档案…</p>');
    try {
      const filters=new URLSearchParams({page:String(page),period,mode,metric});
      if(tab==='mine') {
        const value=await call('/api/player?'+filters);if(dead||own!==generation)return;
        const s=value.summary;
        shell(`${!value.signedIn?'<p class="journal-note">当前是本浏览器游客记录。<a href="/_fribench/auth/login?return_to=%2F">登录后可预览认领</a>，不会自动绑定。</p>':''}<div class="journal-numbers"><div><b>${s.games}</b><span>完整对局</span></div><div><b>${s.wins}</b><span>获胜场次</span></div><div><b>${s.winRate==null?'—':s.winRate+'%'}</b><span>个人胜率</span></div><div><b>${s.aborted}</b><span>中止 · 不计胜负</span></div></div>${value.groups.map(g=>`<p class="journal-breakdown">${esc(modeName(g.mode))} · ${g.games} 场 · ${g.wins} 胜${g.averageScore==null?'':` · 平均 ${g.averageScore} 分`}</p>`).join('')}${value.roles.length?`<details><summary>阵营与角色表现</summary>${value.roles.map(r=>`<p>${esc(ROLE[r.role]??r.role)} · ${r.side==='good'?'好人':'邪恶'} · ${r.games} 场 · ${r.wins} 胜</p>`).join('')}</details>`:''}${value.signedIn?`<label class="journal-consent"><input type="checkbox" data-journal-consent${value.publicRanking?' checked':''}>自愿展示在本游戏公开排行榜</label><p class="journal-note">开启后仅公开昵称、头像及合格局统计，不公开邮箱、私人房间或完整个人档案。关闭后立即退出榜单。</p>`:''}<h3>最近对局</h3>${value.history.length?value.history.map(r=>`<button type="button" class="journal-row" data-journal-match="${esc(r.id)}"><span>${esc(modeName(r.mode))}<small>${date(r.endedAt)} · ${r.ranked?'合格真人局':'普通 / 练习局'}</small></span><strong>${r.status==='aborted'?'已中止':r.won?'获胜':'已完成'}${r.place==null?'':` · 第 ${r.place} 名`}${r.score==null?'':` · ${r.score} 分`}</strong></button>`).join(''):'<p class="journal-empty">还没有对局记录，先和朋友开一桌吧。</p>'}<div class="journal-pages">${page?'<button type="button" data-journal-page="previous">上一页</button>':''}${value.hasMore?'<button type="button" data-journal-page="next">下一页</button>':''}</div><div class="journal-detail"></div>`);
      } else if(tab==='ranking') {
        const value=await call('/api/player/leaderboard?'+filters);if(dead||own!==generation)return;
        shell(`<p class="journal-note">仅统计完整、服务器结算的真人账号局；游客、机器人、托管和中止局不进入本榜。胜率榜至少完成 ${value.minimumGames} 场；同分并列。每种玩法独立排名。</p>${value.entries.length?value.entries.map(p=>`<div class="journal-row"><b>${p.rank}</b>${picture(p)}<span>${esc(p.name)}<small>${p.games} 场 · ${p.wins} 胜 · ${p.winRate}%</small></span></div>`).join(''):'<p class="journal-empty">暂无满足条件且自愿公开的玩家。普通游玩不要求参加榜单。</p>'}`);
      } else {
        const value=await call('/api/player/companions');if(dead||own!==generation)return;
        shell(`<p class="journal-note">仅你可见，按共同完成的在线对局统计；同桌不等于自动添加好友。游客和机器人不计入伙伴身份，展示最近同桌时的昵称与头像。此列表为全部时间。</p>${value.entries.length?value.entries.map(p=>`<div class="journal-row">${picture(p)}<span>${esc(p.name)}<small>一起完成 ${p.games} 场 · 最近 ${date(p.lastPlayed)}</small></span></div>`).join(''):'<p class="journal-empty">和登录的朋友完成对局后，这里会留下常玩伙伴。</p>'}`);
      }
    } catch(e) {if(!dead&&own===generation)shell(`<p role="alert">${esc(e.message??'读取失败，请重试。')}</p><button type="button" data-journal-retry>重新读取</button>`);}
  }
  async function click(e) {
    const b=e.target.closest('button');if(!b||!host.contains(b))return;
    if(b.dataset.journalTab){tab=b.dataset.journalTab;page=0;if(tab==='ranking'&&mode==='all')mode=modes[0]?.id??'all';void load();}
    else if(b.dataset.journalPage){page=Math.max(0,page+(b.dataset.journalPage==='next'?1:-1));void load();}
    else if(b.hasAttribute('data-journal-retry'))void load();
    else if(b.dataset.journalMatch) {
      const own=generation;b.disabled=true;
      try {const v=await call('/api/player/matches/'+encodeURIComponent(b.dataset.journalMatch));if(dead||own!==generation)return;const box=host.querySelector('.journal-detail');box.innerHTML=`<h3>本场详情</h3><p>${date(v.endedAt)} · ${v.status==='aborted'?'中止，不计胜负':'已完成'} · ${esc(v.reason??'')}</p>${v.players.map(p=>`<div class="journal-row">${picture(p)}<span>${esc(p.name)}${p.bot?' · 机器人':''}<small>${p.role?esc(ROLE[p.role]??p.role)+' · ':''}${p.side?(p.side==='good'?'好人':'邪恶')+' · ':''}${p.place==null?'':'第 '+p.place+' 名 · '}${p.score==null?'':p.score+' 分'}${p.won?' · 获胜':''}</small></span></div>`).join('')}${v.rounds?`<h4>各轮结算</h4>${v.rounds.map(r=>`<p>第 ${r.round} 轮：${r.scores.map(s=>esc(v.players.find(p=>p.seatId===s.playerId)?.name??'玩家')+' '+s.delta+' 分').join('、')}</p>`).join('')}`:''}${v.quests?`<h4>任务结果</h4>${v.quests.map(r=>`<p>第 ${r.quest} 轮：${r.success?'成功':'失败'}（成功 ${r.successes} 张 / 失败 ${r.fails} 张）</p>`).join('')}`:''}`;box.scrollIntoView({block:'nearest',behavior:'smooth'});}
      catch(err){if(!dead&&own===generation){const box=host.querySelector('.journal-detail');box.textContent=err.message??'详情读取失败，请重试。';}}
      finally{if(b.isConnected)b.disabled=false;}
    }
  }
  async function change(e) {
    const t=e.target;if(t.dataset.journalFilter){({period:v=>period=v,mode:v=>mode=v,metric:v=>metric=v}[t.dataset.journalFilter])(t.value);page=0;void load();}
    if(t.hasAttribute('data-journal-consent')){const own=generation;t.disabled=true;try{await call('/api/player/privacy',{publicRanking:t.checked});if(!dead&&own===generation)void load();}catch(err){if(!dead&&own===generation){t.checked=!t.checked;t.disabled=false;let status=host.querySelector('.journal-privacy-error');if(!status){status=document.createElement('p');status.className='journal-privacy-error';status.setAttribute('role','alert');t.parentElement.after(status);}status.textContent=err.message??'保存失败，请重试。';}}}
  }
  const dispose=()=>{dead=true;generation++;controller?.abort();host.removeEventListener('click',click);host.removeEventListener('change',change);window.removeEventListener('fribench:account-change',changed);host.replaceChildren();};
  const changed=()=>{dispose();host.textContent='账号已变化，请重新打开游戏档案。';};
  host.addEventListener('click',click);host.addEventListener('change',change);window.addEventListener('fribench:account-change',changed);void load();return dispose;
}
