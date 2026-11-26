// Drawer hotfix: narrower RTL menu + scroll lock.
// node scripts/drawer-fix-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
let pw;
try { pw = require('playwright-core'); } catch (e1) {
  try { pw = require('/tmp/pw/node_modules/playwright-core'); } catch (e2) {
    pw = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
  }
}

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

function startServer(dir, extraEnv) {
  const env = Object.assign({}, process.env, {
    DATA_DIR: dir, DB_FILE: path.join(dir, 'otoqol.sqlite'),
    JWT_SECRET: 'drawer-hotfix-test-secret-32chars', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', HOST: '127.0.0.1'
  }, extraEnv || {});
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'], env, cwd: path.join(__dirname, '..')
  });
  let out = '';
  srv.stdout.on('data', d => { out += d; });
  srv.stderr.on('data', d => { out += d; });
  srv.logs = () => out.slice(-2000);
  return srv;
}
function kill(srv) { try { srv.kill('SIGTERM'); } catch (e) {} }
function waitUp(base, ms) {
  const until = Date.now() + (ms || 20000);
  return (async function poll() {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return true; } catch (e) {}
    if (Date.now() > until) return false;
    await new Promise(r => setTimeout(r, 200));
    return poll();
  }());
}

async function signIn(page, base) {
  if (!page.url().includes('/app')) await page.goto(base + '/app', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
  await page.fill('[data-oq-signin] input[name=username]', 'admin');
  await page.fill('[data-oq-signin] input[name=password]', 'SchoolPw2026!');
  await page.click('[data-oq-signin] button.b.pri');
  await page.waitForSelector('[data-oq-nav]', { timeout: 20000 });
}

async function makePageTall(page) {
  await page.evaluate(() => {
    const w = document.querySelector('.wrap') || document.body;
    w.style.minHeight = '2400px';
  });
}

async function scrollMetrics(page) {
  return page.evaluate(() => ({
    y: window.scrollY || window.pageYOffset || 0,
    bodyPos: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow
  }));
}

async function drawerInfo(page, sel) {
  return page.evaluate((s) => {
    const nav = document.querySelector(s);
    const back = document.querySelector('[data-oq-nav-back], .nav-back');
    if (!nav) return null;
    const r = nav.getBoundingClientRect();
    const br = back ? back.getBoundingClientRect() : null;
    const cs = getComputedStyle(nav);
    const bcs = back ? getComputedStyle(back) : null;
    const buttons = [...nav.querySelectorAll('button')].map(b => {
      const br2 = b.getBoundingClientRect();
      return { text: (b.textContent || '').replace(/\s+/g, ' ').trim(), w: br2.width, h: br2.height, wrap: b.scrollHeight > br2.height + 2 };
    });
    return {
      className: nav.className,
      width: r.width,
      left: r.left,
      right: r.right,
      top: r.top,
      height: r.height,
      position: cs.position,
      overflowY: cs.overflowY,
      overscroll: cs.overscrollBehavior || cs.overscrollBehaviorY,
      transform: cs.transform,
      vw: window.innerWidth,
      vh: window.innerHeight,
      backDisplay: bcs ? bcs.display : 'missing',
      backWidth: br ? br.width : 0,
      backHeight: br ? br.height : 0,
      backTouch: bcs ? bcs.touchAction : '',
      buttons
    };
  }, sel);
}

(async () => {
  const ROOT = path.join(__dirname, '..');
  const OUT = process.env.DRAWER_SHOT_DIR || path.join(ROOT, 'screenshots');
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-drawer-'));
  const PORT = Number(process.env.DRAWER_PORT || 4360);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());

  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const PHONES = [
    { name: 'phone-390', width: 390, height: 844 },
    { name: 'phone-360', width: 360, height: 740 }
  ];
  const results = {};

  try {
    for (const v of PHONES) {
      const page = await browser.newPage({
        viewport: { width: v.width, height: v.height },
        hasTouch: true,
        isMobile: true,
        locale: 'ar',
        deviceScaleFactor: 2
      });
      const label = v.name;

      await signIn(page, B);
      await makePageTall(page);

      const toggle = page.locator('[data-oq-nav-toggle]');
      t(label + ' hamburger visible', await toggle.evaluate(el => getComputedStyle(el).display) !== 'none');
      const closed = await page.locator('[data-oq-nav]').getAttribute('class');
      t(label + ' drawer starts closed', !/\bopen\b/.test(closed || ''));

      // Header is not sticky, so Playwright's locator.click() would scroll it
      // back into view and reset scrollY. Open with a DOM click instead.
      await page.evaluate(() => window.scrollTo(0, 280));
      await page.waitForTimeout(100);
      const before = await scrollMetrics(page);
      t(label + ' page is scrollable before open', before.y >= 200, 'scrollY=' + before.y);

      await page.evaluate(() => document.querySelector('[data-oq-nav-toggle]').click());
      await page.waitForTimeout(250);
      t(label + ' drawer opens', /\bopen\b/.test(await page.locator('[data-oq-nav]').getAttribute('class') || ''));

      const info = await drawerInfo(page, '[data-oq-nav]');
      const expected = Math.min(270, 0.75 * v.width);
      const widthOk = info && Math.abs(info.width - expected) <= 1.5;
      t(label + ' drawer width is min(270px, 75vw)', widthOk, 'width=' + (info && info.width) + ' expected=' + expected + ' vw=' + v.width);
      results[label] = { width: info && info.width, expected, left: info && info.left, right: info && info.right };

      t(label + ' overlay visible and full-screen', info && info.backDisplay !== 'none' && info.backWidth >= v.width - 1 && info.backHeight >= v.height - 1, JSON.stringify({ d: info && info.backDisplay, w: info && info.backWidth, h: info && info.backHeight }));
      t(label + ' drawer overscroll-behavior contain', info && /contain/.test(info.overscroll || ''), 'overscroll=' + (info && info.overscroll));
      t(label + ' drawer overflow-y auto', info && info.overflowY === 'auto', 'overflowY=' + (info && info.overflowY));
      t(label + ' overlay touch-action none', info && info.backTouch === 'none', 'touch-action=' + (info && info.backTouch));

      // RTL: drawer sits on the right, leaving a visible strip on the left
      t(label + ' RTL drawer is on the right', info && Math.abs(info.right - v.width) <= 2 && info.left > 40, 'left=' + (info && info.left) + ' right=' + (info && info.right));
      const leftover = info ? (info.left) : 0;
      t(label + ' leftover page strip is reasonably wide (>= 20% vw)', leftover >= v.width * 0.20, 'leftover=' + leftover);

      const wrapped = (info.buttons || []).filter(b => b.h > 64 || b.wrap);
      t(label + ' nav labels do not wrap badly', wrapped.length === 0, JSON.stringify(wrapped));

      const locked = await scrollMetrics(page);
      t(label + ' body is position:fixed while open', locked.bodyPos === 'fixed', 'pos=' + locked.bodyPos + ' top=' + locked.bodyTop);
      t(label + ' lock preserves pre-open scroll in body.top', locked.bodyTop === ('-' + before.y + 'px'), 'body.top=' + locked.bodyTop + ' before=' + before.y);

      const yWhileOpen = locked.y;
      // Scroll / swipe inside the drawer
      await page.locator('[data-oq-nav]').evaluate(el => { el.scrollTop = el.scrollTop + 120; });
      await page.locator('[data-oq-nav]').hover();
      await page.mouse.wheel(0, 400);
      // Also try a touch-like wheel/swipe on the overlay (left strip)
      const overlayX = 16;
      const overlayY = Math.floor(v.height / 2);
      await page.mouse.move(overlayX, overlayY);
      await page.mouse.wheel(0, 400);
      await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return;
        const ev = (type, extra) => el.dispatchEvent(new TouchEvent(type, Object.assign({
          bubbles: true, cancelable: true, touches: [], changedTouches: [], targetTouches: []
        }, extra)));
        try {
          // Some Chromium builds throw if Touch is missing; wheel already ran.
          if (typeof Touch === 'function') {
            const t0 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            const t1 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y + 180 });
            ev('touchstart', { touches: [t0], changedTouches: [t0], targetTouches: [t0] });
            ev('touchmove', { touches: [t1], changedTouches: [t1], targetTouches: [t1] });
            ev('touchend', { touches: [], changedTouches: [t1], targetTouches: [] });
          }
        } catch (e) {}
      }, { x: overlayX, y: overlayY });
      await page.waitForTimeout(150);
      const afterSwipe = await scrollMetrics(page);
      t(label + ' scrolling inside drawer / overlay does not change window.scrollY', afterSwipe.y === yWhileOpen, 'beforeSwipe=' + yWhileOpen + ' after=' + afterSwipe.y);
      t(label + ' body.top stays locked during swipe', afterSwipe.bodyTop === locked.bodyTop && afterSwipe.bodyPos === 'fixed', 'top=' + afterSwipe.bodyTop);

      await page.screenshot({ path: path.join(OUT, 'app-drawer-' + label + '.png') });

      // Overlay tap (left strip) closes the drawer
      await page.mouse.click(overlayX, overlayY);
      await page.waitForTimeout(250);
      t(label + ' overlay tap closes the drawer', !/\bopen\b/.test(await page.locator('[data-oq-nav]').getAttribute('class') || ''));

      const restored = await scrollMetrics(page);
      t(label + ' closing restores previous scroll position', Math.abs(restored.y - before.y) <= 1, 'restored=' + restored.y + ' expected=' + before.y);
      t(label + ' body position restored after close', restored.bodyPos !== 'fixed', 'pos=' + restored.bodyPos);

      await page.close();
    }

    // Desktop: drawer behaviour must stay unchanged (no hamburger, no fixed 270px panel)
    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    await signIn(desk, B);
    const toggleDisplay = await desk.locator('[data-oq-nav-toggle]').evaluate(el => getComputedStyle(el).display);
    t('desktop hides hamburger', toggleDisplay === 'none');
    const dInfo = await drawerInfo(desk, '[data-oq-nav]');
    t('desktop nav is not a fixed full-height drawer', dInfo && dInfo.position !== 'fixed' && dInfo.height < 120, JSON.stringify({ pos: dInfo && dInfo.position, h: dInfo && dInfo.height, w: dInfo && dInfo.width }));
    t('desktop nav is wider than the phone drawer', dInfo && dInfo.width > 500, 'width=' + (dInfo && dInfo.width));
    const backDisplay = await desk.evaluate(() => {
      const b = document.querySelector('[data-oq-nav-back], .nav-back');
      return b ? getComputedStyle(b).display : 'missing';
    });
    t('desktop overlay stays hidden', backDisplay === 'none');
    await desk.screenshot({ path: path.join(OUT, 'app-desktop-1280.png') });
    await desk.close();

    // Also 1024px (still >900)
    const tab = await browser.newPage({ viewport: { width: 1024, height: 768 }, locale: 'ar' });
    await signIn(tab, B);
    const tDisp = await tab.locator('[data-oq-nav-toggle]').evaluate(el => getComputedStyle(el).display);
    t('1024px hides hamburger', tDisp === 'none');
    const tInfo = await drawerInfo(tab, '[data-oq-nav]');
    t('1024px nav is not the phone drawer', tInfo && tInfo.position !== 'fixed' && Math.abs(tInfo.width - 270) > 20, JSON.stringify({ pos: tInfo && tInfo.position, w: tInfo && tInfo.width }));
    await tab.close();

    // Portal: CSS + JS are present in the served file even if we don't have a student session.
    const portalHtml = fs.readFileSync(path.join(ROOT, 'public/portal/index.html'), 'utf8');
    t('portal CSS uses min(270px, 75vw)', portalHtml.includes('width:min(270px,75vw)'));
    t('portal CSS has overscroll-behavior contain', portalHtml.includes('overscroll-behavior:contain'));
    t('portal JS locks body position fixed', portalHtml.includes("body.style.position='fixed'"));
    t('portal overlay has data-oq-nav-back', portalHtml.includes('data-oq-nav-back'));

    console.log('SHOTS ' + OUT);
    console.log('WIDTHS ' + JSON.stringify(results));
  } finally {
    await browser.close();
    kill(srv);
  }
  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
