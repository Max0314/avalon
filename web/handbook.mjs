import {EVIL, ROLES, SIZES} from '../shared/engine.mjs';
import {ladyArt,roleArt,rolePortraits} from '../shared/media.mjs';

const SECTIONS = {rules: '玩法', roles: '角色图鉴', quests: '任务人数'};
const PAGES = [
  {id: 'rules', section: 'rules', name: '玩法'},
  {id: 'good', section: 'roles', name: '好人阵营'},
  {id: 'evil', section: 'roles', name: '邪恶阵营'},
  {id: 'quests', section: 'quests', name: '任务人数'},
];
const COUNTS = Object.keys(SIZES).map(Number);
const OPTIONAL = new Set(['percival', 'morgana', 'mordred', 'oberon']);
const FACTIONS = {good: '好人', evil: '邪恶'};

function roleType(id) {
  if (OPTIONAL.has(id)) return '房主可选';
  if (id === 'merlin' || id === 'assassin') return '每局必有';
  return '补足阵营席位';
}

function roleDetail(id, enabled) {
  const {name, side, image, description} = ROLES[id];
  const portraits = rolePortraits[id];
  const status = typeof enabled === 'boolean' ? (enabled ? '本桌已启用' : '本桌未启用') : roleType(id);
  const guidance = id === 'percival'
    ? '<p class="handbook-clarification">如果未启用莫甘娜，你只会看到梅林一位候选人。</p>'
    : '';
  return `<article class="handbook-profile" data-faction="${side}">
    <div class="handbook-portrait"><img src="${roleArt(id)}" alt="" width="384" height="512" loading="lazy" decoding="async" draggable="false"></div>
    <div class="handbook-profile-copy">
      <div class="handbook-tags"><span>${FACTIONS[side]}阵营</span><span>${status}</span></div>
      <h3>${name}</h3>
      <p>${description}</p>${guidance}
      ${portraits.length > 1 ? `<div class="handbook-cast" role="group" aria-label="切换${name}的立绘">
        ${portraits.map((_,index) => `<button type="button" data-portrait-variant="${index}" aria-pressed="${index === 0}" aria-label="立绘 ${index+1}">${index+1}</button>`).join('')}
        <small>同一身份的不同立绘</small>
      </div>` : ''}
      <details class="handbook-original" data-note="original">
        <summary>查看原版卡面</summary>
        <img src="/cards/${image}" alt="${name}的原版英文卡面" loading="lazy" decoding="async" draggable="false">
      </details>
    </div>
  </article>`;
}

function rules() {
  return `<div class="handbook-rule-banner">
    <h3>如何赢得一局？</h3>
    <p>好人要完成三次任务，并在终局保护梅林。邪恶可通过三次任务失败、连续五次组队未通过，或在终局刺中梅林获胜。</p>
  </div>
  <ol class="handbook-steps">
    <li><h3>确认身份</h3><p>全员私下查看并确认自己的角色。只有结算时，所有身份才会公开。</p></li>
    <li><h3>提名队伍</h3><p>队长按本轮人数选择出征队员，也可选择自己。任务人数由总玩家数和轮次决定。</p></li>
    <li><h3>全员表决</h3><p>赞成超过半数，队伍才可出征。赞成未过半时，更换队长重新组队。所有人投完后才公开每人的选择。</p></li>
    <li><h3>秘密交牌</h3><p>只有出征队员交牌。好人只能交成功，邪恶可以交成功或失败。通常一张失败牌就令任务失败；7～10 人局的第 4 轮需要两张。牌桌只公布数量。</p></li>
    <li><h3>刺客终局</h3><p>任务第三次成功后，由刺客指认一位玩家。指认梅林则邪恶反胜，指认其他人则好人获胜。</p></li>
  </ol>
  <details class="handbook-note" data-note="lady"><summary>湖中仙女（可选规则）</summary><div class="handbook-lake">
    <img src="${ladyArt}" width="384" height="512" alt="雾湖边的湖中仙女" loading="lazy" decoding="async">
    <p>开启后，标记在开局时由首任队长右手边的玩家持有。第 2、3、4 次任务结束后，若尚未进入终局，持有者可私下查验一人的阵营，并把标记交给被查验者。曾持有标记的玩家不能再次成为查验对象。</p>
  </div></details>
  <details class="handbook-note" data-note="connection"><summary>在线和离线如何入桌？</summary><p>在线局分享邀请链接或房间码，同一浏览器保留自己的座位。离线同桌需要连接同一个 Wi-Fi 或热点，玩家与房主双向扫码；房主设备需要保持运行，掉线可重新扫码恢复座位。游戏无内置语音，可用外部通话或当面讨论。</p></details>`;
}

