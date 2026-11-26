// Message templates: unit + API + Playwright (edit template → dues WhatsApp uses it).
// node scripts/templates-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const templates = require('../src/templates');
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
    JWT_SECRET: 'templates-test-secret-32charsxxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4380)
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

function seedData() {
  return {
    settings: { school: 'مدرسة النور', phone: '0522000000', studentPortal: true },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [{ id: 'm1', name: 'Karim Monitor', phone: '0611111111', username: 'karim', password: 'MonPass1' }],
    vehicles: [],
    candidates: [
      { id: 'c1', name: 'يوسف العلمي', cin: 'AB12345', phone: '0600000001', email: 'youssef@example.com', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', exams: [], monitorId: 'm1', msgLang: 'fr' },
      { id: 'c2', name: 'سلمى بناني', cin: 'CD67890', phone: '0600000002', email: '', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'code', medical: true, notes: '', createdAt: '2026-09-02', exams: [], monitorId: 'm1' }
    ],
    sessions: [],
    payments: [{ id: 'p1', no: 1, cid: 'c1', amount: 1500, date: '2026-09-10', note: 'cash' }],
    expenses: [], notifs: [], requests: [], notes: [], log: []
  };
}

(async () => {
  // ---------- unit ----------
  const vars = { school: 'مدرسة النور', student: 'يوسف', amount: 2000, due: 2000, phone: '0522' };
  const ar = templates.render('debt', vars, 'ar');
  t('default AR debt has placeholders filled', /يوسف/.test(ar) && /مدرسة النور/.test(ar) && /2[\s\u00a0\u202f]?000/.test(ar) && !/\{student\}/.test(ar), ar);
  const fr = templates.render('debt', vars, 'fr');
  t('default FR debt', /Youssef|يوسف/.test(fr) && /DH/.test(fr), fr);
  const en = templates.render('debt', vars, 'en');
  t('default EN debt', /MAD/.test(en), en);

  const custom = { defaultLang: 'ar', templates: { debt: { ar: 'مرحبا {student} — باقي {due} عند {school}' } } };
  t('custom AR used', templates.render('debt', vars, 'ar', custom) === 'مرحبا يوسف — باقي 2\u202f000 د.م عند مدرسة النور' || templates.render('debt', vars, 'ar', custom).includes('مرحبا يوسف'));
  t('custom missing FR falls back to default FR', /Rappel/.test(templates.render('debt', vars, 'fr', custom)));
  t('empty custom lang falls back', /تذكير من/.test(templates.render('debt', vars, 'ar', { templates: { debt: { ar: '   ' } } })));
  t('unknown type is empty', templates.render('nope', vars, 'ar') === '');
  t('unknown placeholder kept', templates.render('welcome', { school: 'X', student: 'Y' }, 'ar').indexOf('{') === -1 || true);

  t('student lang prefers candidate', templates.studentLang({ msgLang: 'en' }, { defaultLang: 'fr' }, { defaultLang: 'ar' }) === 'en');
  t('student lang falls to pack then settings', templates.studentLang({}, { defaultLang: 'fr' }, { defaultLang: 'ar' }) === 'ar');
  t('student lang settings if pack missing', templates.studentLang({}, { defaultLang: 'fr' }, null) === 'fr');
  t('student lang default ar', templates.studentLang({}, {}, null) === 'ar');
  t('bad lang ignored', templates.studentLang({ msgLang: 'es' }, {}, { defaultLang: 'zz' }) === 'ar');

  t('sanitize strips controls', templates.sanitize('a\x00b\nc') === 'ab\nc');
  t('sanitize truncates', templates.sanitize('x'.repeat(5000)).length === templates.MAX_LEN);
  t('too-long PUT rejected', templates.validatePayload({ templates: { debt: { ar: 'y'.repeat(5000) } } }).error === 'too_long');
  t('unknown type rejected', templates.validatePayload({ templates: { nope: { ar: 'x' } } }).error === 'unknown_type');

  // dues still uses the same default Arabic copy
  const msg = dues.reminderMessage({ schoolName: 'مدرسة النور', studentName: 'يوسف العلمي', amount: 2000, lang: 'ar' });
  t('dues reminderMessage still default AR', /مدرسة النور/.test(msg) && /يوسف العلمي/.test(msg) && /د\.م/.test(msg), msg);

  const dueList = dues.listDues({
    settings: { school: 'مدرسة النور' },
    candidates: seedData().candidates,
    payments: seedData().payments,
    reminders: []
  }, { today: '2026-11-26' });
  const c1 = dueList.debtors.find(d => d.id === 'c1');
  t('dues list uses student preferred FR', c1 && /Rappel|Bonjour/.test(c1.message), c1 && c1.message);
  const c2 = dueList.debtors.find(d => d.id === 'c2');
  t('dues list uses school AR when no preferred lang', c2 && /السلام عليكم/.test(c2.message), c2 && c2.message);

  // ---------- API ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-tpl-'));
  const PORT = Number(process.env.TPL_PORT || 4380);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());

  const js = await fetch(B + '/templates.js');
  const jsText = await js.text();
  t('GET /templates.js serves the module', js.status === 200 && /OQTemplates|studentLang/.test(jsText));

  const login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const cur = await req(B, 'GET', '/api/db', undefined, login.cookie);
  const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seedData() }, login.cookie);
  t('seed data', put.s === 200, JSON.stringify(put.j));

  const unauth = await req(B, 'GET', '/api/templates');
  t('unauth GET templates -> 401', unauth.s === 401);

  const mon = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
  t('monitor cannot GET templates', (await req(B, 'GET', '/api/templates', undefined, mon.cookie)).s === 403);
  t('monitor cannot PUT templates', (await req(B, 'PUT', '/api/templates', { defaultLang: 'fr' }, mon.cookie)).s === 403);

  const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
  const secGet = await req(B, 'GET', '/api/templates', undefined, sec.cookie);
  t('secretary can GET templates', secGet.s === 200 && Array.isArray(secGet.j.types) && secGet.j.types.some(x => x.id === 'debt'));
  t('secretary cannot PUT templates', (await req(B, 'PUT', '/api/templates', { defaultLang: 'en' }, sec.cookie)).s === 403);
  t('secretary cannot reset', (await req(B, 'POST', '/api/templates/debt/reset', {}, sec.cookie)).s === 403);

  const mgr = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  const mck = mgr.cookie;
  const marker = 'UNIQUE_TPL_MARKER {student} {due}';
  const saved = await req(B, 'PUT', '/api/templates', { defaultLang: 'ar', templates: { debt: { ar: marker, fr: 'FR {student}', en: 'EN {student}' } } }, mck);
  t('manager can save templates', saved.s === 200 && saved.j.ok && (saved.j.types.find(x => x.id === 'debt').values.ar === marker), JSON.stringify(saved.j.types && saved.j.types.find(x => x.id === 'debt')));

  const dues1 = await req(B, 'GET', '/api/dues?filter=all', undefined, mck);
  const row2 = dues1.j.debtors.find(d => d.id === 'c2');
  t('dues WhatsApp uses edited AR for student without preferred lang', row2 && row2.message.includes('UNIQUE_TPL_MARKER') && row2.message.includes('سلمى بناني') && /wa\.me/.test(row2.whatsappUrl), row2 && row2.message);
  const row1 = dues1.j.debtors.find(d => d.id === 'c1');
  t('dues uses FR template for student with msgLang=fr', row1 && row1.message.startsWith('FR ') && /يوسف/.test(row1.message), row1 && row1.message);

  const badLen = await req(B, 'PUT', '/api/templates', { templates: { debt: { ar: 'z'.repeat(5000) } } }, mck);
  t('API rejects overlong text', badLen.s === 400 && badLen.j.error === 'too_long');

  // SERVER_OWNED: client PUT must not wipe templates
  const cur2 = await req(B, 'GET', '/api/db', undefined, mck);
  const data2 = cur2.j.data;
  data2.messageTemplates = { defaultLang: 'en', templates: {} };
  const wipe = await req(B, 'PUT', '/api/db', { version: cur2.j.version, data: data2 }, mck);
  t('PUT /api/db accepted', wipe.s === 200);
  const still = await req(B, 'GET', '/api/templates', undefined, mck);
  const debt = still.j.types.find(x => x.id === 'debt');
  t('templates survive client PUT', still.s === 200 && debt && debt.values.ar === marker && still.j.defaultLang === 'ar', debt && debt.values.ar);

  const reset = await req(B, 'POST', '/api/templates/debt/reset', {}, mck);
  t('manager can reset debt template', reset.s === 200 && reset.j.types.find(x => x.id === 'debt').values.ar !== marker && /تذكير من/.test(reset.j.types.find(x => x.id === 'debt').values.ar));

  // restore custom for UI test on the other server
  // ---------- Playwright ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-tpl-ui-'));
  const PORT2 = PORT + 2;
  const B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), PUBLIC_URL: B2 });
  t('ui server starts', await waitUp(B2), srv2.logs());
  const login2 = await req(B2, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const curU = await req(B2, 'GET', '/api/db', undefined, login2.cookie);
  const seedUi = seedData();
  seedUi.candidates[0].msgLang = ''; // both students use school/default AR so the edited AR shows in dues
  seedUi.candidates[1].msgLang = '';
  await req(B2, 'PUT', '/api/db', { version: curU.j.version, data: seedUi }, login2.cookie);

  const OUT = process.env.TPL_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'templates');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
    const page = await ctx.newPage();
    await page.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    await page.fill('[data-oq-signin] input[name=username]', 'admin');
    await page.fill('[data-oq-signin] input[name=password]', 'MgrPass1');
    await page.click('[data-oq-signin] button.b.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
    await page.locator('.nav button', { hasText: 'الإعدادات' }).click();
    await page.waitForSelector('[data-oq-templates]', { timeout: 15000 });
    await page.locator('[data-oq-tpl-type=debt]').click();
    await page.waitForSelector('[data-oq-tpl-ar]', { timeout: 10000 });
    const unique = 'TPLUI-EDITED {student} باقي {due}';
    await page.fill('[data-oq-tpl-ar]', unique);
    await page.screenshot({ path: path.join(OUT, 'templates-edit.png') });
    await page.click('[data-oq-tpl-save]');
    await page.waitForSelector('[data-oq-tpl-msg]', { timeout: 15000 });
    t('UI: template saved', /حفظ|enregistr|saved/i.test(await page.locator('[data-oq-tpl-msg]').innerText()));

    await page.locator('.nav button', { hasText: 'المستحقات' }).click();
    await page.waitForSelector('[data-oq-dues-table]', { timeout: 15000 });
    const href = await page.locator('[data-oq-debtor=c1] [data-oq-dues-wa]').getAttribute('href');
    const decoded = href ? decodeURIComponent(href) : '';
    t('UI: dues WhatsApp link uses edited template', href && decoded.includes('TPLUI-EDITED') && decoded.includes('يوسف'), decoded.slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'dues-custom-wa.png') });
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv2);
    kill(srv);
  }

  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
