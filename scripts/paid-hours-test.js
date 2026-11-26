// Paid-hours booking block: unit + API + Playwright (staff override, portal, phone).
// node scripts/paid-hours-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const hours = require('../src/hours');

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
    JWT_SECRET: 'hours-test-secret-32chars-xxxxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4420)
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

function tomorrow() { return hours.casablancaParts().date > '2000-01-01' ? require('../src/tasks').addDays(hours.casablancaParts().date, 1) : null; }

function seed() {
  const today = hours.casablancaParts().date;
  const yest = require('../src/tasks').addDays(today, -1);
  return {
    settings: { school: 'مدرسة النور', phone: '0522000000', studentPortal: true },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [{ id: 'm1', name: 'Karim Monitor', phone: '0611111111', username: 'karim', password: 'MonPass1' }],
    vehicles: [{ id: 'v1', plate: 'A-12345' }],
    candidates: [
      { id: 'c-block', name: 'Blocked Student', cin: 'AB11111', phone: '0600000001', email: 'blocked@example.com', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1' },
      { id: 'c-warn', name: 'Warning Student', cin: 'CD22222', phone: '0600000002', email: 'warn@example.com', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'code', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1' },
      { id: 'c-ok', name: 'Paid Student', cin: 'EF33333', phone: '0600000003', email: 'ok@example.com', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1' },
      { id: 'c-free', name: 'No Price Student', cin: 'GH44444', phone: '0600000004', email: '', license: 'B', price: 0, codeHours: 10, driveHours: 20, stage: 'code', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1' }
    ],
    sessions: [
      { id: 's-past', date: yest, time: '10:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c-warn', status: 'present', reason: '' }] }
    ],
    payments: [
      { id: 'p-warn', no: 1, cid: 'c-warn', amount: 300, date: '2026-09-10', note: 'cash' }, // 300/3000*30 = 3 hours; 1 used => 2 left
      { id: 'p-ok', no: 2, cid: 'c-ok', amount: 3000, date: '2026-09-10', note: 'cash' }
    ],
    expenses: [], notifs: [], requests: [], notes: [], log: [], bookings: []
  };
}

function futureSession(cid, id, extra) {
  const tom = require('../src/tasks').addDays(hours.casablancaParts().date, 1);
  return Object.assign({
    id: id || 's-new',
    date: tom, time: '09:00', duration: 1, type: 'code', monitorId: 'm1', vehicleId: '', notes: '',
    att: [{ cid, status: 'planned', reason: '' }]
  }, extra || {});
}

(async () => {
  const data = seed();
  const snapB = hours.snapshot(data, 'c-block');
  t('zero payment => 0 entitled and blocked', snapB.applicable && snapB.entitled === 0 && snapB.left === 0 && snapB.blocked && snapB.warning);
  const snapW = hours.snapshot(data, 'c-warn');
  t('300/3000*30 - 1 used = 2 left, warning, can book 1h', snapW.applicable && Math.abs(snapW.entitled - 3) < 1e-9 && snapW.used === 1 && Math.abs(snapW.left - 2) < 1e-9 && snapW.warning && !snapW.blocked && snapW.blockedFor(1) === false && snapW.blockedFor(2) === false && snapW.blockedFor(2.1) === true, JSON.stringify({ e: snapW.entitled, u: snapW.used, l: snapW.left }));
  const snapOk = hours.snapshot(data, 'c-ok');
  t('fully paid, no warning', snapOk.applicable && Math.abs(snapOk.entitled - 30) < 1e-9 && snapOk.left === 30 && !snapOk.warning && !snapOk.blocked);
  const snapF = hours.snapshot(data, 'c-free');
  t('price 0 => rule not applied', snapF.applicable === false && snapF.blocked === false && snapF.warning === false);
  t('formatHours', hours.formatHours(2) === '2' && hours.formatHours(12.857) === '12.9');

  const usedData = JSON.parse(JSON.stringify(data));
  usedData.sessions.push(
    { id: 's-late', date: '2026-10-01', time: '10:00', duration: 2, type: 'code', att: [{ cid: 'c-ok', status: 'late' }] },
    { id: 's-abs', date: '2026-10-02', time: '10:00', duration: 1, type: 'code', att: [{ cid: 'c-ok', status: 'absent' }] },
    { id: 's-plan', date: '2026-10-03', time: '10:00', duration: 1, type: 'code', att: [{ cid: 'c-ok', status: 'planned' }] },
    { id: 's-pend', date: '2026-10-04', time: '10:00', duration: 1, type: 'code', att: [{ cid: 'c-ok', status: 'pending' }] },
    { id: 's-can', date: '2026-10-05', time: '10:00', duration: 5, type: 'code', att: [{ cid: 'c-ok', status: 'cancelled' }] }
  );
  t('used counts present/late/absent/planned/pending, not cancelled', hours.hoursUsed(usedData, 'c-ok') === 5);

  const incoming = JSON.parse(JSON.stringify(data));
  incoming.sessions.push(futureSession('c-block', 's-fut'));
  const diff = hours.bookingDiff(data, incoming);
  t('bookingDiff flags future booking for blocked student', diff.blocked.length === 1 && diff.blocked[0].cid === 'c-block' && diff.blocked[0].need === 1);

  const pastIn = JSON.parse(JSON.stringify(data));
  pastIn.sessions.push({ id: 's-hist', date: '2026-08-01', time: '09:00', duration: 2, type: 'code', monitorId: 'm1', att: [{ cid: 'c-block', status: 'present' }] });
  t('past sessions are not blocked', hours.bookingDiff(data, pastIn).blocked.length === 0);

  const gSec = hours.guardBookings(data, incoming, { role: 'secretary', user: { id: 'u2', name: 'sec' } });
  t('secretary cannot add a blocked future lesson', !gSec.ok && gSec.error === 'paid_hours_blocked');
  const gMgr = hours.guardBookings(data, incoming, { role: 'manager', user: { id: 'u1', name: 'mgr' } });
  t('manager without override is also blocked', !gMgr.ok && gMgr.error === 'paid_hours_blocked');
  const incOv = JSON.parse(JSON.stringify(incoming));
  incOv.sessions.find(s => s.id === 's-fut').att[0].hoursOverride = { reason: 'ok' };
  const gOv = hours.guardBookings(data, incOv, { role: 'manager', user: { id: 'u1', name: 'المدير' } });
  t('manager with override is allowed and stamped', gOv.ok && gOv.overrides && gOv.overrides.length === 1 && incOv.sessions.find(s => s.id === 's-fut').att[0].hoursOverride.by === 'u1', JSON.stringify(gOv));
  const gMonOv = hours.guardBookings(data, JSON.parse(JSON.stringify(incOv)), { role: 'monitor', user: { id: 'm1', name: 'Karim' } });
  t('monitor cannot use override flag', !gMonOv.ok);

  const low = hours.lowHoursStudents(data, { role: 'manager' });
  t('inbox helpers list blocked and warning, not ok or free', low.some(x => x.cid === 'c-block') && low.some(x => x.cid === 'c-warn') && !low.some(x => x.cid === 'c-ok') && !low.some(x => x.cid === 'c-free'));
  t('monitors do not get hours_low items', hours.lowHoursStudents(data, { role: 'monitor' }).length === 0);

  // ---------- API ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-hours-'));
  const PORT = Number(process.env.HOURS_PORT || 4420);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());
  t('/hours.js is served', (await fetch(B + '/hours.js')).ok && /OQHours/.test(await (await fetch(B + '/hours.js')).text()));

  const login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const cur = await req(B, 'GET', '/api/db', undefined, login.cookie);
  const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seed() }, login.cookie);
  t('seed data', put.s === 200, JSON.stringify(put.j));

  const mgr = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  t('manager signin', mgr.s === 200);
  const mck = mgr.cookie;
  const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
  const sck = sec.cookie;

  const curM = await req(B, 'GET', '/api/db', undefined, mck);
  const tryAdd = (cookie, cid, sid, override) => {
    const d = JSON.parse(JSON.stringify(curM.j.data));
    const att = { cid, status: 'planned', reason: '' };
    if (override) att.hoursOverride = { reason: 'manager' };
    d.sessions = (d.sessions || []).concat([futureSession(cid, sid, { att: [att] })]);
    return req(B, 'PUT', '/api/db', { version: curM.j.version, data: d }, cookie);
  };

  const secPut = await tryAdd(sck, 'c-block', 's-sec-block');
  t('secretary PUT future blocked lesson -> 403', secPut.s === 403 && secPut.j.error === 'paid_hours_blocked', JSON.stringify(secPut.j));

  const mon = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
  const monPut = await tryAdd(mon.cookie, 'c-block', 's-mon-block', true);
  t('monitor PUT with override flag still 403', monPut.s === 403 && monPut.j.error === 'paid_hours_blocked');

  const mgrNo = await tryAdd(mck, 'c-block', 's-mgr-no');
  t('manager PUT without override -> 403', mgrNo.s === 403 && mgrNo.j.error === 'paid_hours_blocked' && mgrNo.j.blocked && mgrNo.j.blocked[0].cid === 'c-block');

  const mgrYes = await tryAdd(mck, 'c-block', 's-mgr-yes', true);
  t('manager PUT with override -> 200', mgrYes.s === 200, JSON.stringify(mgrYes.j));
  const after = await req(B, 'GET', '/api/db', undefined, mck);
  t('override session persisted and logged', (after.j.data.sessions || []).some(s => s.id === 's-mgr-yes') && (after.j.data.hoursOverrides || []).some(o => o.cid === 'c-block' && o.sessionId === 's-mgr-yes') && (after.j.data.log || []).some(l => /تجاوز حظر/.test(l.text || '')), JSON.stringify({ ov: after.j.data.hoursOverrides, log: after.j.data.log && after.j.data.log[0] }));

  const wipe = JSON.parse(JSON.stringify(after.j.data));
  wipe.hoursOverrides = [];
  const wiped = await req(B, 'PUT', '/api/db', { version: after.j.version, data: wipe }, mck);
  t('PUT accepted while stripping hoursOverrides', wiped.s === 200);
  const kept = await req(B, 'GET', '/api/db', undefined, mck);
  t('hoursOverrides survive client PUT', (kept.j.data.hoursOverrides || []).some(o => o.sessionId === 's-mgr-yes'));

  const okPut = await (async () => {
    const d = JSON.parse(JSON.stringify(kept.j.data));
    d.sessions = d.sessions.concat([futureSession('c-ok', 's-ok-book')]);
    return req(B, 'PUT', '/api/db', { version: kept.j.version, data: d }, mck);
  })();
  t('fully paid student can be booked', okPut.s === 200);

  const inbox = await req(B, 'GET', '/api/tasks', undefined, mck);
  t('tasks inbox includes hours_low', inbox.s === 200 && (inbox.j.items || []).some(i => i.type === 'hours_low' && i.cid === 'c-block') && (inbox.j.items || []).some(i => i.type === 'hours_low' && i.cid === 'c-warn'));
  const monInbox = await req(B, 'GET', '/api/tasks', undefined, mon.cookie);
  t('monitor inbox has no hours_low', monInbox.s === 200 && !(monInbox.j.items || []).some(i => i.type === 'hours_low'));

  // portal
  const invB = await req(B, 'POST', '/api/portal/invite', { cid: 'c-block' }, mck);
  const tokenB = (invB.j && invB.j.url || '').split('token=')[1];
  const actB = await req(B, 'POST', '/api/portal/activate', { token: tokenB, password: 'StudPass1', consent: true });
  t('blocked student activates', actB.s === 200, JSON.stringify(actB.j));
  const meB = await req(B, 'GET', '/api/portal/me', undefined, actB.cookie);
  t('portal me shows blocked paidHours', meB.s === 200 && meB.j.paidHours && meB.j.paidHours.applicable && meB.j.paidHours.blocked && meB.j.paidHours.warning && meB.j.paidHours.left === 0, JSON.stringify(meB.j.paidHours));

  const invOk = await req(B, 'POST', '/api/portal/invite', { cid: 'c-ok' }, mck);
  const tokenOk = (invOk.j && invOk.j.url || '').split('token=')[1];
  const actOk = await req(B, 'POST', '/api/portal/activate', { token: tokenOk, password: 'StudPass2', consent: true });
  const sched = await req(B, 'GET', '/api/portal/schedule?monitorId=m1', undefined, actOk.cookie);
  t('paid student has slots', sched.s === 200 && (sched.j.slots || []).length > 0);
  const slot = (sched.j.slots || [])[0];
  const bookOk = await req(B, 'POST', '/api/portal/bookings', { date: slot.date, time: slot.time, duration: 1, type: 'conduite', monitorId: 'm1' }, actOk.cookie);
  t('paid student can request a lesson', bookOk.s === 201, JSON.stringify(bookOk.j));

  const schedB = await req(B, 'GET', '/api/portal/schedule?monitorId=m1', undefined, actB.cookie);
  const slotB = (schedB.j.slots || []).find(s => !(slot && s.date === slot.date && s.time === slot.time)) || (schedB.j.slots || [])[0];
  const bookB = slotB ? await req(B, 'POST', '/api/portal/bookings', { date: slotB.date, time: slotB.time, duration: 1, type: 'code', monitorId: 'm1' }, actB.cookie) : { s: 0, j: {} };
  t('blocked student portal booking -> 403 paid_hours_blocked', bookB.s === 403 && bookB.j.error === 'paid_hours_blocked', JSON.stringify(bookB.j));

  const invW = await req(B, 'POST', '/api/portal/invite', { cid: 'c-warn' }, mck);
  const tokenW = (invW.j && invW.j.url || '').split('token=')[1];
  const actW = await req(B, 'POST', '/api/portal/activate', { token: tokenW, password: 'StudPass3', consent: true });
  const meW = await req(B, 'GET', '/api/portal/me', undefined, actW.cookie);
  t('warning student has 2h left, not blocked for 1h', meW.s === 200 && meW.j.paidHours && meW.j.paidHours.warning && !meW.j.paidHours.blocked && Math.abs(meW.j.paidHours.left - 2) < 1e-9, JSON.stringify(meW.j.paidHours));

  // ---------- Playwright ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-hours-ui-'));
  const PORT2 = PORT + 2;
  const B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), PUBLIC_URL: B2 });
  t('ui server starts', await waitUp(B2), srv2.logs());
  const login2 = await req(B2, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const curU = await req(B2, 'GET', '/api/db', undefined, login2.cookie);
  await req(B2, 'PUT', '/api/db', { version: curU.j.version, data: seed() }, login2.cookie);
  const invUI = await req(B2, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  const invTok = await req(B2, 'POST', '/api/portal/invite', { cid: 'c-block' }, invUI.cookie);
  const tok = (invTok.j && invTok.j.url || '').split('token=')[1];
  await req(B2, 'POST', '/api/portal/activate', { token: tok, password: 'StudPass1', consent: true });

  const OUT = process.env.HOURS_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'paid-hours');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    const page = await ctx.newPage();
    page.on('dialog', d => d.dismiss());
    await page.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    await page.fill('[data-oq-signin] input[name=username]', 'admin');
    await page.fill('[data-oq-signin] input[name=password]', 'MgrPass1');
    await page.click('[data-oq-signin] button.b.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
    const hasHours = await page.evaluate(() => !!window.OQHours);
    t('UI: OQHours loaded in the staff app', hasHours);
    await page.locator('[data-oq-nav-item="candidates"]').click();
    await page.waitForSelector('tr.cl', { timeout: 15000 });
    await page.locator('tr.cl', { hasText: 'Blocked Student' }).click();
    await page.waitForSelector('.md', { timeout: 10000 });
    await page.waitForSelector('[data-oq-hours-banner="blocked"]', { timeout: 15000 });
    t('UI: blocked banner on student card', await page.locator('[data-oq-hours-banner="blocked"]').count() === 1);
    await page.screenshot({ path: path.join(OUT, 'staff-card-blocked.png'), fullPage: true });
    await page.locator('.md .mh button.x').click();
    await page.locator('tr.cl', { hasText: 'Warning Student' }).click();
    await page.waitForSelector('[data-oq-hours-banner="warn"]', { timeout: 10000 });
    t('UI: warning banner when 2 hours left', await page.locator('[data-oq-hours-banner="warn"]').count() === 1);
    await page.locator('.md .mh button.x').click();

    await page.locator('[data-oq-nav-item="sessions"]').click();
    await page.waitForTimeout(200);
    const tom = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const g = ty => parts.find(p => p.type === ty).value;
      const d = new Date(Date.UTC(+g('year'), +g('month') - 1, +g('day')));
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    });
    await page.getByText('+ حصة جديدة', { exact: false }).click();
    await page.waitForSelector('.md', { timeout: 8000 });
    await page.locator('.md input[type=date]').fill(tom);
    await page.locator('.md input[type=time]').fill('09:00');
    await page.locator('.md select').first().selectOption('code');
    await page.locator('.md .pick label').filter({ hasText: 'Blocked Student' }).locator('input[type=checkbox]').check();
    page.removeAllListeners('dialog');
    let confirmed = false;
    page.on('dialog', async d => { confirmed = /ساعات/.test(d.message()) || /heures/i.test(d.message()) || /paid hours/i.test(d.message()); await d.accept(); });
    await page.locator('.md button.b.pri', { hasText: 'حفظ' }).click();
    await page.waitForTimeout(1200);
    t('UI: manager confirm override when saving a blocked booking', confirmed);
    await page.locator('.bar input[type=date]').fill(tom);
    await page.waitForTimeout(400);
    t('UI: overridden session appears', await page.getByText('Blocked Student').count() > 0);
    await page.screenshot({ path: path.join(OUT, 'staff-override.png'), fullPage: true });

    // portal (fresh context — staff cookies would hide the sign-in form)
    const portalCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    const p2 = await portalCtx.newPage();
    await p2.goto(B2 + '/portal', { waitUntil: 'networkidle', timeout: 30000 });
    await p2.waitForSelector('[data-oq-portal-signin]', { timeout: 20000 });
    await p2.fill('[data-oq-portal-user]', invTok.j.username);
    await p2.fill('[data-oq-portal-pass]', 'StudPass1');
    await p2.locator('[data-oq-portal-signin] button.b.pri').click();
    await p2.waitForSelector('[data-oq-hours-banner="blocked"]', { timeout: 20000 });
    t('UI: portal shows blocked banner', await p2.locator('[data-oq-hours-banner="blocked"]').count() >= 1);
    await p2.getByText('الجدول', { exact: false }).first().click();
    await p2.waitForTimeout(500);
    const disabled = await p2.locator('[data-oq-book-slot]').evaluateAll(els => !els.length || els.every(b => b.disabled));
    t('UI: portal book buttons disabled when blocked', disabled);
    await p2.screenshot({ path: path.join(OUT, 'portal-blocked.png'), fullPage: true });

    await p2.setViewportSize({ width: 390, height: 844 });
    await p2.waitForTimeout(300);
    const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('UI: mobile no serious horizontal overflow', overflow <= 8, String(overflow));
    await p2.screenshot({ path: path.join(OUT, 'portal-blocked-mobile.png'), fullPage: true });
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv2);
    kill(srv);
  }

  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