function roleGallery(faction, settings) {
  return `<div class="handbook-gallery" data-faction="${faction}"${faction === 'evil' ? ' hidden' : ''}>
    <div class="handbook-factions" role="group" aria-label="角色阵营">
      ${Object.entries(FACTIONS).map(([side, label]) => `<button type="button" data-faction-page="${side}" aria-pressed="${faction === side}">${label}</button>`).join('')}
    </div>
    <div class="handbook-role-picker" role="group" aria-label="${FACTIONS[faction]}阵营角色">
      ${Object.entries(ROLES).filter(([, role]) => role.side === faction).map(([id, role]) => {
        const enabled = OPTIONAL.has(id) && typeof settings?.[id] === 'boolean' ? ` data-enabled="${settings[id]}"` : '';
        return `<button type="button" class="handbook-role-button" data-role="${id}"${enabled} aria-controls="handbook-role-detail">
        <span class="handbook-thumb"><img src="${roleArt(id)}" alt="" width="384" height="512" loading="lazy" decoding="async" draggable="false"></span>
        <span class="handbook-role-copy"><strong class="handbook-role-label">${role.name}</strong>
          <span class="handbook-role-summary">${role.description}</span></span>
      </button>`;
      }).join('')}
    </div>
  </div>`;
}

function questReference(count) {
  const evil = EVIL[count];
  return `<div class="handbook-faction-counts">
    <p data-faction="good"><span>好人</span><strong>${count - evil} 人</strong></p>
    <p data-faction="evil"><span>邪恶</span><strong>${evil} 人</strong></p>
  </div>
  <table class="handbook-quest-table">
    <caption>${count} 人局任务表</caption>
    <thead><tr><th scope="col">任务轮次</th><th scope="col">出征人数</th><th scope="col">失败门槛</th></tr></thead>
    <tbody>${SIZES[count].map((size, round) => {
      const special = count >= 7 && round === 3;
      return `<tr${special ? ' class="handbook-two-fail"' : ''}><th scope="row">第 ${round + 1} 轮</th><td>${size} 人</td><td>${special ? '2 张失败牌' : '1 张失败牌'}</td></tr>`;
    }).join('')}</tbody>
  </table>
  <p class="handbook-clarification">梅林与刺客固定加入。选用的莫甘娜、莫德雷德和奥伯伦与刺客合计最多 ${evil} 人，阵营的剩余席位由忠臣和爪牙补足。</p>`;
}

function questGuide(count, seated) {
  return `<div class="handbook-count-heading"><h3>选择玩家人数</h3>${seated ? `<p>本桌当前 ${count} 人</p>` : ''}</div>
    <div class="handbook-counts" role="group" aria-label="选择玩家人数">
      ${COUNTS.map(size => `<button type="button" data-count="${size}" aria-pressed="${size === count}" aria-controls="handbook-quest-detail">${size} 人</button>`).join('')}
    </div>
    <div id="handbook-quest-detail" aria-live="polite">${questReference(count)}</div>`;
}

