// NARSA printable documents: unit tests + API + UI.
// node scripts/narsa-docs-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const narsa = require('../public/narsa-docs.js');

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

function completeDb(extraCand, extraSettings) {
  return {
    settings: Object.assign({
      school: 'Auto Ecole Demo', absLimit: 3,
      address: '12 Rue Atlas, Casablanca', phone: '0522000000', fax: '0522000001',
      email: 'demo@example.com', city: 'الدار البيضاء', licenseNo: 'AE-12345',
      nationalRegNo: 'RN-9988', patente: 'TP-4455', rc: 'RC-2211', rcCity: 'الدار البيضاء',
      legalFirst: 'محمد', legalLast: 'العلوي', legalAddress: '12 Rue Atlas, Casablanca', legalPhone: '0611111111'
    }, extraSettings || {}),
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [
      { id: 'm1', name: 'Karim Monitor', phone: '0612345678', licenseNo: 'M-111', username: 'karim', password: 'MonPass1' },
      { id: 'm2', name: 'Sara Monitor', phone: '0612345679', licenseNo: 'M-222', username: 'sara', password: 'MonPass2' }
    ],
    vehicles: [{ id: 'v1', plate: '12345-A-6', model: 'Dacia Logan' }],
    candidates: [Object.assign({
      id: 'c1', name: 'Youssef Alami', firstName: 'Youssef', lastName: 'Alami',
      cin: 'AB12345', phone: '0600000001', address: 'Hay Hassani, Casablanca',
      license: 'B', price: 3500, codeHours: 20, driveHours: 25, stage: 'drive',
      medical: true, notes: '', createdAt: '2026-09-01', exams: [],
      nationality: 'مغربية', birthDate: '2000-05-10', birthPlace: 'الرباط', narsaRef: 'WEB-778899'
    }, extraCand || {})],
    sessions: [
      { id: 's1', date: '2026-09-10', time: '09:00', duration: 2, type: 'code', monitorId: 'm1', vehicleId: '', att: [{ cid: 'c1', status: 'present' }] },
      { id: 's2', date: '2026-10-02', time: '10:00', duration: 1, type: 'conduite', monitorId: 'm2', vehicleId: 'v1', att: [{ cid: 'c1', status: 'present' }] }
    ],
    payments: [], expenses: [], notifs: [], requests: [], notes: [], log: []
  };
}

function unitTests() {
  t('splitName uses explicit first/last', (() => { const s = narsa.splitName('Youssef Alami', 'Amina', 'Bennani'); return s.first === 'Amina' && s.last === 'Bennani'; })());
  t('splitName splits a two-part full name', (() => { const s = narsa.splitName('Youssef Alami'); return s.first === 'Youssef' && s.last === 'Alami'; })());
  t('splitName splits Arabic names', (() => { const s = narsa.splitName('يوسف العلمي'); return s.first === 'يوسف' && s.last === 'العلمي'; })());
  t('fmtDate turns ISO into DD/MM/YYYY', narsa.fmtDate('2000-05-10') === '10/05/2000');
  t('normCat maps EC to E(C)', narsa.normCat('EC') === 'E(C)' && narsa.normCat('B') === 'B');
  t('esc escapes XSS', narsa.esc('<img src=x onerror=alert(1)>').includes('&lt;img') && !narsa.esc('<img src=x onerror=alert(1)>').includes('<img src'));

  const missingDb = completeDb({ firstName: '', lastName: '', name: 'X', cin: '', birthDate: '', address: '' });
  const miss = narsa.build(missingDb, 'c1', { type: 'demande' });
  t('incomplete demande is not ok', miss.ok === false && miss.error === 'missing_fields' && miss.missing.some(m => m.key === 'cand_cin'));
  t('missing labels have AR/FR/EN', miss.missing.every(m => m.ar && m.fr && m.en));

  const okC = narsa.build(completeDb(), 'c1', { type: 'contrat', copies: 3 });
  t('complete contrat builds 3 copies', !!(okC.ok && okC.copies === 3 && /data-narsa-copy="1"/.test(okC.html) && /data-narsa-copy="3"/.test(okC.html)));
  t('contrat has official title and 3-originals wording', /نموذج عقد التكوين بين المرشح ومؤسسة تعليم السياقة/.test(okC.html) && /عقد محرر في ثلاثة نظائر أصلية/.test(okC.html));
  t('contrat fills school, CIN, hours, category', /Auto Ecole Demo/.test(okC.html) && /AB12345/.test(okC.html) && /data-narsa-field="codeHours"/.test(okC.html) && />B</.test(okC.html) || /«<span class="fill" data-narsa-field="license">B<\/span>»/.test(okC.html));
  t('contrat copy tags in Arabic', /النظير الأصلي رقم 1 من 3/.test(okC.html) && /النظير الأصلي رقم 3 من 3/.test(okC.html));

  const xss = narsa.build(completeDb({ name: '<img src=x onerror=alert(1)>', firstName: '<img src=x onerror=alert(1)>', lastName: 'Alami' }), 'c1', { type: 'contrat', copies: 1 });
  t('contrat HTML escapes XSS in names', xss.ok && xss.html.includes('&lt;img src=x') && !xss.html.includes('<img src=x onerror'));

  const okD = narsa.build(completeDb(), 'c1', { type: 'demande' });
  t('demande has Royaume / NARSA headers', !!(okD.ok && /ROYAUME DU MAROC/.test(okD.html) && /Agence Nationale de la Sécurité Routière/.test(okD.html) && /الوكالة الوطنية للسلامة الطرقية/.test(okD.html)));
  t('demande is for the first time by default', okD.ok && okD.html.includes('aria-checked="true"') && /لأول مرة/.test(okD.html));
  t('demande shows category B', okD.ok && /data-narsa-field="license">B</.test(okD.html));

  const ext = narsa.build(completeDb({ examKind: 'extension' }), 'c1', { type: 'demande', overrides: { examKind: 'extension' } });
  t('extension without permit number is rejected', ext.ok === false && ext.missing.some(m => m.key === 'permit_no'));

  const okA = narsa.build(completeDb(), 'c1', { type: 'attestation' });
  t('attestation builds and names both instructors + plate', !!(okA.ok && /شهادة نهاية التكوين في تعليم السياقة/.test(okA.html) && /Karim Monitor/.test(okA.html) && /M-111/.test(okA.html) && /Sara Monitor/.test(okA.html) && /12345-A-6/.test(okA.html) && /WEB-778899/.test(okA.html)));

  t('unknown type is bad_type', narsa.build(completeDb(), 'c1', { type: 'livret' }).error === 'bad_type');
  t('unknown candidate is candidate_not_found', narsa.build(completeDb(), 'nope', { type: 'contrat' }).error === 'candidate_not_found');
}

