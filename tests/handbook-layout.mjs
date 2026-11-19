import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildApp} from '../server/app.mjs';

const app = buildApp({rateLimit: false});
let browser;
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  app.publicOrigin = base;
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({
    viewport: {width: 320, height: 520}, hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await page.locator('#guide').click();
  const reader = page.locator('.handbook-deck');
  const rules = page.locator('#handbook-pane-rules');
  const modal = page.locator('#modal');
  const close = page.locator('#modal-close');
  await modal.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished)));
  const initialBox = await modal.boundingBox();
  const closeBox = await close.boundingBox();
  const box = await reader.boundingBox();
  const touch = await context.newCDPSession(page);
  const start = {x: box.x + box.width * .77, y: box.y + box.height * .72};

  async function drag(dx, dy, {from = start, during} = {}) {
    const dispatch = (type, touchPoints) => touch.send('Input.dispatchTouchEvent', {type, touchPoints});
    await dispatch('touchStart', [from]);
    for (let step = 1; step <= 8; step++) {
      await dispatch('touchMove', [{x: from.x + dx * step / 8, y: from.y + dy * step / 8}]);
    }
    if (during) await during();
    await dispatch('touchEnd', []);
  }

  async function expectPage(name) {
    await page.waitForFunction(expected => document.querySelector('.handbook-page-name').textContent === expected, name);
  }

  const curl = reader.locator('.handbook-curl');
  await drag(-21, 9, {
    from: {x: start.x, y: box.y + box.height * .22},
    during: async () => {
      assert.equal(await reader.getAttribute('data-turn-corner'), 'top');
      assert.match(await rules.evaluate(node => node.style.clipPath), /^polygon/);
      assert.equal(await curl.evaluate(node => node.hidden), false);
    },
  });
  await curl.waitFor({state: 'hidden'});
  await expectPage('玩法');
  assert.equal(await rules.evaluate(node => node.style.clipPath), '');

  await drag(4, -Math.min(145, box.height * .54));
  await page.waitForFunction(() => document.querySelector('#handbook-pane-rules').scrollTop > 5);
  assert.equal(await rules.getAttribute('hidden'), null);
  // Chromium consumes the first finger contact during a native inertial scroll to stop the fling.
  await page.waitForFunction(() => {
    const panel = document.querySelector('#handbook-pane-rules');
    const top = panel.scrollTop;
    if (window.handbookScroll?.top !== top) window.handbookScroll = {top, since: performance.now()};
    return performance.now() - window.handbookScroll.since > 100;
  });
  const scroll = await rules.evaluate(node => node.scrollTop);
  await drag(-box.width * .47, 4, {during: async () => {
    assert.equal(await reader.getAttribute('data-drag'), 'next');
    assert.equal(await reader.getAttribute('data-turn-corner'), 'bottom');
  }});
  await expectPage('好人阵营');
  assert.equal(await page.getByRole('tab', {name: '角色图鉴'}).getAttribute('aria-selected'), 'true');
  await drag(-box.width * .47, 3);
  await expectPage('邪恶阵营');
  await page.locator('[data-role="morgana"]').click();
  const detail = page.getByRole('region', {name: '角色详情'});
  await detail.getByRole('heading', {name: '莫甘娜'}).waitFor();
  assert.deepEqual(await modal.boundingBox(), initialBox);
  assert.deepEqual(await close.boundingBox(), closeBox);

  await page.keyboard.press('Escape');
  await detail.waitFor({state: 'hidden'});
  assert.equal(await modal.getAttribute('open'), '');
  assert.equal(await page.locator(':focus').getAttribute('data-role'), 'morgana');
  await expectPage('邪恶阵营');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.keyboard.press('ArrowLeft');
  await expectPage('好人阵营');
  await page.getByRole('tab', {name: '玩法', exact: true}).click();
  await expectPage('玩法');
  assert(await rules.evaluate(node => node.scrollTop) >= scroll);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  console.log('PASS：折角跟手与回弹、手机纵滚、键盘翻页、固定外框和返回阅读位置');
} finally {
  await browser?.close();
  await app.close();
}
