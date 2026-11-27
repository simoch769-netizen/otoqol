// Official livret + enrolment registre: unit + API + Playwright.
// node scripts/official-docs-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const docs = require('../src/docs');

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
    JWT_SECRET: 'docs-test-secret-32chars-xxxxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4460)
  }, extraEnv || {});
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '';
  srv.stdout.on('data', d => { out += d; });
  srv.stderr.on('data', d => { out += d; });
  srv.logs = () => out.slice(-2500);
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
  const r = await fetch(base + url, {
    method,
    headers: { ...H, Cookie: cookie || '' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = Buffer.from(await r.arrayBuffer());
  let j = null;
  try { j = JSON.parse(raw.toString('utf8')); } catch (e) {}
  return { s: r.status, j, raw, cookie: cookieOf(r) || cookie, headers: r.headers, text: raw.toString('utf8') };
}

function seed() {
  return {
    settings: {
      school: 'مدرسة النور', address: 'زنقة الحسن الثاني، الدار البيضاء',
      phone: '0522000000', city: 'الدار البيضاء', licenseNo: 'AE-99', nationalRegNo: 'NR-12',
    },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' },
    ],
    monitors: [
      { id: 'm1', name: 'Karim Monitor', phone: '0611111111', username: 'karim', password: 'MonPass1', licenseNo: 'MON-7' },
      { id: 'm2', name: 'Other Monitor', phone: '0622222222', username: 'other', password: 'MonPass2', licenseNo: 'MON-8' },
    ],
    vehicles: [{ id: 'v1', plate: 'A-12345' }],
    candidates: [
      {
        id: 'c1', name: 'Youssef Alami', firstName: 'Youssef', lastName: 'Alami',
        cin: 'AB12345', phone: '0600000001', address: 'حي السلام', nationality: 'مغربية',
        birthDate: '2004-05-12', birthPlace: 'الدار البيضاء', license: 'B',
        price: 3500, codeHours: 20, driveHours: 20, stage: 'drive', medical: true,
        narsaRef: 'WEB-100', contractNo: 'C-100', contractDate: '2026-01-15',
        createdAt: '2026-01-16T10:00:00', monitorId: 'm1',
        exams: [{ id: 'e1', type: 'code', date: '2026-04-01', result: 'نجح' }],
      },
      {
        id: 'c2', name: 'Sara Benali', cin: 'CD67890', phone: '0600000002', license: 'B',
        price: 3500, codeHours: 20, driveHours: 20, stage: 'reg', medical: false,
        createdAt: '2026-03-01T09:00:00', exams: [],
      },
      {
        id: 'c3', name: 'Omar Tazi', cin: 'EF11111', phone: '0600000003', license: 'B',
        price: 3500, codeHours: 20, driveHours: 20, stage: 'done', medical: true,
        contractNo: 'C-300', contractDate: '2026-02-10', createdAt: '2026-02-10',
        permitNo: '', exams: [
          { id: 'e2', type: 'code', date: '2026-05-01', result: 'رسب' },
          { id: 'e3', type: 'code', date: '2026-05-20', result: 'نجح' },
          { id: 'e4', type: 'conduite', date: '2026-06-15', result: 'نجح' },
        ],
      },
    ],
    sessions: [
      { id: 's1', date: '2026-02-01', time: '09:00', duration: 2, type: 'code', monitorId: 'm1', vehicleId: '', notes: 'درس الأولوية', att: [{ cid: 'c1', status: 'present' }] },
      { id: 's2', date: '2026-02-08', time: '10:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c1', status: 'present' }] },
      { id: 's3', date: '2026-02-15', time: '10:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c1', status: 'late' }] },
      { id: 's4', date: '2026-02-22', time: '10:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c1', status: 'absent', reason: 'مرض' }] },
      { id: 's5', date: '2026-03-10', time: '14:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c3', status: 'present' }] },
    ],
    payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [
      { id: 'l1', date: new Date().toISOString(), user: 'admin', text: 'تجربة سجل العمليات' },
    ],
  };
}