export function handbookMarkup({players, settings, section = 'rules'} = {}) {
  const selected = Object.hasOwn(SECTIONS, section) ? section : 'rules';
  const seated = COUNTS.includes(players);
  const firstPage = PAGES.find(page => page.section === selected);
  const sections = {
    rules: rules(),
    roles: roleGallery('good', settings) + roleGallery('evil', settings),
    quests: questGuide(seated ? players : COUNTS[0], seated),
  };
  return `<div id="handbook" class="handbook">
    <div class="handbook-tabs" role="tablist" aria-label="手册章节">${Object.entries(SECTIONS).map(([id, label]) => `<button type="button" role="tab" id="handbook-tab-${id}" data-section="${id}" aria-controls="handbook-pane-${id}" aria-selected="${selected === id}" tabindex="${selected === id ? 0 : -1}">${label}</button>`).join('')}</div>
    <div class="handbook-deck">
      ${Object.entries(sections).map(([id, body]) => `<section class="handbook-pane" id="handbook-pane-${id}" role="tabpanel" aria-labelledby="handbook-tab-${id}" tabindex="0"${selected === id ? '' : ' hidden'}>${body}</section>`).join('')}
      <div id="handbook-role-detail" class="handbook-role-detail" role="region" aria-label="角色详情" hidden>
        <div class="handbook-detail-sheet">
          <div class="handbook-detail-heading"><button type="button" data-role-back>‹ 返回角色表</button></div>
          <div class="handbook-detail-content" tabindex="0">${roleDetail('merlin')}</div>
        </div>
      </div>
    </div>
    <nav class="handbook-pager" aria-label="手册翻页">
      <button type="button" data-book-step="-1"${firstPage.id === PAGES[0].id ? ' disabled' : ''}>‹ 上一页</button>
      <span class="handbook-page-name" aria-live="polite">${firstPage.name}</span>
      <button type="button" data-book-step="1"${firstPage.id === PAGES.at(-1).id ? ' disabled' : ''}>下一页 ›</button>
    </nav>
  </div>`;
}

function setPressed(buttons, selected) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === selected));
}

function bindPageDrag(deck, enabled, turn, available) {
  let pointer;
  let blockClickUntil = 0;

  deck.addEventListener('pointerdown', event => {
    if (!enabled() || !event.isPrimary || event.button !== 0) return;
    blockClickUntil = 0;
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, axis: null};
  });

  deck.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
      pointer.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (pointer.axis === 'x' && event.isTrusted) deck.setPointerCapture(event.pointerId);
    }
    if (pointer.axis !== 'x') return;
    const area = deck.getBoundingClientRect();
    const step = dx > 0 ? -1 : 1;
    const fold = Math.min(.94, Math.abs(dx) / Math.max(1, area.width));
    const contact = Math.max(0, Math.min(1, (event.clientY - area.top) / Math.max(1, area.height)));
    deck.dataset.drag = step < 0 ? 'prev' : 'next';
    deck.style.setProperty('--fold', fold * (available(step) ? 1 : .22));
    deck.style.setProperty('--contact', `${Math.round(100 * contact)}%`);
  });

  function finish(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    // Moving implicit touch capture from a child to the deck ends only the child's capture.
    if (event.type === 'lostpointercapture' && event.target !== deck) return;
    if (event.type === 'pointerleave' && deck.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - pointer.x;
    const horizontal = pointer.axis === 'x';
    pointer = undefined;
    delete deck.dataset.drag;
    deck.style.removeProperty('--fold');
    deck.style.removeProperty('--contact');
    if (!horizontal) return;
    blockClickUntil = performance.now() + 220;
    if (event.type === 'pointerup' && Math.abs(dx) >= Math.min(88, deck.clientWidth * .23)) turn(dx > 0 ? -1 : 1);
  }

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) {
    deck.addEventListener(type, finish);
  }
  return event => deck.contains(event.target) && event.detail > 0 && performance.now() < blockClickUntil;
}

