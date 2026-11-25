// Screenshots of the email forgot-password flow (login link, reset screens, settings email field) in AR and FR.
// Starts its own server + temp DB with capture SMTP.
// node scripts/forgot-password-screens.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
let pw;
try { pw = require('playwright-core'); } catch (e1) {
  try { pw = require('/tmp/pw/node_modules/playwright-core'); } catch (e2) {
    pw = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
  }
}

const PORT = Number(process.env.FP_SHOT_PORT || 4301), B = 'http://127.0.0.1:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-fp-shots-'));
const SECRET = crypto.randomBytes(32).toString('hex'), ADMIN = crypto.randomBytes(24).toString('hex');
const CAPTURE = path.join(DIR, 'mail-capture.jsonl');
const SHOTS = path.join(__dirname, '..', 'test-shots');
const SCHOOL_PW = 'SchoolPw2026!';
fs.mkdirSync(SHOTS, { recursive: true });

const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
const seed = () => ({
  settings: { school: 'Otoqol Demo', absLimit: 3 },
  users: [
    { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'Demo1234', email: 'admin@example.com' },
    { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' },
  ],
  monitors: [{ id: 'm1', name: 'Karim', username: 'karim', password: 'MonPass1', email: 'karim@example.com' }],
  vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
});

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development', PORT: String(PORT), HOST: '127.0.0.1',
      DATA_DIR: DIR, DB_FILE: path.join(DIR, 'otoqol.sqlite'),
      JWT_SECRET: SECRET, ADMIN_TOKEN: ADMIN, COOKIE_SECURE: 'false',
      SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo', SEED_SCHOOL_PASSWORD: SCHOOL_PW,
      DEFAULT_SCHOOL_CODE: 'demo',
      SMTP_HOST: 'capture', SMTP_PORT: '465', SMTP_USER: 'contact.otoqol@gmail.com',
      SMTP_PASS: 'test-capture', MAIL_FROM: 'Otoqol <contact.otoqol@gmail.com>',
      SMTP_CAPTURE_FILE: CAPTURE,
    },
  });
  let logs = ''; srv.stdout.on('data', d => { logs += d; }); srv.stderr.on('data', d => { logs += d; });
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 12000) {
    try { if ((await fetch(B + '/healthz')).ok) { up = true; break; } } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
  if (!up) { console.error('server failed to start\n' + logs); process.exit(1); }

  const lg = await fetch(B + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: SCHOOL_PW }) });
  const ck = (lg.headers.get('set-cookie') || '').split(';')[0];
  const cur = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
  const put = await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data: seed() }) });
  if (!put.ok) { console.error('seed failed', await put.text()); process.exit(1); }

  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const paths = [];
  try {
    for (const lang of ['ar', 'fr']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
      const page = await ctx.newPage();
      page.on('dialog', d => d.accept());
      await page.addInitScript(l => { try { localStorage.setItem('ae_lang', l); sessionStorage.clear(); } catch (e) {} }, lang);
      await page.goto(B + '/app');
      await page.waitForSelector('[data-oq-signin]', { timeout: 30000 });
      const p1 = path.join(SHOTS, `forgot-${lang}-1-login-link.png`);
      await page.screenshot({ path: p1 }); paths.push(p1);

      await page.click('[data-oq-forgot-link]');
      await page.waitForSelector('[data-oq-forgot=user]', { timeout: 10000 });
      const p2 = path.join(SHOTS, `forgot-${lang}-2-request.png`);
      await page.screenshot({ path: p2 }); paths.push(p2);

      await page.fill('[data-oq-forgot=user] input[name=username]', 'admin');
      await page.click('[data-oq-forgot=user] button.b.pri');
      await page.waitForSelector('[data-oq-forgot=code]', { timeout: 10000 });
      const p3 = path.join(SHOTS, `forgot-${lang}-3-reset.png`);
      await page.screenshot({ path: p3 }); paths.push(p3);

      await page.click('button.fp-link');
      await page.waitForSelector('[data-oq-signin]', { timeout: 10000 });
      await page.fill('[data-oq-signin] input[name=username]', 'admin');
      await page.fill('[data-oq-signin] input[name=password]', 'Demo1234');
      await page.click('[data-oq-signin] button.b.pri');
      await page.waitForSelector('.nav', { timeout: 20000 });
      // settings is the last manager nav item; click by label in current language
      const settingsLbl = lang === 'fr' ? 'Paramètres' : 'الإعدادات';
      await page.click(`.nav button:has-text("${settingsLbl}")`);
      await page.waitForSelector('[data-oq-user-email=admin]', { timeout: 10000 });
      await page.locator('[data-oq-team-accounts]').scrollIntoViewIfNeeded();
      const p4 = path.join(SHOTS, `forgot-${lang}-4-settings-email.png`);
      await page.screenshot({ path: p4 }); paths.push(p4);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => { srv.on('exit', () => resolve()); srv.kill('SIGTERM'); setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} }, 2000); });
  }
  console.log('SHOTS');
  paths.forEach(p => console.log(p));
})().catch(e => { console.error(e); process.exit(1); });