(async () => {
  // ---------- unit ----------
  const data = seed();
  t('enrolment prefers contractDate over createdAt', docs.enrolmentDate(data.candidates[0]) === '2026-01-15');
  t('enrolment falls back to createdAt day', docs.enrolmentDate(data.candidates[1]) === '2026-03-01');

  const countedCode = docs.hoursDone(data, 'c1', 'code');
  const countedDrive = docs.hoursDone(data, 'c1', 'conduite');
  t('hours count present and late only', countedCode === 2 && countedDrive === 2, 'code=' + countedCode + ' drive=' + countedDrive);

  t('training end derived from passed driving exam when stage is done', docs.trainingEndDate(data.candidates[2], data) === '2026-06-15');
  t('training end empty while training is open', docs.trainingEndDate(data.candidates[0], data) === '');

  const all = docs.buildRegistre(data, {}, 'ar');
  t('registre lists all three candidates', all.total === 3 && all.totalAll === 3);
  const orders = all.rows.map(r => r.name + ':' + r.order + ':' + r.enrolmentDate);
  t('registre chronological order with stable numbers',
    all.rows[0].id === 'c1' && all.rows[0].order === 1 &&
    all.rows[1].id === 'c3' && all.rows[1].order === 2 &&
    all.rows[2].id === 'c2' && all.rows[2].order === 3,
    orders.join(' | '));

  const mid = docs.buildRegistre(data, { from: '2026-02-01', to: '2026-02-28' }, 'ar');
  t('date filter keeps original order number', mid.total === 1 && mid.rows[0].id === 'c3' && mid.rows[0].order === 2, JSON.stringify(mid.rows.map(r => [r.id, r.order])));

  t('art.22 identity and contract fields are present',
    all.rows[0].cin === 'AB12345' && all.rows[0].birthDate === '2004-05-12' &&
    all.rows[0].narsaRef === 'WEB-100' && all.rows[0].contractRef.indexOf('C-100') !== -1 &&
    all.rows[0].hours.totalPlanned === 40 && all.rows[0].license === 'B' &&
    all.rows[0].address === 'حي السلام');

  t('exam results appear on the registre', /نجح/.test(all.rows[0].examsText) && /رسب/.test(all.rows[1].examsText));
  const frReg = docs.buildRegistre(data, {}, 'fr');
  t('French registre joins exams with a Latin semicolon',
    frReg.rows[1].examsText.indexOf('; ') !== -1 && frReg.rows.every(r => r.examsText.indexOf('؛') === -1));

  const liv = docs.buildLivret(data, 'c1', 'ar');
  t('livret hours and session journal',
    !liv.error && liv.sessions.length === 4 && liv.candidate.hours.codeDone === 2 &&
    liv.candidate.hours.driveDone === 2 && liv.sessions.some(s => s.vehiclePlate === 'A-12345') &&
    liv.sessions.some(s => s.remarks.indexOf('مرض') !== -1) &&
    liv.exams.length === 1,
    JSON.stringify(liv.candidate && liv.candidate.hours));
  t('livret has no price field', !('price' in liv.candidate) && JSON.stringify(liv).indexOf('3500') === -1);

  const html = docs.renderLivretHtml(liv, 'ar');
  t('livret html is rtl and has signature lines',
    html.indexOf('dir="rtl"') !== -1 && html.indexOf('توقيع المرشح') !== -1 &&
    html.indexOf('Youssef Alami') !== -1 && html.indexOf('271-13') !== -1 &&
    html.indexOf('3500') === -1);

  const rh = docs.renderRegistreHtml(all, 'fr');
  t('registre html can be French and landscape',
    rh.indexOf('lang="fr"') !== -1 && rh.indexOf('landscape') !== -1 &&
    rh.indexOf('Registre des candidats inscrits') !== -1);

  const csv = docs.buildRegistreCsv(all, 'ar');
  t('csv has utf-8 BOM and Youssef',
    csv.buffer[0] === 0xEF && csv.buffer[1] === 0xBB && csv.buffer[2] === 0xBF &&
    csv.buffer.toString('utf8').indexOf('Youssef Alami') !== -1);

  const xlsx = docs.buildRegistreXlsx(all, 'ar');
  t('xlsx is a zip store package',
    xlsx.buffer.slice(0, 2).toString() === 'PK' && xlsx.buffer.length > 200);

  t('monitor can read assigned or taught student only',
    docs.canReadLivret({ role: 'monitor', id: 'm1' }, data, 'c1') === true &&
    docs.canReadLivret({ role: 'monitor', id: 'm1' }, data, 'c3') === true &&
    docs.canReadLivret({ role: 'monitor', id: 'm1' }, data, 'c2') === false);
  t('student can read only own livret',
    docs.canReadLivret({ role: 'student', cid: 'c1' }, data, 'c1') === true &&
    docs.canReadLivret({ role: 'student', cid: 'c1' }, data, 'c2') === false);
  t('owner and office staff can read any livret',
    docs.canReadLivret({ role: 'owner' }, data, 'c1') === true &&
    docs.canReadLivret({ role: 'manager' }, data, 'c2') === true &&
    docs.canReadLivret({ role: 'secretary' }, data, 'c2') === true);

  const swapped = docs.parsePeriod({ from: '2026-03-01', to: '2026-01-01' });
  t('period from/to is swapped when reversed', swapped.from === '2026-01-01' && swapped.to === '2026-03-01');
  t('bad period is rejected', docs.parsePeriod({ from: 'nope' }).error === 'bad_request');

  // ---------- API + Playwright ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-docs-'));
  const PORT = 4460;
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT), PUBLIC_URL: B });
  try {
    const up = await waitUp(B);
    t('test server is up', up, srv.logs());
    if (!up) throw new Error('server down');

    const boot = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'SchoolPw2026!' });
    t('seed admin signs in', boot.s === 200, 'status=' + boot.s + ' ' + srv.logs());
    const cur = await req(B, 'GET', '/api/db', undefined, boot.cookie);
    const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seed() }, boot.cookie);
    t('seed data saved', put.s === 200, 'status=' + put.s + ' ' + JSON.stringify(put.j));

    const mgr = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
    const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
    const mon = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
    t('staff accounts sign in', mgr.s === 200 && sec.s === 200 && mon.s === 200, [mgr.s, sec.s, mon.s].join(','));

    const anon = await req(B, 'GET', '/api/docs/registre');
    t('registre requires login', anon.s === 401);

    const regSec = await req(B, 'GET', '/api/docs/registre', undefined, sec.cookie);
    t('secretary can read registre', regSec.s === 200 && regSec.j.total === 3, 'status=' + regSec.s);

    const regMon = await req(B, 'GET', '/api/docs/registre', undefined, mon.cookie);
    t('monitor cannot read registre', regMon.s === 403);

    const filt = await req(B, 'GET', '/api/docs/registre?from=2026-02-01&to=2026-02-28', undefined, mgr.cookie);
    t('API date filter keeps order 2 for Omar', filt.s === 200 && filt.j.total === 1 && filt.j.rows[0].order === 2);

    const bad = await req(B, 'GET', '/api/docs/registre?from=13-13-13', undefined, mgr.cookie);
    t('bad date is 400', bad.s === 400);

    const livMgr = await req(B, 'GET', '/api/docs/livret/c1', undefined, mgr.cookie);
    t('manager livret json', livMgr.s === 200 && livMgr.j.candidate.name === 'Youssef Alami' && livMgr.j.sessions.length === 4);

    const livMonOk = await req(B, 'GET', '/api/docs/livret/c1', undefined, mon.cookie);
    const livMonTaught = await req(B, 'GET', '/api/docs/livret/c3', undefined, mon.cookie);
    const livMonNo = await req(B, 'GET', '/api/docs/livret/c2', undefined, mon.cookie);
    t('monitor livret only for assigned or taught students',
      livMonOk.s === 200 && livMonTaught.s === 200 && livMonNo.s === 403,
      [livMonOk.s, livMonTaught.s, livMonNo.s].join(','));

    const missing = await req(B, 'GET', '/api/docs/livret/nope', undefined, mgr.cookie);
    t('unknown candidate is 404', missing.s === 404);

    const printLiv = await req(B, 'GET', '/api/docs/livret/c1/print?lang=ar', undefined, sec.cookie);
    t('livret print html', printLiv.s === 200 && printLiv.headers.get('content-type').indexOf('html') !== -1 && printLiv.text.indexOf('كناش') !== -1 && printLiv.text.indexOf('3500') === -1);

    const printReg = await req(B, 'GET', '/api/docs/registre/print?lang=fr', undefined, sec.cookie);
    t('registre print html in French', printReg.s === 200 && printReg.text.indexOf('Registre des candidats inscrits') !== -1);

    const csvApi = await req(B, 'GET', '/api/docs/registre/export?format=csv&lang=ar', undefined, sec.cookie);
    t('csv export has BOM and attachment',
      csvApi.s === 200 && csvApi.raw[0] === 0xEF && /attachment/.test(csvApi.headers.get('content-disposition') || '') &&
      csvApi.text.indexOf('Youssef Alami') !== -1);

    const xlsxApi = await req(B, 'GET', '/api/docs/registre/export?format=xlsx', undefined, sec.cookie);
    t('xlsx export is a zip', xlsxApi.s === 200 && xlsxApi.raw.slice(0, 2).toString() === 'PK');

    const inv = await req(B, 'POST', '/api/portal/invite', { cid: 'c1' }, mgr.cookie);
    t('portal invite created', inv.s === 200 && inv.j && inv.j.url, JSON.stringify(inv.j));
    const tok = inv.j && inv.j.url && (new URL(inv.j.url, B).searchParams.get('token') || '');
    const act = await req(B, 'POST', '/api/portal/activate', { token: tok, password: 'StudPass1', consent: true });
    t('portal student activated', act.s === 200, 'status=' + act.s + ' ' + JSON.stringify(act.j));
    const stuUser = (act.j && act.j.user && act.j.user.username) || (inv.j && inv.j.username);
    const stu = await req(B, 'POST', '/api/signin', { username: stuUser, password: 'StudPass1' });
    t('student signs in', stu.s === 200 && stu.j && stu.j.user && stu.j.user.role === 'student', 'status=' + stu.s + ' user=' + stuUser);

    const stuLiv = await req(B, 'GET', '/api/portal/livret', undefined, stu.cookie);
    t('student portal livret is own booklet', stuLiv.s === 200 && stuLiv.j.candidate && stuLiv.j.candidate.id === 'c1');
    const stuOther = await req(B, 'GET', '/api/docs/livret/c2', undefined, stu.cookie);
    t('student cannot read another livret', stuOther.s === 403);
    const stuReg = await req(B, 'GET', '/api/docs/registre', undefined, stu.cookie);
    t('student cannot read registre', stuReg.s === 403);
    const stuPrint = await req(B, 'GET', '/api/portal/livret/print?lang=ar', undefined, stu.cookie);
    t('student print livret html', stuPrint.s === 200 && stuPrint.text.indexOf('Youssef Alami') !== -1);

    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public/app/index.html'), 'utf8');
    t('activity log card removed from settings UI', appSrc.indexOf('db.log.slice(0,50)') === -1 && appSrc.indexOf('<h3>{_t("سجل العمليات (آخر 50)")}</h3>') === -1);
    t('server-side activity log helper still present', /function L\(|const L=|\.log\.push|db\.log/.test(appSrc));

    const browser = await pw.chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ locale: 'ar' });
    try {
      await page.goto(B + '/app', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-oq-signin] input[name=username], input[name=username]', { timeout: 20000 });
      await page.fill('input[name=username]', 'admin');
      await page.fill('input[name=password]', 'MgrPass1');
      await page.click('button.b.pri');
      await page.waitForSelector('nav, #oq-nav, [data-oq-nav], .nav', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      const navHasReg = await page.getByText('سجل التسجيل', { exact: false }).count();
      t('staff nav shows the enrolment register', navHasReg > 0, 'count=' + navHasReg);
      const tab = page.locator('button:has-text("سجل التسجيل")').first();
      if (await tab.count()) await tab.click();
      await page.waitForSelector('[data-oq-registre]', { timeout: 10000 });
      const bodyTxt = await page.locator('[data-oq-registre]').innerText();
      t('registre page lists Youssef and Omar', /Youssef Alami/.test(bodyTxt) && /Omar Tazi/.test(bodyTxt));

      const settingsBtn = page.locator('button:has-text("الإعدادات")').first();
      if (await settingsBtn.count()) await settingsBtn.click();
      await page.waitForTimeout(500);
      const visibleLog = await page.locator('h3', { hasText: 'سجل العمليات' }).count();
      t('settings no longer shows the activity log card', visibleLog === 0, 'count=' + visibleLog);
    } finally {
      await browser.close();
    }
  } catch (e) {
    t('suite did not throw', false, (e && e.stack) || String(e));
  } finally {
    kill(srv);
  }

  console.log(fails ? ('FAILED ' + fails) : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