export function mountHandbook(root, {onTurn = () => {}} = {}) {
  const tabs = [...root.querySelectorAll('[data-section]')];
  const roles = [...root.querySelectorAll('[data-role]')];
  const counts = [...root.querySelectorAll('[data-count]')];
  const panels = tabs.map(tab => root.querySelector(`#${tab.getAttribute('aria-controls')}`));
  const galleries = [...root.querySelectorAll('.handbook-gallery')];
  const detail = root.querySelector('#handbook-role-detail');
  const detailContent = detail.querySelector('.handbook-detail-content');
  const detailBack = detail.querySelector('[data-role-back]');
  const questPanel = root.querySelector('#handbook-quest-detail');
  const deck = root.querySelector('.handbook-deck');
  const prev = root.querySelector('[data-book-step="-1"]');
  const next = root.querySelector('[data-book-step="1"]');
  const pageName = root.querySelector('.handbook-page-name');
  const dialog = root.closest('dialog');
  const positions = Object.fromEntries(PAGES.map(page => [page.id, 0]));
  const initialSection = tabs.find(tab => tab.getAttribute('aria-selected') === 'true').dataset.section;
  let pageIndex = PAGES.findIndex(page => page.section === initialSection);
  let lastFaction = 'good';
  let roleButton;

  function activePanel() {
    return panels.find(panel => !panel.hidden);
  }

  function paginate() {
    prev.disabled = pageIndex === 0 || !detail.hidden;
    next.disabled = pageIndex === PAGES.length - 1 || !detail.hidden;
  }

  function back(focus = true) {
    if (detail.hidden) return false;
    detail.hidden = true;
    for (const panel of panels) panel.inert = false;
    tabs.forEach(tab => tab.disabled = false);
    paginate();
    if (focus) {
      roleButton?.focus({preventScroll: true});
      onTurn();
    }
    roleButton = undefined;
    return true;
  }

  function animatePage(leaf, direction = 1) {
    if (!leaf.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    leaf.getAnimations?.().forEach(animation => animation.cancel());
    leaf.animate([
      {transform: `perspective(900px) translateX(${direction * 2.2}%) rotateY(${direction * 8}deg)`, filter: 'brightness(.86)'},
      {transform: 'none', filter: 'none'},
    ], {duration: 240, easing: 'cubic-bezier(.2,.68,.25,1)'});
  }

  function turnTo(requested, {sound = true, motion = true} = {}) {
    if (!PAGES[requested] || requested === pageIndex) return false;
    back(false);
    const current = PAGES[pageIndex];
    positions[current.id] = activePanel().scrollTop;
    const direction = Math.sign(requested - pageIndex);
    pageIndex = requested;
    const page = PAGES[pageIndex];
    if (page.section === 'roles') lastFaction = page.id;
    for (const [index, tab] of tabs.entries()) {
      const selected = tab.dataset.section === page.section;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[index].hidden = !selected;
    }
    galleries.forEach(gallery => gallery.hidden = gallery.dataset.faction !== lastFaction);
    const entering = activePanel();
    entering.scrollTop = positions[page.id];
    pageName.textContent = page.name;
    paginate();
    if (motion) animatePage(entering, direction);
    if (sound) onTurn();
    return true;
  }

  function openRole(id, {sound = true, motion = true} = {}) {
    const button = roles.find(card => card.dataset.role === id);
    if (!button) return false;
    turnTo(PAGES.findIndex(page => page.id === ROLES[id].side), {sound: false, motion: false});
    roleButton = button;
    const {enabled} = button.dataset;
    detailContent.innerHTML = roleDetail(id, enabled === undefined ? undefined : enabled === 'true');
    detail.hidden = false;
    detailContent.scrollTop = 0;
    for (const panel of panels) panel.inert = true;
    tabs.forEach(tab => tab.disabled = true);
    paginate();
    detailBack.focus({preventScroll: true});
    if (motion) animatePage(detail.querySelector('.handbook-detail-sheet'));
    if (sound) onTurn();
    return true;
  }

  function chooseCount(button) {
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    setPressed(counts, button);
    questPanel.innerHTML = questReference(Number(button.dataset.count));
  }

  function selectTab(tab) {
    const id = tab.dataset.section === 'roles' ? lastFaction : tab.dataset.section;
    turnTo(PAGES.findIndex(page => page.id === id));
  }

  const wasDrag = bindPageDrag(deck, () => detail.hidden, step => turnTo(pageIndex + step),
    step => Boolean(PAGES[pageIndex + step]));
  root.addEventListener('click', event => {
    if (wasDrag(event)) {
      event.preventDefault();
      return;
    }
    if (event.target === detail) {
      back();
      return;
    }
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.section) {
      selectTab(button);
    } else if (button.dataset.bookStep) {
      const changed = turnTo(pageIndex + Number(button.dataset.bookStep));
      if (changed && button.disabled) (button === prev ? next : prev).focus();
    } else if (button.dataset.factionPage) {
      const side = button.dataset.factionPage;
      if (turnTo(PAGES.findIndex(page => page.id === side))) {
        activePanel().querySelector(`.handbook-gallery[data-faction="${side}"] [data-faction-page="${side}"]`).focus({preventScroll: true});
      }
    } else if (button.dataset.role) {
      openRole(button.dataset.role);
    } else if (button.hasAttribute('data-role-back')) {
      back();
    } else if (button.hasAttribute('data-portrait-variant')) {
      const portrait = detail.querySelector('.handbook-portrait img');
      portrait.src = roleArt(roleButton.dataset.role, Number(button.dataset.portraitVariant));
      setPressed([...detail.querySelectorAll('[data-portrait-variant]')], button);
    } else if (button.dataset.count) {
      chooseCount(button);
    }
  });

  root.addEventListener('keydown', event => {
    const current = tabs.indexOf(event.target);
    if (current < 0) return;
    const neighbors = {ArrowLeft: (current + tabs.length - 1) % tabs.length, ArrowRight: (current + 1) % tabs.length, Home: 0, End: tabs.length - 1};
    if (!Object.hasOwn(neighbors, event.key)) return;
    event.preventDefault();
    const selected = tabs[neighbors[event.key]];
    selectTab(selected);
    selected.focus();
  });

  // Escape returns to the current role grid before closing the native dialog.
  if (dialog) {
    const events = new AbortController();
    dialog.addEventListener('cancel', event => {
      if (root.isConnected && back()) event.preventDefault();
    }, {signal: events.signal});
    dialog.addEventListener('close', () => {
      if (!root.isConnected || !dialog.open) events.abort();
    }, {signal: events.signal});
  }

  function bookmark() {
    const page = PAGES[pageIndex];
    return {
      page: page.id,
      lastFaction,
      count: root.querySelector('[data-count][aria-pressed="true"]')?.dataset.count,
      notes: Array.from(root.querySelectorAll('details[data-note][open]'), note => note.dataset.note),
      positions: {...positions, [page.id]: activePanel().scrollTop},
      role: roleButton?.dataset.role,
      detail: detailContent.scrollTop,
    };
  }

  function restore(saved) {
    if (!saved) return;
    chooseCount(counts.find(button => button.dataset.count === saved.count));
    turnTo(PAGES.findIndex(page => page.id === saved.page), {sound: false, motion: false});
    if (Object.hasOwn(FACTIONS, saved.lastFaction)) lastFaction = saved.lastFaction;
    Object.assign(positions, saved.positions);
    if (saved.role) openRole(saved.role, {sound: false, motion: false});
    for (const note of root.querySelectorAll('details[data-note]')) note.open = saved.notes?.includes(note.dataset.note) ?? false;
    activePanel().scrollTop = positions[PAGES[pageIndex].id] ?? 0;
    if (saved.role) detailContent.scrollTop = saved.detail ?? 0;
  }

  galleries.forEach(gallery => gallery.hidden = gallery.dataset.faction !== lastFaction);
  return {openRole, back, bookmark, restore};
}
