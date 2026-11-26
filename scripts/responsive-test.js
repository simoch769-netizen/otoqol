// Responsive layout at phone, tablet and desktop widths.
// node scripts/responsive-test.js
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
const VIEWS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
];

function startServer(dir, extraEnv) {
  const env = Object.assign({}, process.env, {
    DATA_DIR: dir, DB_FILE: path.join(dir, 'otoqol.sqlite'),
    JWT_SECRET: 'responsive-test-secret-32chars-ok', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000'
  }, extraEnv || {});
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '';
  srv.stdout.on('data', d => { out += d; });
  srv.stderr.on('data', d => { out += d; });
  srv.logs = () => out.slice(-1500);
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

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function signIn(page, base, user, pass) {
  if (!page.url().includes('/app')) await page.goto(base + '/app', { waitUntil: 'networkidle', timeout: 30000 });
  const form = await page.$('[data-oq-signin]');
  if (form) {
    await page.fill('[data-oq-signin] input[name=username]', user);
    await page.fill('[data-oq-signin] input[name=password]', pass);
    await page.click('[data-oq-signin] button.b.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
  }
}

(async () => {
  const OUT = process.env.RESPONSIVE_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'responsive');
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-resp-'));
  const PORT = Number(process.env.RESPONSIVE_PORT || 4350);
  const B = 'http://127.0.0.1:' + PORT;
  const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());

  const login = await fetch(B + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
  const ck = (login.headers.get('set-cookie') || '').split(';')[0];
  const cur = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
  const data = {
    settings: { school: 'Auto Ecole Demo', absLimit: 3 },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [],
    vehicles: [{ id: 'v1', plate: '12345-A-6', model: 'Dacia' }],
    candidates: [{ id: 'c1', name: 'Youssef Alami', cin: 'AB12345', phone: '0600000001', address: 'Casablanca', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [] }],
    sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: []
  };
  const put = await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data }) });
  t('seed data', put.status === 200);

  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    for (const v of VIEWS) {
      const page = await browser.newPage({ viewport: { width: v.width, height: v.height }, locale: 'ar' });
      const label = v.name + ' ' + v.width;

      await page.goto(B + '/signup', { waitUntil: 'networkidle', timeout: 30000 });
      const ovS = await overflow(page);
      t(label + ' /signup no horizontal overflow', ovS <= 1, 'overflow ' + ovS);
      await page.screenshot({ path: path.join(OUT, 'signup-' + v.name + '.png'), fullPage: true });

      await page.goto(B + '/owner', { waitUntil: 'networkidle', timeout: 30000 });
      const ovO = await overflow(page);
      t(label + ' /owner login no horizontal overflow', ovO <= 1, 'overflow ' + ovO);
      await page.screenshot({ path: path.join(OUT, 'owner-login-' + v.name + '.png'), fullPage: true });

      await page.goto(B + '/app', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
      const ovL = await overflow(page);
      t(label + ' /app sign-in no horizontal overflow', ovL <= 1, 'overflow ' + ovL);
      await page.screenshot({ path: path.join(OUT, 'app-signin-' + v.name + '.png'), fullPage: true });

      await signIn(page, B, 'admin', 'MgrPass1');
      const ovH = await overflow(page);
      t(label + ' app home no horizontal overflow', ovH <= 1, 'overflow ' + ovH);

      const toggle = page.locator('[data-oq-nav-toggle]');
      const toggleDisplay = await toggle.evaluate(el => getComputedStyle(el).display);
      if (v.width <= 900) {
        t(label + ' shows hamburger', toggleDisplay !== 'none');
        const navTransform = await page.locator('[data-oq-nav]').evaluate(el => getComputedStyle(el).transform);
        t(label + ' drawer starts closed', !/\bopen\b/.test(await page.locator('[data-oq-nav]').getAttribute('class') || '') && navTransform !== 'none');
        await toggle.click();
        t(label + ' drawer opens', /\bopen\b/.test(await page.locator('[data-oq-nav]').getAttribute('class') || ''));
        const navBtnH = await page.locator('[data-oq-nav] button').first().evaluate(el => el.getBoundingClientRect().height);
        t(label + ' nav tap target >= 44px', navBtnH >= 44, 'h=' + navBtnH);
        await page.screenshot({ path: path.join(OUT, 'app-menu-' + v.name + '.png') });
        await page.locator('[data-oq-nav] button', { hasText: 'المترشحون' }).click();
      } else {
        t(label + ' hides hamburger', toggleDisplay === 'none');
        t(label + ' top nav is visible', await page.locator('[data-oq-nav]').evaluate(el => getComputedStyle(el).display) !== 'none');
        await page.locator('.nav button', { hasText: 'المترشحون' }).click();
      }

      await page.waitForTimeout(300);
      const ovC = await overflow(page);
      t(label + ' candidates no horizontal overflow', ovC <= 1, 'overflow ' + ovC);
      const listBtn = page.locator('[data-oq-narsa-list]').first();
      t(label + ' manager sees Print documents on the student list', await listBtn.count() > 0 && await listBtn.isVisible());
      await page.screenshot({ path: path.join(OUT, 'app-candidates-' + v.name + '.png'), fullPage: true });

      await listBtn.click();
      await page.waitForSelector('[data-oq-narsa-modal]', { timeout: 10000 });
      t(label + ' list button opens the documents dialog', true);
      await page.screenshot({ path: path.join(OUT, 'app-narsa-' + v.name + '.png') });
      await page.keyboard.press('Escape');
      // close candidate modal if still open
      const x = page.locator('.md button.x').first();
      if (await x.count()) await x.click().catch(() => {});
      await page.close();
    }

    // owner-setup page (no token needed just to load layout)
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ar' });
    await page.goto(B + '/owner/setup', { waitUntil: 'networkidle', timeout: 30000 });
    const ovSetup = await overflow(page);
    t('phone /owner/setup no horizontal overflow', ovSetup <= 1, 'overflow ' + ovSetup);
    await page.screenshot({ path: path.join(OUT, 'owner-setup-phone.png'), fullPage: true });
    await page.close();
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv);
  }
  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
