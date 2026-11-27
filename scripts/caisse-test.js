// Daily caisse + accounting export: unit + API + Playwright (journal, close, export, phone).
// node scripts/caisse-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const caisse = require('../src/caisse');

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
    JWT_SECRET: 'caisse-test-secret-32chars-xxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4450)
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
  const buf = !j ? Buffer.from(await r.arrayBuffer()) : null;
  return { s: r.status, j, cookie: cookieOf(r) || cookie, headers: r.headers, buf };
}
async function reqBin(base, url, cookie) {
  const r = await fetch(base + url, { method: 'GET', headers: { 'X-Otoqol': '1', Cookie: cookie || '' } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { s: r.status, buf, headers: r.headers, cookie: cookieOf(r) || cookie };
}

function seed() {
  return {
    settings: { school: 'مدرسة النور' },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [{ id: 'm1', name: 'Karim Monitor', phone: '0611111111', username: 'karim', password: 'MonPass1' }],
    vehicles: [{ id: 'v1', plate: 'A-12345' }],
    candidates: [
      { id: 'c1', name: 'Youssef Alami', cin: 'AB12345', phone: '0600000001', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [] }
    ],
    sessions: [],
    payments: [
      { id: 'p1', no: 1, cid: 'c1', amount: 1000, date: '2026-11-25', note: '' },
      { id: 'p2', no: 2, cid: 'c1', amount: 500, date: '2026-11-26', method: 'transfer', note: '' },
      { id: 'p3', no: 3, cid: 'c1', amount: 200, date: '2026-11-26', note: '' }
    ],
    expenses: [
      { id: 'x1', label: 'Fuel', category: 'بنزين', amount: 100, date: '2026-11-26', vehicleId: 'v1' }
    ],
    notifs: [], requests: [], notes: [], log: []
  };
}

(async () => {
  // ---------- unit ----------
  const nm = caisse.normalizeMethod(undefined);
  t('missing method is cash (inferred)', nm.method === 'cash' && nm.inferred === true);
  t('explicit transfer is not inferred', caisse.normalizeMethod('transfer').method === 'transfer' && caisse.normalizeMethod('transfer').inferred === false);

  const data = seed();
  data.caisseEntries = [{ id: 'ce1', date: '2026-11-26', direction: 'out', amount: 50, label: 'Timbre', method: 'cash', note: '' }];
  const j = caisse.journal(data, { from: '2026-11-26', to: '2026-11-26', method: 'all' });
  t('opening equals previous day closing', j.opening === 1000, JSON.stringify({ opening: j.opening, closing: j.closing, totals: j.totals }));
  // day 26: +500 transfer +200 cash -100 expense -50 manual = +550; closing = 1000+550=1550
  t('day net and closing include all methods', j.totals.in === 700 && j.totals.out === 150 && j.closing === 1550, JSON.stringify(j.totals) + ' close=' + j.closing);
  t('running balance ends at closing', j.days[0] && j.days[0].lines.length && j.days[0].lines[j.days[0].lines.length - 1].balance === 1550);

  const cash = caisse.journal(data, { from: '2026-11-26', to: '2026-11-26', method: 'cash' });
  // previous cash: p1 1000 (inferred cash). day: +200 -100 -50 = +50; opening 1000, closing 1050
  t('method filter: cash opening/closing ignore transfer', cash.opening === 1000 && cash.totals.in === 200 && cash.totals.out === 150 && cash.closing === 1050, JSON.stringify({ o: cash.opening, t: cash.totals, c: cash.closing }));

  t('expected cash is cash movements only', caisse.cashExpected(caisse.buildLines(data), '2026-11-26') === 50, String(caisse.cashExpected(caisse.buildLines(data), '2026-11-26')));

  const tr = caisse.journal(data, { from: '2026-11-26', to: '2026-11-26', method: 'transfer' });
  t('transfer filter opening is 0 (no prior transfer)', tr.opening === 0 && tr.totals.in === 500 && tr.closing === 500);

  const range = caisse.journal(data, { from: '2026-11-25', to: '2026-11-26', method: 'all' });
  t('period opening is 0 and day 25 closing is day 26 opening', range.opening === 0 && range.days[0].closing === range.days[1].opening && range.days[0].closing === 1000);

  const actorSec = { id: 'u2', name: 'السكريتيرة', role: 'secretary' };
  const actorMgr = { id: 'u1', name: 'المدير', role: 'manager' };
  const closed = JSON.parse(JSON.stringify(data));
  const cl = caisse.closeDay(closed, { date: '2026-11-26', countedCash: 40, note: 'ok' }, actorSec);
  t('close stores expected, counted, difference', cl.ok && cl.close.expectedCash === 50 && cl.close.countedCash === 40 && cl.close.difference === -10, JSON.stringify(cl.close));

  const blocked = caisse.addEntry(closed, { date: '2026-11-26', direction: 'in', label: 'x', amount: 10, method: 'cash' }, actorSec);
  t('secretary cannot add entry on a closed day', blocked.error === 'caisse_day_closed');
  const allowed = caisse.addEntry(closed, { date: '2026-11-26', direction: 'in', label: 'x', amount: 10, method: 'cash' }, actorMgr);
  t('manager can add entry on a closed day', allowed.ok === true);

  const incoming = JSON.parse(JSON.stringify(data));
  incoming.payments = incoming.payments.concat([{ id: 'p-new', no: 4, cid: 'c1', amount: 30, date: '2026-11-26', note: '' }]);
  const gSec = caisse.guardClosedDays(closed, incoming, { role: 'secretary' });
  t('secretary PUT payment on closed day is blocked', gSec.ok === false && gSec.error === 'caisse_day_closed');
  const gMgr = caisse.guardClosedDays(closed, incoming, { role: 'manager' });
  t('manager PUT payment on closed day is allowed', gMgr.ok === true);
  const openAdd = JSON.parse(JSON.stringify(data));
  openAdd.payments = openAdd.payments.concat([{ id: 'p-open', no: 4, cid: 'c1', amount: 30, date: '2026-11-25', note: '' }]);
  t('secretary PUT payment on an open day is allowed', caisse.guardClosedDays(closed, openAdd, { role: 'secretary' }).ok === true);

  const csv = caisse.buildCsv(data, { from: '2026-11-25', to: '2026-11-26', lang: 'ar', format: 'csv' });
  t('CSV has UTF-8 BOM', csv.buffer[0] === 0xEF && csv.buffer[1] === 0xBB && csv.buffer[2] === 0xBF);
  const csvText = csv.buffer.toString('utf8');
  t('CSV has payments, expenses, manual, summary', /المدفوعات/.test(csvText) && /المصاريف/.test(csvText) && /القيود اليدوية/.test(csvText) && /الملخص/.test(csvText) && /Youssef Alami/.test(csvText));

  const xlsx = caisse.buildXlsx(data, { from: '2026-11-25', to: '2026-11-26', lang: 'en', format: 'xlsx' });
  t('xlsx is a ZIP (PK)', xlsx.buffer.slice(0, 2).toString() === 'PK' && xlsx.filename.endsWith('.xlsx'));
  t('xlsx contains four sheets', xlsx.buffer.includes('sheet1.xml') && xlsx.buffer.includes('sheet4.xml') && /Payments|Expenses|Manual|Summary/.test(xlsx.buffer.toString('utf8')));

  // ---------- API ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-caisse-'));
  const PORT = Number(process.env.CAISSE_PORT || 4450);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT), PUBLIC_URL: B });
  t('server starts', await waitUp(B), srv.logs());
  const login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const cur = await req(B, 'GET', '/api/db', undefined, login.cookie);
  const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seed() }, login.cookie);
  t('seed data', put.s === 200, JSON.stringify(put.j));

  const mgr = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
  const mon = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
  t('signins', mgr.s === 200 && sec.s === 200 && mon.s === 200);

  const monGet = await req(B, 'GET', '/api/caisse?from=2026-11-26&to=2026-11-26', undefined, mon.cookie);
  t('monitor GET /api/caisse -> 403', monGet.s === 403);

  const g = await req(B, 'GET', '/api/caisse?from=2026-11-26&to=2026-11-26', undefined, sec.cookie);
  t('secretary journal opening 1000, closing 1600 before manual', g.s === 200 && g.j.opening === 1000 && g.j.closing === 1600, JSON.stringify({ o: g.j && g.j.opening, c: g.j && g.j.closing, t: g.j && g.j.totals }));
  // 1000 open +500 +200 -100 = 1600 yes (no manual yet)

  const add = await req(B, 'POST', '/api/caisse/entries', { date: '2026-11-26', direction: 'out', label: 'Timbre', amount: 50, method: 'cash' }, sec.cookie);
  t('secretary can add a manual entry', add.s === 201 && add.j.entry && add.j.entry.id, JSON.stringify(add.j));

  const g2 = await req(B, 'GET', '/api/caisse?from=2026-11-26&to=2026-11-26', undefined, mgr.cookie);
  t('journal updates after manual entry', g2.s === 200 && g2.j.closing === 1550 && (g2.j.lines || []).some(l => l.source === 'manual' && l.amount === 50));

  const monAdd = await req(B, 'POST', '/api/caisse/entries', { date: '2026-11-26', direction: 'in', label: 'no', amount: 1, method: 'cash' }, mon.cookie);
  t('monitor POST entry -> 403', monAdd.s === 403);

  const closeday = await req(B, 'POST', '/api/caisse/close', { date: '2026-11-26', countedCash: 40, note: 'écart' }, sec.cookie);
  t('secretary can close the day', closeday.s === 200 && closeday.j.close && closeday.j.close.difference === -10, JSON.stringify(closeday.j && closeday.j.close));

  const addClosed = await req(B, 'POST', '/api/caisse/entries', { date: '2026-11-26', direction: 'in', label: 'late', amount: 10, method: 'cash' }, sec.cookie);
  t('secretary add on closed day -> 403', addClosed.s === 403 && addClosed.j.error === 'caisse_day_closed');

  const secDb = await req(B, 'GET', '/api/db', undefined, sec.cookie);
  const payClosed = JSON.parse(JSON.stringify(secDb.j.data));
  payClosed.payments = (payClosed.payments || []).concat([{ id: 'p-sec', no: 9, cid: 'c1', amount: 15, date: '2026-11-26', note: '' }]);
  const secPut = await req(B, 'PUT', '/api/db', { version: secDb.j.version, data: payClosed }, sec.cookie);
  t('secretary PUT payment on closed day -> 403 caisse_day_closed', secPut.s === 403 && secPut.j.error === 'caisse_day_closed');

  const payOpen = JSON.parse(JSON.stringify(secDb.j.data));
  payOpen.payments = (payOpen.payments || []).concat([{ id: 'p-sec-open', no: 10, cid: 'c1', amount: 15, date: '2026-11-25', note: 'new' }]);
  const secOpen = await req(B, 'PUT', '/api/db', { version: secDb.j.version, data: payOpen }, sec.cookie);
  t('secretary PUT payment on an open day still works', secOpen.s === 200, JSON.stringify(secOpen.j));

  const mgrDb = await req(B, 'GET', '/api/db', undefined, mgr.cookie);
  const payMgr = JSON.parse(JSON.stringify(mgrDb.j.data));
  payMgr.payments = (payMgr.payments || []).concat([{ id: 'p-mgr', no: 11, cid: 'c1', amount: 20, date: '2026-11-26', note: 'override' }]);
  const mgrPut = await req(B, 'PUT', '/api/db', { version: mgrDb.j.version, data: payMgr }, mgr.cookie);
  t('manager PUT payment on closed day is allowed', mgrPut.s === 200);

  const wipeDb = await req(B, 'GET', '/api/db', undefined, mgr.cookie);
  const wiped = JSON.parse(JSON.stringify(wipeDb.j.data));
  wiped.caisseEntries = [];
  wiped.caisseCloses = [];
  const wipe = await req(B, 'PUT', '/api/db', { version: wipeDb.j.version, data: wiped }, mgr.cookie);
  t('PUT accepted while stripping caisse arrays', wipe.s === 200);
  const kept = await req(B, 'GET', '/api/caisse?from=2026-11-26&to=2026-11-26', undefined, mgr.cookie);
  t('caisseEntries and closes survive client PUT', kept.s === 200 && (kept.j.days[0].close) && (kept.j.lines || []).some(l => l.source === 'manual'), JSON.stringify({ close: kept.j.days && kept.j.days[0] && kept.j.days[0].close, sources: (kept.j.lines || []).map(l => l.source) }));

  const csvApi = await reqBin(B, '/api/caisse/export?from=2026-11-25&to=2026-11-26&format=csv&lang=ar', sec.cookie);
  t('export CSV is 200 with BOM', csvApi.s === 200 && csvApi.buf[0] === 0xEF && csvApi.buf[1] === 0xBB && /الملخص/.test(csvApi.buf.toString('utf8')));
  const xApi = await reqBin(B, '/api/caisse/export?from=2026-11-25&to=2026-11-26&format=xlsx&lang=fr', mgr.cookie);
  t('export xlsx is 200 PK', xApi.s === 200 && xApi.buf.slice(0, 2).toString() === 'PK' && /sheet4/.test(xApi.buf.toString('utf8')));
  const monExp = await reqBin(B, '/api/caisse/export?from=2026-11-25&to=2026-11-26&format=csv', mon.cookie);
  t('monitor export -> 403', monExp.s === 403);

  // ---------- Playwright ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-caisse-ui-'));
  const PORT2 = PORT + 2;
  const B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), PUBLIC_URL: B2 });
  t('ui server starts', await waitUp(B2), srv2.logs());
  const login2 = await req(B2, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const cur2 = await req(B2, 'GET', '/api/db', undefined, login2.cookie);
  await req(B2, 'PUT', '/api/db', { version: cur2.j.version, data: seed() }, login2.cookie);

  const OUT = process.env.CAISSE_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'caisse');
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
    await page.locator('[data-oq-nav-item="caisse"]').click();
    await page.waitForSelector('[data-oq-caisse]', { timeout: 15000 });
    await page.fill('[data-oq-caisse-from]', '2026-11-26');
    await page.fill('[data-oq-caisse-to]', '2026-11-26');
    await page.waitForTimeout(400);
    t('UI: nav opens الصندوق', await page.locator('[data-oq-caisse]').count() === 1);
    t('UI: payment and expense lines appear', await page.locator('[data-oq-caisse-line]').count() >= 2);
    await page.screenshot({ path: path.join(OUT, 'staff-caisse-day.png'), fullPage: true });

    // add manual
    const card = page.locator('[data-oq-caisse] .card').filter({ hasText: 'إضافة قيد' });
    await card.locator('input[type=date]').fill('2026-11-26');
    await card.locator('select').first().selectOption('out');
    await card.locator('input').nth(1).fill('Timbre'); // description - date is first input
    // more reliable: label fields
    // F l=الوصف is an input without type
    const desc = card.locator('label.f').filter({ hasText: 'الوصف' }).locator('input');
    const amt = card.locator('label.f').filter({ hasText: 'المبلغ' }).locator('input');
    await desc.fill('Timbre');
    await amt.fill('50');
    await page.locator('[data-oq-caisse-add]').click();
    await page.waitForTimeout(800);
    t('UI: manual entry appears', await page.locator('[data-oq-caisse-line^="m:"]').count() >= 1);

    await page.locator('[data-oq-caisse-close="2026-11-26"]').click();
    await page.waitForSelector('[data-oq-caisse-close-modal]', { timeout: 8000 });
    await page.fill('[data-oq-caisse-counted]', '40');
    await page.fill('[data-oq-caisse-close-note]', 'écart');
    page.removeAllListeners('dialog');
    page.on('dialog', d => d.dismiss());
    await page.locator('[data-oq-caisse-close-save]').click();
    await page.waitForTimeout(800);
    t('UI: day shows closed badge', /اليوم مقفل/.test(await page.locator('[data-oq-caisse-day="2026-11-26"]').innerText()));
    await page.screenshot({ path: path.join(OUT, 'staff-caisse-closed.png'), fullPage: true });

    t('UI: export buttons present', await page.locator('[data-oq-caisse-export-csv]').count() === 1 && await page.locator('[data-oq-caisse-export-xlsx]').count() === 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('UI: mobile no serious horizontal overflow', overflow <= 8, String(overflow));
    await page.screenshot({ path: path.join(OUT, 'staff-caisse-mobile.png'), fullPage: true });

    // monitor has no caisse nav
    const monCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    const mp = await monCtx.newPage();
    await mp.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await mp.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    await mp.fill('[data-oq-signin] input[name=username]', 'karim');
    await mp.fill('[data-oq-signin] input[name=password]', 'MonPass1');
    await mp.click('[data-oq-signin] button.b.pri');
    await mp.waitForSelector('.nav', { timeout: 20000 });
    t('UI: monitor has no الصندوق nav', await mp.locator('[data-oq-nav-item="caisse"]').count() === 0);
    await monCtx.close();
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv2);
    kill(srv);
  }

  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
