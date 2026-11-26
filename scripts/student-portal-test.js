// Student portal: unit + API isolation + Playwright happy path.
// node scripts/student-portal-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const portal = require('../src/portal');

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
    JWT_SECRET: 'student-portal-test-secret-32chars', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4360)
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

const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
const cookieOf = res => ((res.headers.get('set-cookie') || '').split(';')[0] || '');
async function req(base, method, url, body, cookie) {
  const r = await fetch(base + url, { method, headers: { ...H, Cookie: cookie || '' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, cookie: cookieOf(r) || cookie };
}

function seedData() {
  return {
    settings: { school: 'Auto Ecole Demo', absLimit: 3, studentPortal: true },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [{ id: 'm1', name: 'Karim Monitor', phone: '0612345678', username: 'karim', password: 'MonPass1' }],
    vehicles: [{ id: 'v1', plate: '12345-A-6', model: 'Dacia' }],
    candidates: [
      { id: 'c1', name: 'Youssef Alami', cin: 'AB12345', phone: '0600000001', email: 'youssef@example.com', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1' },
      { id: 'c2', name: 'Salma Bennani', cin: 'CD67890', phone: '0600000002', email: 'salma@example.com', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'code', medical: true, notes: '', createdAt: '2026-09-02', exams: [], monitorId: 'm1' }
    ],
    sessions: [],
    payments: [{ id: 'p1', no: 1, cid: 'c1', amount: 1500, date: '2026-09-10', note: 'cash' }],
    expenses: [], notifs: [], requests: [], notes: [
      { id: 'nt1', cid: 'c1', monitorId: 'm1', text: 'good driver', date: '2026-09-20' }
    ], log: []
  };
}

(async () => {
  // ---------- unit ----------
  t('overlaps same hour', portal.overlaps('2026-12-01', '09:00', 1, '2026-12-01', '09:00', 1) === true);
  t('overlaps adjacent does not', portal.overlaps('2026-12-01', '09:00', 1, '2026-12-01', '10:00', 1) === false);
  t('overlaps different day does not', portal.overlaps('2026-12-01', '09:00', 1, '2026-12-02', '09:00', 1) === false);
  t('portalEnabled default true', portal.portalEnabled({}) === true && portal.portalEnabled(undefined) === true);
  t('portalEnabled false', portal.portalEnabled({ studentPortal: false }) === false);
  t('hoursDone counts present only', portal.hoursDone({
    sessions: [
      { duration: 2, type: 'conduite', att: [{ cid: 'c1', status: 'present' }] },
      { duration: 1, type: 'conduite', att: [{ cid: 'c1', status: 'pending' }] },
      { duration: 1, type: 'code', att: [{ cid: 'c1', status: 'late' }] }
    ]
  }, 'c1', 'conduite') === 2);
  t('paidOf sums one student only', portal.paidOf({
    payments: [{ cid: 'c1', amount: 100 }, { cid: 'c2', amount: 50 }, { cid: 'c1', amount: 25 }]
  }, 'c1') === 125);
  const taken = new Set(['youssef', 'youssef2']);
  const un = portal.suggestUsername('Youssef Alami', 'AB12', u => taken.has(u));
  t('suggestUsername skips taken', un && un !== 'youssef' && un !== 'youssef2', un);
  t('waLink formats Moroccan phone', portal.waLink('0600000001', 'hi').startsWith('https://wa.me/212600000001?'));
  const slots = portal.freeSlots({
    settings: { portalOpen: '09:00', portalClose: '12:00', portalDays: [1, 2, 3, 4, 5, 6, 0] },
    sessions: [{ date: '2026-12-01', time: '09:00', duration: 1, monitorId: 'm1', att: [{ cid: 'c1', status: 'planned' }] }]
  }, 'm1', { now: { date: '2026-12-01', time: '08:00' }, days: 1 });
  t('freeSlots skips taken 09:00', slots.every(s => !(s.date === '2026-12-01' && s.time === '09:00')) && slots.some(s => s.time === '10:00'), JSON.stringify(slots));
  t('CONSENT_VERSION set', !!portal.CONSENT_VERSION);

  // ---------- API ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-portal-'));
  const PORT = Number(process.env.PORTAL_PORT || 4360);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());

  let login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const schoolCk = login.cookie;
  const cur = await req(B, 'GET', '/api/db', undefined, schoolCk);
  const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seedData() }, schoolCk);
  t('seed data', put.s === 200, JSON.stringify(put.j));

  const mgr = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  t('manager signin', mgr.s === 200 && mgr.j.user.role === 'manager');
  const mck = mgr.cookie;

  const page = await fetch(B + '/portal');
  const html = await page.text();
  t('GET /portal serves the student app', page.status === 200 && /data-oq-portal-signin|بوابة التلميذ/.test(html));

  const inv1 = await req(B, 'POST', '/api/portal/invite', { cid: 'c1', email: 'youssef@example.com' }, mck);
  t('invite student A returns url + username + whatsapp', inv1.s === 200 && inv1.j.url && inv1.j.username && inv1.j.whatsappUrl, JSON.stringify(inv1.j));
  const tokenA = (inv1.j.url || '').split('token=')[1];
  t('invite token present', !!tokenA);

  const inv2 = await req(B, 'POST', '/api/portal/invite', { cid: 'c2' }, mck);
  t('invite student B', inv2.s === 200 && inv2.j.url);
  const tokenB = (inv2.j.url || '').split('token=')[1];

  const monInvite = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
  const monInv = await req(B, 'POST', '/api/portal/invite', { cid: 'c1' }, monInvite.cookie);
  t('monitor cannot invite', monInv.s === 403);

  const pubInv = await req(B, 'GET', '/api/portal/invite/' + tokenA);
  t('public invite info hides other students', pubInv.s === 200 && pubInv.j.username && pubInv.j.studentName === 'Youssef Alami' && !/Salma/.test(JSON.stringify(pubInv.j)));

  const noConsent = await req(B, 'POST', '/api/portal/activate', { token: tokenA, password: 'StudPass1', consent: false });
  t('activate without consent -> 400', noConsent.s === 400 && noConsent.j.error === 'consent_required');

  const actA = await req(B, 'POST', '/api/portal/activate', { token: tokenA, password: 'StudPass1', consent: true });
  t('activate A signs in as student', actA.s === 200 && actA.j.user && actA.j.user.role === 'student' && actA.j.user.cid === 'c1');
  const ack = actA.cookie;

  const actA2 = await req(B, 'POST', '/api/portal/activate', { token: tokenA, password: 'StudPass1', consent: true });
  t('invite cannot be reused', actA2.s === 400);

  const actB = await req(B, 'POST', '/api/portal/activate', { token: tokenB, password: 'StudPass2', consent: true });
  t('activate B', actB.s === 200 && actB.j.user.cid === 'c2');
  const bck = actB.cookie;

  const dbA = await req(B, 'GET', '/api/db', undefined, ack);
  t('student cannot GET /api/db', dbA.s === 403);
  const verA = await req(B, 'GET', '/api/db/version', undefined, ack);
  t('student cannot GET /api/db/version', verA.s === 403);
  const putA = await req(B, 'PUT', '/api/db', { version: 1, data: seedData() }, ack);
  t('student cannot PUT /api/db', putA.s === 403);
  const narsaA = await req(B, 'GET', '/api/narsa/docs?cid=c2&type=contrat', undefined, ack);
  t('student cannot print NARSA', narsaA.s === 403);

  const meA = await req(B, 'GET', '/api/portal/me', undefined, ack);
  t('student A dashboard is only A', meA.s === 200 && meA.j.candidate.id === 'c1' && meA.j.balance.due === 2000 && !JSON.stringify(meA.j).includes('Salma') && !JSON.stringify(meA.j).includes('c2'));
  t('consent logged', meA.j.user.consentAt && meA.j.user.consentVersion === portal.CONSENT_VERSION);

  const meB = await req(B, 'GET', '/api/portal/me', undefined, bck);
  t('student B dashboard is only B', meB.s === 200 && meB.j.candidate.id === 'c2' && meB.j.balance.due === 3000 && !JSON.stringify(meB.j).includes('Youssef'));

  const staffDb = await req(B, 'GET', '/api/db', undefined, mck);
  const leakedInvite = staffDb.j.data && staffDb.j.data.portalInvites;
  const pwLeak = (staffDb.j.data.portalUsers || []).some(u => u.password);
  t('staff GET /api/db strips invites and portal passwords', staffDb.s === 200 && !leakedInvite && !pwLeak);

  // pick a free slot
  const sched = await req(B, 'GET', '/api/portal/schedule?monitorId=m1', undefined, ack);
  t('schedule lists slots and not the other student', sched.s === 200 && Array.isArray(sched.j.slots) && sched.j.slots.length > 0 && !JSON.stringify(sched.j).includes('Salma'));
  const slot = sched.j.slots[0];
  const book = await req(B, 'POST', '/api/portal/bookings', { date: slot.date, time: slot.time, duration: 1, type: 'conduite', monitorId: 'm1' }, ack);
  t('A can request a lesson', book.s === 201 && book.j.request && book.j.request.status === 'pending' && book.j.request.cid === 'c1', JSON.stringify(book.j));
  const bid = book.j.request.id;

  const bookBsame = await req(B, 'POST', '/api/portal/bookings', { date: slot.date, time: slot.time, duration: 1, type: 'conduite', monitorId: 'm1' }, bck);
  t('B cannot take the held slot', bookBsame.s === 409);

  const list = await req(B, 'GET', '/api/portal/requests', undefined, mck);
  t('staff sees pending booking', list.s === 200 && list.j.pending >= 1 && list.j.requests.some(r => r.id === bid && r.cid === 'c1'));

  const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
  const approve = await req(B, 'POST', '/api/portal/requests/' + bid + '/approve', {}, sec.cookie);
  t('secretary can approve', approve.s === 200 && approve.j.request.status === 'approved');

  const meA2 = await req(B, 'GET', '/api/portal/schedule', undefined, ack);
  const confirmed = (meA2.j.upcoming || []).some(s => s.date === slot.date && s.time === slot.time && s.status === 'planned');
  t('student sees confirmed lesson after approval', confirmed, JSON.stringify(meA2.j.upcoming && meA2.j.upcoming[0]));

  const pay = await req(B, 'GET', '/api/portal/payments', undefined, ack);
  t('payments history is only A', pay.s === 200 && pay.j.paid === 1500 && (pay.j.payments || []).every(x => !x.cid || true) && pay.j.payments.length === 1);

  const hist = await req(B, 'GET', '/api/portal/history', undefined, ack);
  t('history notes are only A', hist.s === 200 && (hist.j.notes || []).every(n => n.text === 'good driver'));

  // disable portal
  const cur2 = await req(B, 'GET', '/api/db', undefined, mck);
  const data2 = cur2.j.data;
  data2.settings.studentPortal = false;
  const off = await req(B, 'PUT', '/api/db', { version: cur2.j.version, data: data2 }, mck);
  t('manager can turn the portal off', off.s === 200);
  const signOff = await req(B, 'POST', '/api/signin', { username: inv1.j.username, password: 'StudPass1' });
  t('student sign-in blocked when portal is off', signOff.s === 403 && signOff.j.error === 'portal_disabled');
  // turn back on for UI test
  const cur3 = await req(B, 'GET', '/api/db', undefined, mck);
  cur3.j.data.settings.studentPortal = true;
  await req(B, 'PUT', '/api/db', { version: cur3.j.version, data: cur3.j.data }, mck);

  // unauth
  const unauth = await req(B, 'GET', '/api/portal/me');
  t('unauth portal me -> 401', unauth.s === 401);

  // ---------- Playwright happy path (fresh school on another port) ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-portal-ui-'));
  const PORT2 = PORT + 2;
  const B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), PUBLIC_URL: B2 });
  t('ui server starts', await waitUp(B2), srv2.logs());
  const login2 = await req(B2, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const curU = await req(B2, 'GET', '/api/db', undefined, login2.cookie);
  await req(B2, 'PUT', '/api/db', { version: curU.j.version, data: seedData() }, login2.cookie);
  const mgr2 = await req(B2, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  const invU = await req(B2, 'POST', '/api/portal/invite', { cid: 'c1' }, mgr2.cookie);
  const tok = (invU.j.url || '').split('token=')[1];
  t('ui invite ready', !!tok, JSON.stringify(invU.j));

  const OUT = process.env.PORTAL_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'portal');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
    const page = await context.newPage();
    await page.goto(B2 + '/portal/invite?token=' + encodeURIComponent(tok), { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-portal-activate]', { timeout: 20000 });
    await page.fill('[data-oq-portal-pw]', 'StudPass1');
    await page.fill('[data-oq-portal-pw2]', 'StudPass1');
    await page.check('[data-oq-consent]');
    await page.screenshot({ path: path.join(OUT, 'invite-activate.png') });
    await page.click('button.b.pri');
    await page.waitForSelector('[data-oq-portal-page=home]', { timeout: 20000 });
    t('UI: activate lands on the dashboard', /Youssef/i.test(await page.content()));
    await page.screenshot({ path: path.join(OUT, 'dashboard.png') });

    await page.locator('[data-oq-portal-page=home] button.b.pri', { hasText: 'الجدول' }).click();
    await page.waitForSelector('[data-oq-portal-monitor]', { timeout: 15000 });
    // assigned monitor should already be selected; if not, pick first
    const midVal = await page.$eval('[data-oq-portal-monitor]', el => el.value);
    if (!midVal) await page.selectOption('[data-oq-portal-monitor]', 'm1');
    await page.waitForSelector('[data-oq-slot]', { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, 'schedule.png') });
    await page.locator('[data-oq-slot] button.b.pri').first().click();
    await page.waitForSelector('.al.ok', { timeout: 15000 });
    t('UI: student requested a lesson', /طلب/.test(await page.locator('.al.ok').innerText()));

    // staff approves in a new page
    const staffPage = await context.newPage();
    // new page shares cookies — logout first via API then sign in as manager in a clean context
    await staffPage.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    // still student cookie — use a fresh context
    await staffPage.close();
    const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    const sp = await staffCtx.newPage();
    await sp.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await sp.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    await sp.fill('[data-oq-signin] input[name=username]', 'admin');
    await sp.fill('[data-oq-signin] input[name=password]', 'MgrPass1');
    await sp.click('[data-oq-signin] button.b.pri');
    await sp.waitForSelector('.nav', { timeout: 20000 });
    await sp.locator('.nav button', { hasText: 'طلبات الحجز' }).click();
    await sp.waitForSelector('[data-oq-booking-approve]', { timeout: 15000 });
    await sp.screenshot({ path: path.join(OUT, 'staff-requests.png') });
    await sp.click('[data-oq-booking-approve]');
    await sp.waitForFunction(() => !document.querySelector('[data-oq-booking-approve]'), { timeout: 15000 });
    t('UI: staff approved the request', true);
    await staffCtx.close();

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-oq-portal-page]', { timeout: 20000 });
    const onSched = await page.locator('[data-oq-portal-page=schedule]').count();
    if (!onSched) {
      const dash = page.locator('[data-oq-portal-page=home] button.b.pri', { hasText: 'الجدول' });
      if (await dash.count()) await dash.click();
      else {
        await page.click('[data-oq-nav-toggle]');
        await page.locator('[data-oq-portal-nav] button', { hasText: 'الجدول' }).click();
      }
    }
    await page.waitForSelector('[data-oq-lesson]', { timeout: 15000 });
    const st = await page.locator('[data-oq-lesson]').first().innerText();
    t('UI: student sees the confirmed lesson', /مبرمجة|planned|Planifi/i.test(st), st);
    await page.screenshot({ path: path.join(OUT, 'confirmed.png') });
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv2);
    kill(srv);
  }

  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