function startServer(dir, extraEnv) {
  const env = Object.assign({}, process.env, {
    DATA_DIR: dir, DB_FILE: path.join(dir, 'otoqol.sqlite'),
    JWT_SECRET: 'narsa-test-secret', NODE_ENV: 'test',
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

async function apiTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-narsa-'));
  const PORT = Number(process.env.NARSA_PORT || 4340);
  const B = 'http://127.0.0.1:' + PORT;
  const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
  const srv = startServer(dir, { PORT: String(PORT) });
  t('api server starts', await waitUp(B), srv.logs());
  try {
    const noAuth = await fetch(B + '/api/narsa/docs?cid=c1&type=contrat', { headers: H });
    t('unauth GET /api/narsa/docs -> 401', noAuth.status === 401);

    const login = await fetch(B + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
    let ck = (login.headers.get('set-cookie') || '').split(';')[0];
    const cur = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    const put = await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data: completeDb() }) });
    t('seed complete school data', put.status === 200, await put.text().then(s => s.slice(0, 200)));

    const si = async (u, p) => {
      const r = await fetch(B + '/api/signin', { method: 'POST', headers: H, body: JSON.stringify({ username: u, password: p }) });
      return { s: r.status, ck: (r.headers.get('set-cookie') || '').split(';')[0] };
    };
    const mgr = await si('admin', 'MgrPass1');
    const sec = await si('secretary', 'SecPass1');
    const mon = await si('karim', 'MonPass1');
    t('manager/secretary/monitor can sign in', mgr.s === 200 && sec.s === 200 && mon.s === 200);

    const monR = await fetch(B + '/api/narsa/docs?cid=c1&type=contrat', { headers: { ...H, Cookie: mon.ck } });
    t('monitor is forbidden', monR.status === 403);

    const bad = await fetch(B + '/api/narsa/docs?cid=c1&type=livret', { headers: { ...H, Cookie: mgr.ck } });
    t('bad type -> 400', bad.status === 400);

    const nf = await fetch(B + '/api/narsa/docs?cid=nope&type=contrat', { headers: { ...H, Cookie: mgr.ck } });
    t('unknown candidate -> 404', nf.status === 404);

    const ok = await fetch(B + '/api/narsa/docs?cid=c1&type=contrat&copies=3', { headers: { ...H, Cookie: mgr.ck } });
    const oj = await ok.json();
    t('manager contrat -> 200 + 3 copies', ok.status === 200 && oj.ok === true && oj.copies === 3 && /النظير الأصلي رقم 3/.test(oj.html));

    const secOk = await fetch(B + '/api/narsa/docs?cid=c1&type=demande', { headers: { ...H, Cookie: sec.ck } });
    const sj = await secOk.json();
    t('secretary demande -> 200 + NARSA header', secOk.status === 200 && sj.ok && /ROYAUME DU MAROC/.test(sj.html));

    const att = await fetch(B + '/api/narsa/docs?cid=c1&type=attestation&format=html', { headers: { ...H, Cookie: mgr.ck } });
    const html = await att.text();
    t('format=html returns HTML attestation', att.status === 200 && /شهادة نهاية التكوين/.test(html) && /Karim Monitor/.test(html));

    // incomplete school: strip required school fields via a new put? settings can only be changed as manager.
    const cur2 = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: mgr.ck } })).json();
    const incomplete = completeDb({ cin: '', birthDate: '' });
    const put2 = await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: mgr.ck }, body: JSON.stringify({ version: cur2.version, data: incomplete }) });
    t('update to incomplete data', put2.status === 200);
    const miss = await fetch(B + '/api/narsa/docs?cid=c1&type=demande', { headers: { ...H, Cookie: mgr.ck } });
    const mj = await miss.json();
    t('incomplete demande -> 422 missing_fields', miss.status === 422 && mj.error === 'missing_fields' && (mj.missing || []).some(m => m.key === 'cand_cin'));
  } finally {
    kill(srv);
  }
}

