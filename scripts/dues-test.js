// Debt reminders: unit + API + Playwright happy path.
// node scripts/dues-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dues = require('../src/dues');

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
    JWT_SECRET: 'dues-test-secret-32chars-xxxxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4370)
  }, extraEnv || {});
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: ['ignore', 'pipe', 'pipe'], env });
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

const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
const cookieOf = res => ((res.headers.get('set-cookie') || '').split(';')[0] || '');
async function req(base, method, url, body, cookie) {
  const r = await fetch(base + url, { method, headers: { ...H, Cookie: cookie || '' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, cookie: cookieOf(r) || cookie };
}

function sample(today) {
  return {
    settings: { school: 'مدرسة النور' },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [{ id: 'm1', name: 'Karim Monitor', phone: '0611111111', username: 'karim', password: 'MonPass1' }],
    vehicles: [],
    candidates: [
      { id: 'c1', name: 'يوسف العلمي', cin: 'AB12345', phone: '0600000001', email: 'youssef@example.com', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1' },
      { id: 'c2', name: 'سلمى بناني', cin: 'CD67890', phone: '0600000002', email: '', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'code', medical: true, notes: '', createdAt: '2026-09-02', exams: [], monitorId: 'm1' },
      { id: 'c3', name: 'أمينة العلوي', cin: 'EF11111', phone: '0600000003', email: 'amina@example.com', license: 'B', price: 4000, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-10-01', exams: [], monitorId: 'm1' },
      { id: 'c4', name: 'كمال الوافي', cin: 'GH22222', phone: '0600000004', email: '', license: 'B', price: 2000, codeHours: 10, driveHours: 20, stage: 'exam', medical: true, notes: '', createdAt: '2026-08-01', exams: [], monitorId: 'm1' }
    ],
    sessions: [],
    payments: [
      { id: 'p1', no: 1, cid: 'c1', amount: 1500, date: '2026-09-10', note: 'cash' },
      { id: 'p2', no: 2, cid: 'c3', amount: 3000, date: '2026-11-01', note: 'cash' },
      { id: 'p3', no: 3, cid: 'c4', amount: 2000, date: '2026-11-20', note: 'cash' }
    ],
    expenses: [], notifs: [], requests: [], notes: [], log: [],
    reminders: today ? [
      { id: 'r1', cid: 'c3', date: '2026-11-24', at: '2026-11-24T10:00:00.000Z', channel: 'manual', amount: 1000 }
    ] : []
  };
}

(async () => {
  // ---------- unit ----------
  const TODAY = '2026-11-26';
  t('weekStart Thursday is Monday', dues.weekStart(TODAY) === '2026-11-23');
  t('weekStart Monday stays', dues.weekStart('2026-11-23') === '2026-11-23');
  t('weekStart Sunday is previous Monday', dues.weekStart('2026-11-22') === '2026-11-16');
  t('daysBetween 10 Sep to 26 Nov is 77', dues.daysBetween('2026-09-10', TODAY) === 77);
  t('inThisWeek 24 Nov', dues.inThisWeek('2026-11-24', TODAY) === true);
  t('inThisWeek 22 Nov false', dues.inThisWeek('2026-11-22', TODAY) === false);

  const data = sample(true);
  t('dueOf c1 is 2000', dues.dueOf(data, 'c1') === 2000);
  t('dueOf c2 is 3000', dues.dueOf(data, 'c2') === 3000);
  t('dueOf c3 is 1000', dues.dueOf(data, 'c3') === 1000);
  t('dueOf paid-in-full is 0', dues.dueOf(data, 'c4') === 0);
  t('c1 high due', dues.isHighDue(data.candidates[0], 2000) === true);
  t('c3 not high due', dues.isHighDue(data.candidates[2], 1000) === false);

  const all = dues.listDues(data, { filter: 'all', today: TODAY, lang: 'ar' });
  t('paid-in-full excluded', all.count === 3 && all.debtors.every(d => d.id !== 'c4'));
  t('ranked longest silence first', all.debtors.map(d => d.id).join(',') === 'c2,c1,c3', all.debtors.map(d => d.id + ':' + d.daysSilent).join(','));
  t('c2 silent 85 from createdAt', all.debtors[0].daysSilent === 85);
  t('c1 silent 77 from last payment', all.debtors[1].daysSilent === 77);
  t('c3 silent 2 from last reminder', all.debtors[2].daysSilent === 2);

  const never = dues.listDues(data, { filter: 'never', today: TODAY });
  t('never reminded is c2 then c1', never.debtors.map(d => d.id).join(',') === 'c2,c1');
  const week = dues.listDues(data, { filter: 'week', today: TODAY });
  t('reminded this week is c3', week.debtors.map(d => d.id).join(',') === 'c3');
  const high = dues.listDues(data, { filter: 'high', today: TODAY });
  t('high due is c2 then c1', high.debtors.map(d => d.id).join(',') === 'c2,c1');

  const msgAr = dues.reminderMessage({ schoolName: 'مدرسة النور', studentName: 'يوسف العلمي', amount: 2000, lang: 'ar' });
  t('AR message has school, name, amount', /مدرسة النور/.test(msgAr) && /يوسف العلمي/.test(msgAr) && /2[\s\u00a0]?000/.test(msgAr) && /د\.م/.test(msgAr), msgAr);
  const msgFr = dues.reminderMessage({ schoolName: 'École Nour', studentName: 'Youssef', amount: 2000, lang: 'fr' });
  t('FR message', /École Nour/.test(msgFr) && /Youssef/.test(msgFr) && /DH/.test(msgFr), msgFr);
  const msgEn = dues.reminderMessage({ schoolName: 'Nour School', studentName: 'Youssef', amount: 2000, lang: 'en' });
  t('EN message', /Nour School/.test(msgEn) && /Youssef/.test(msgEn) && /MAD/.test(msgEn), msgEn);
  t('waLink Moroccan 06', dues.waLink('0600000001', 'hi') === 'https://wa.me/212600000001?text=hi');

  // ---------- API ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-dues-'));
  const PORT = Number(process.env.DUES_PORT || 4370);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());

  const login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const schoolCk = login.cookie;
  const cur = await req(B, 'GET', '/api/db', undefined, schoolCk);
  const seed = sample(false);
  // give c1 an old last payment so silence is not zero even if "today" is now
  const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seed }, schoolCk);
  t('seed data', put.s === 200, JSON.stringify(put.j));

  const mgr = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  t('manager signin', mgr.s === 200 && mgr.j.user.role === 'manager');
  const mck = mgr.cookie;

  const unauth = await req(B, 'GET', '/api/dues');
  t('unauth dues -> 401', unauth.s === 401);

  const mon = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
  t('monitor signin', mon.s === 200);
  const monList = await req(B, 'GET', '/api/dues', undefined, mon.cookie);
  t('monitor cannot list dues', monList.s === 403);
  const monRem = await req(B, 'POST', '/api/dues/c1/remind', { channel: 'manual' }, mon.cookie);
  t('monitor cannot mark reminded', monRem.s === 403);

  const list = await req(B, 'GET', '/api/dues?filter=all&lang=ar', undefined, mck);
  t('list includes unpaid only', list.s === 200 && list.j.count === 3 && list.j.debtors.every(d => d.due > 0) && !list.j.debtors.some(d => d.id === 'c4'), JSON.stringify(list.j.debtors && list.j.debtors.map(d => d.id + ':' + d.due)));
  t('list ranked by silence', list.j.debtors[0].daysSilent >= list.j.debtors[1].daysSilent && list.j.debtors[1].daysSilent >= list.j.debtors[2].daysSilent);
  const c1row = list.j.debtors.find(d => d.id === 'c1');
  t('c1 has due 2000 and wa url', c1row && c1row.due === 2000 && /wa\.me\/212600000001/.test(c1row.whatsappUrl) && /يوسف/.test(c1row.message) && /مدرسة النور/.test(c1row.message), JSON.stringify(c1row && { due: c1row.due, wa: c1row.whatsappUrl, msg: c1row.message }));
  t('c1 never reminded yet', c1row && c1row.neverReminded && c1row.daysSilent > 0);

  const neverF = await req(B, 'GET', '/api/dues?filter=never', undefined, mck);
  t('filter never has c1 and c2', neverF.s === 200 && neverF.j.debtors.some(d => d.id === 'c1') && neverF.j.debtors.some(d => d.id === 'c2'));
  const highF = await req(B, 'GET', '/api/dues?filter=high', undefined, mck);
  t('filter high has c1 and c2 not c3', highF.s === 200 && highF.j.debtors.some(d => d.id === 'c1') && highF.j.debtors.some(d => d.id === 'c2') && !highF.j.debtors.some(d => d.id === 'c3'));

  const noEmail = await req(B, 'POST', '/api/dues/c2/remind', { channel: 'email', lang: 'ar' }, mck);
  t('email without address -> 400 no_email', noEmail.s === 400 && noEmail.j.error === 'no_email');

  const badCh = await req(B, 'POST', '/api/dues/c1/remind', { channel: 'sms' }, mck);
  t('bad channel -> 400', badCh.s === 400 && badCh.j.error === 'bad_channel');
  const missing = await req(B, 'POST', '/api/dues/nope/remind', { channel: 'manual' }, mck);
  t('unknown candidate -> 404', missing.s === 404);
  const paid = await req(B, 'POST', '/api/dues/c4/remind', { channel: 'manual' }, mck);
  t('paid-in-full remind -> 400 no_due', paid.s === 400 && paid.j.error === 'no_due');

  const silentBefore = c1row.daysSilent;
  const rem = await req(B, 'POST', '/api/dues/c1/remind', { channel: 'whatsapp', lang: 'ar' }, mck);
  t('manager can mark reminded', rem.s === 200 && rem.j.ok && rem.j.reminder && rem.j.reminder.channel === 'whatsapp' && rem.j.reminder.amount === 2000 && rem.j.debtor.daysSilent === 0, JSON.stringify(rem.j.reminder));
  t('silence resets after reminder', rem.j.debtor.lastReminderDate === dues.todayCasablanca() && rem.j.debtor.daysSilent === 0 && rem.j.debtor.daysSilent < silentBefore);

  const after = await req(B, 'GET', '/api/dues?filter=all', undefined, mck);
  const c1b = after.j.debtors.find(d => d.id === 'c1');
  t('list reflects reminder', c1b && c1b.lastReminderDate === dues.todayCasablanca() && c1b.daysSilent === 0 && c1b.lastReminderChannel === 'whatsapp');
  const weekNow = await req(B, 'GET', '/api/dues?filter=week', undefined, mck);
  t('c1 now in reminded-this-week', weekNow.s === 200 && weekNow.j.debtors.some(d => d.id === 'c1'));

  const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
  const secRem = await req(B, 'POST', '/api/dues/c2/remind', { channel: 'manual' }, sec.cookie);
  t('secretary can mark reminded', secRem.s === 200 && secRem.j.reminder.channel === 'manual');

  const emailRem = await req(B, 'POST', '/api/dues/c3/remind', { channel: 'email', lang: 'fr' }, mck);
  t('email reminder logs even without mail', emailRem.s === 200 && emailRem.j.ok && emailRem.j.emailSent === false && emailRem.j.reminder.channel === 'email', JSON.stringify(emailRem.j));

  // SERVER_OWNED: client PUT must not wipe reminders
  const cur2 = await req(B, 'GET', '/api/db', undefined, mck);
  const data2 = cur2.j.data;
  data2.reminders = [];
  const wipe = await req(B, 'PUT', '/api/db', { version: cur2.j.version, data: data2 }, mck);
  t('PUT accepted while stripping reminders', wipe.s === 200);
  const kept = await req(B, 'GET', '/api/dues?filter=all', undefined, mck);
  const still = kept.j.debtors.find(d => d.id === 'c1');
  t('reminder history survives client PUT', still && still.lastReminderChannel === 'whatsapp' && still.lastReminderDate === dues.todayCasablanca(), JSON.stringify(still));

  // ---------- Playwright happy path ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-dues-ui-'));
  const PORT2 = PORT + 2;
  const B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), PUBLIC_URL: B2 });
  t('ui server starts', await waitUp(B2), srv2.logs());
  const login2 = await req(B2, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const curU = await req(B2, 'GET', '/api/db', undefined, login2.cookie);
  await req(B2, 'PUT', '/api/db', { version: curU.j.version, data: sample(false) }, login2.cookie);

  const OUT = process.env.DUES_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'dues');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    const page = await ctx.newPage();
    await page.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    await page.fill('[data-oq-signin] input[name=username]', 'admin');
    await page.fill('[data-oq-signin] input[name=password]', 'MgrPass1');
    await page.click('[data-oq-signin] button.b.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
    await page.locator('.nav button', { hasText: 'المستحقات' }).click();
    await page.waitForSelector('[data-oq-dues-table]', { timeout: 15000 });
    const row = page.locator('[data-oq-debtor=c1]');
    t('UI: unpaid student appears', await row.count() === 1);
    const silent = Number(await row.locator('[data-oq-silent-cell]').innerText());
    t('UI: silence is greater than 0', silent > 0, String(silent));
    await page.screenshot({ path: path.join(OUT, 'dues-list.png') });
    await row.locator('[data-oq-dues-mark]').click();
    await page.waitForSelector('[data-oq-dues-msg]', { timeout: 15000 });
    await page.waitForFunction(() => {
      const cell = document.querySelector('[data-oq-debtor="c1"] [data-oq-silent-cell]');
      return cell && cell.textContent.trim() === '0';
    }, { timeout: 15000 });
    const silentAfter = Number(await row.locator('[data-oq-silent-cell]').innerText());
    t('UI: mark reminded resets silence to 0', silentAfter === 0, String(silentAfter));
    await page.screenshot({ path: path.join(OUT, 'dues-reminded.png') });

    // phone layout still works
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('UI: mobile no serious horizontal overflow', overflow <= 8, String(overflow));
    await page.screenshot({ path: path.join(OUT, 'dues-mobile.png'), fullPage: true });
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv2);
    kill(srv);
  }

  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