async function uiTests() {
  let pw;
  try { pw = require('playwright-core'); } catch (e) { pw = require('/tmp/pw/node_modules/playwright-core'); }
  const OUT = process.env.NARSA_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'narsa');
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-narsa-ui-'));
  const PORT = Number(process.env.NARSA_UI_PORT || 4342);
  const B = 'http://127.0.0.1:' + PORT;
  const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
  const srv = startServer(dir, { PORT: String(PORT) });
  t('ui server starts', await waitUp(B), srv.logs());
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const login = await fetch(B + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
    const ck = (login.headers.get('set-cookie') || '').split(';')[0];
    const cur = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    const partial = completeDb({ cin: '', birthDate: '', birthPlace: '', address: '' });
    await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data: partial }) });

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
    await page.goto(B + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    await page.fill('[data-oq-signin] input[name=username]', 'admin');
    await page.fill('[data-oq-signin] input[name=password]', 'MgrPass1');
    await page.click('[data-oq-signin] button.b.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
    await page.getByText('المترشحون', { exact: false }).first().click();
    await page.waitForTimeout(300);
    await page.getByText('Youssef Alami', { exact: false }).first().click();
    await page.waitForSelector('[data-oq-narsa-open]', { timeout: 10000 });
    t('manager sees Print documents on the student record', true);
    await page.click('[data-oq-narsa-open]');
    await page.waitForSelector('[data-oq-narsa-modal]', { timeout: 10000 });
    t('chooser modal opens in MSA', (await page.locator('[data-oq-narsa-modal]').innerText()).includes('اختر الوثيقة'));
    await page.click('[data-oq-narsa-print]');
    await page.waitForSelector('[data-oq-narsa-missing]', { timeout: 10000 });
    const missText = await page.locator('[data-oq-narsa-missing]').innerText();
    t('validation lists missing legal fields before print', /تعذر الطباعة: بيانات ناقصة/.test(missText) && /رقم البطاقة/.test(missText));
    await page.locator('[data-oq-narsa-modal]').screenshot({ path: path.join(OUT, 'narsa-missing-ar.png') });

    await page.goto(B + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByText('الإعدادات', { exact: false }).first().click();
    await page.waitForSelector('[data-oq-narsa-school]', { timeout: 10000 });
    t('manager sees NARSA school settings card', true);
    await page.locator('[data-oq-narsa-school]').screenshot({ path: path.join(OUT, 'narsa-settings-ar.png') });

    // complete data and print a popup
    const cur2 = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur2.version, data: completeDb() }) });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('المترشحون', { exact: false }).first().click();
    await page.getByText('Youssef Alami', { exact: false }).first().click();
    await page.click('[data-oq-narsa-open]');
    await page.waitForSelector('[data-oq-narsa-modal]');
    const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
    await page.click('[data-oq-narsa-print]');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    const body = await popup.content();
    t('print window is a 3-copy contrat', /النظير الأصلي رقم 3 من 3/.test(body) && /نموذج عقد التكوين/.test(body) && /Youssef/.test(body));
    await popup.screenshot({ path: path.join(OUT, 'narsa-contrat-ar.png'), fullPage: false });
    await popup.close();
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv);
  }
}

(async () => {
  unitTests();
  await apiTests();
  await uiTests();
  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
