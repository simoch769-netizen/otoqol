// Signup, owner approval, and multi-school login tests. Starts its own server + temp DB + capture mail.
// node scripts/signup-approval-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.SU_PORT || 4400), B = 'http://127.0.0.1:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-su-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN = crypto.randomBytes(24).toString('hex');
const OWNER = crypto.randomBytes(24).toString('hex');
const CAPTURE = path.join(DIR, 'mail-capture.jsonl');
const SCHOOL_PW = 'SchoolPw2026!';
const SHOTS = path.join(__dirname, '..', 'test-shots', 'signup');
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
async function req(m, u, body, h = {}, ck = '') {
  const r = await fetch(B + u, {
    method: m,
    headers: { ...H, ...(ck ? { Cookie: ck } : {}), ...h },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = r.headers.get('set-cookie') || '';
  let j = null; try { j = await r.json(); } catch (e) {}
  const pick = name => {
    const m = sc.match(new RegExp(name + '=([^;]+)'));
    return m && m[1] && m[1] !== '' ? name + '=' + m[1] : '';
  };
  return { s: r.status, j, sc, ck: pick('otq_sess'), owner: pick('otq_owner') };
}

function readCapture() {
  if (!fs.existsSync(CAPTURE)) return [];
  return fs.readFileSync(CAPTURE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
async function waitForMail(prevLen, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const all = readCapture();
    if (all.length > prevLen) return all[all.length - 1];
    await new Promise(r => setTimeout(r, 20));
  }
  return readCapture()[readCapture().length - 1] || null;
}
function mailHas(mail, re) { return mail && (re.test(mail.text || '') || re.test(mail.html || '') || re.test(mail.subject || '')); }
function mailLacksPassword(mail, pw) {
  const blob = JSON.stringify(mail || {});
  return !pw || !blob.includes(pw);
}

function startServer(extra = {}) {
  return spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: DIR,
      DB_FILE: path.join(DIR, 'otoqol.sqlite'),
      JWT_SECRET: SECRET,
      ADMIN_TOKEN: ADMIN,
      OWNER_USERNAME: 'otoqol',
      OWNER_PASSWORD: OWNER,
      COOKIE_SECURE: 'false',
      PUBLIC_URL: B,
      SEED_SCHOOL_CODE: 'demo',
      SEED_SCHOOL_NAME: 'Otoqol Demo',
      SEED_SCHOOL_PASSWORD: SCHOOL_PW,
      DEFAULT_SCHOOL_CODE: 'demo',
      BREVO_API_KEY: '',
      SMTP_HOST: 'capture',
      SMTP_CAPTURE_FILE: CAPTURE,
      MAIL_FROM: 'Otoqol <contact.otoqol@gmail.com>',
      OWNER_EMAIL: 'contact.otoqol@gmail.com',
      LOGIN_PER_15MIN: '1000',
      LOGIN_PER_ACCOUNT_15MIN: '1000',
      SIGNUP_PER_15MIN: '1000',
      OWNER_LOGIN_PER_15MIN: '1000',
      ...extra,
    },
  });
}

async function waitUp(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(B + '/healthz')).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

const signupBody = (over = {}) => ({
  name: 'مدرسة الأمل',
  city: 'الدار البيضاء',
  managerName: 'أحمد بن علي',
  email: 'manager.amal@example.com',
  phone: '+212612345678',
  username: 'ahmad',
  password: 'AmalPass1',
  ...over,
});

(async () => {
  // --- unit: slug / code ---
  const storePath = path.join(__dirname, '..', 'src', 'db.js');
  // unit tests that don't need the live DB still go through the API below.

  const srv = startServer();
  let stderr = '';
  srv.stderr.on('data', d => { stderr += d; });
  try {
    await waitUp();
    t('healthz', (await (await fetch(B + '/healthz')).json()).ok === true);

    // pages
    const su = await fetch(B + '/signup');
    const suHtml = await su.text();
    t('GET /signup 200', su.status === 200 && /data-oq-signup/.test(suHtml));
    t('signup page has no pricing text', !/درهم|\bMAD\b|\bDH\b|\bprix\b|tarif|\bprices?\b|pricing/i.test(suHtml));
    const ow = await fetch(B + '/owner');
    t('GET /owner 200', ow.status === 200 && /data-oq-owner-login/.test(await ow.text()));

    // signup validation
    t('signup without header -> 403', (await req('POST', '/api/signup', signupBody(), { 'X-Otoqol': '' })).s === 403);
    t('signup missing name -> 400', (await req('POST', '/api/signup', signupBody({ name: '' }))).j?.error === 'invalid_name');
    t('signup bad email -> 400', (await req('POST', '/api/signup', signupBody({ email: 'not-an-email' }))).j?.error === 'invalid_email');
    t('signup short password -> 400', (await req('POST', '/api/signup', signupBody({ password: '123' }))).j?.error === 'weak_password');

    const before = readCapture().length;
    const created = await req('POST', '/api/signup', signupBody());
    t('signup creates pending school and returns code', created.s === 200 && created.j.ok === true && typeof created.j.code === 'string' && created.j.code.length >= 2, JSON.stringify(created.j));
    const code = created.j && created.j.code;
    t('auto code is valid slug (from Arabic name or school-N)', !!(code && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)));
    const notice = await waitForMail(before);
    t('owner is notified at contact.otoqol@gmail.com', !!(notice && notice.to === 'contact.otoqol@gmail.com'));
    t('owner email has school details and /owner link', !!(notice && mailHas(notice, /مدرسة الأمل/) && mailHas(notice, /\/owner/) && mailHas(notice, /أحمد بن علي/) && mailHas(notice, /manager\.amal@example\.com/)));
    t('owner email does not contain the client password', mailLacksPassword(notice, 'AmalPass1'));

    const dup = await req('POST', '/api/signup', signupBody({ email: 'manager.amal@example.com', username: 'ahmad2' }));
    t('duplicate contact email rejected', dup.s === 400 && dup.j.error === 'email_used');
    const dupUser = await req('POST', '/api/signup', signupBody({ email: 'other.amal@example.com', username: 'AHMAD', phone: '0612345679' }));
    t('duplicate username rejected (case-insensitive)', dupUser.s === 400 && dupUser.j.error === 'username_taken');

    const pendLogin = await req('POST', '/api/signin', { username: 'ahmad', password: 'AmalPass1' });
    t('pending school login -> 403 school_pending', pendLogin.s === 403 && pendLogin.j.error === 'school_pending', JSON.stringify(pendLogin.j));

    const demoSi = await req('POST', '/api/signin', { username: 'admin', password: SCHOOL_PW });
    t('demo school still works with admin + school password (fresh setup)', demoSi.s === 200 && demoSi.j.school.code === 'demo' && demoSi.j.setup === true, JSON.stringify(demoSi.j));
    // seed school has no in-app users yet — admin+school password is the setup path. Good.

    // owner auth
    t('owner schools without session -> 401', (await req('GET', '/api/owner/schools')).s === 401);
    t('owner login missing username -> 400', (await req('POST', '/api/owner/login', { password: OWNER })).s === 400);
    t('owner login wrong username -> 401', (await req('POST', '/api/owner/login', { username: 'not-the-owner', password: OWNER })).s === 401);
    t('owner login wrong password -> 401', (await req('POST', '/api/owner/login', { username: 'otoqol', password: 'nope-nope-nope-nope' })).s === 401);
    const ol = await req('POST', '/api/owner/login', { username: 'otoqol', password: OWNER });
    t('owner login with username + OWNER_PASSWORD -> cookie', ol.s === 200 && !!ol.owner && ol.j.user && ol.j.user.role === 'owner');
    const ock = ol.owner;
    const list = await req('GET', '/api/owner/schools', undefined, {}, ock);
    t('owner list includes pending school', list.s === 200 && (list.j.schools || []).some(s => s.code === code && s.status === 'pending' && s.contact_email === 'manager.amal@example.com'));
    t('owner list includes demo as active and hides secrets', list.s === 200 && (list.j.schools || []).some(s => s.code === 'demo' && s.status === 'active') && !JSON.stringify(list.j).includes(SCHOOL_PW) && !JSON.stringify(list.j).includes('licence_key'));
    const pendingRow = (list.j.schools || []).find(s => s.code === code);
    t('pending school has stats fields', !!(pendingRow && ['candidates','sessions','users','payments_total','created_at'].every(k => k in pendingRow) && pendingRow.candidates === 0 && pendingRow.users === 1));
    t('owner totals present', !!(list.j.totals && list.j.totals.schools >= 2 && list.j.totals.pending >= 1 && list.j.totals.active >= 1));

    const beforeAppr = readCapture().length;
    const appr = await req('POST', '/api/owner/schools/' + code + '/approve', {}, {}, ock);
    t('approve pending school -> active', appr.s === 200 && appr.j.school.status === 'active');
    const welcome = await waitForMail(beforeAppr);
    t('client approval email goes to the manager', !!(welcome && welcome.to === 'manager.amal@example.com'));
    t('approval email has username and /app link, no school code, no password', !!(welcome && mailHas(welcome, /ahmad/) && mailHas(welcome, /\/app/) && !mailHas(welcome, /رمز المدرسة/) && !mailHas(welcome, /Code de l.école/) && !mailHas(welcome, new RegExp('\\b'+code+'\\b')) && mailLacksPassword(welcome, 'AmalPass1')));

    const okLogin = await req('POST', '/api/signin', { username: 'ahmad', password: 'AmalPass1' });
    t('approved school signs in with its own manager', okLogin.s === 200 && okLogin.j.user.role === 'manager' && okLogin.j.school.code === code, JSON.stringify(okLogin.j));
    t('session cookie issued', !!okLogin.ck);
    const me = await req('GET', '/api/me', undefined, {}, okLogin.ck);
    t('session is isolated to the new school', me.s === 200 && me.j.school.code === code);

    // second school + forgot-password per school
    const b2 = signupBody({
      name: 'Auto Ecole Najah', city: 'Rabat', managerName: 'Sara Naji',
      email: 'sara.najah@example.com', phone: '0611223344', username: 'sara', password: 'NajahPass1',
    });
    const s2 = await req('POST', '/api/signup', b2);
    t('second school gets an auto code from its name', s2.s === 200 && s2.j.code === 'auto-ecole-najah');
    const code2 = s2.j.code;
    await req('POST', '/api/owner/schools/' + code2 + '/approve', {}, {}, ock);
    const fpBefore = readCapture().length;
    const fp = await req('POST', '/api/forgot-password', { username: 'sara' });
    t('forgot-password resolves school from username -> generic ok', fp.s === 200 && fp.j.ok === true);
    const fpMail = await waitForMail(fpBefore);
    t('reset email went to the second school manager only', !!(fpMail && fpMail.to === 'sara.najah@example.com'));
    const resetCode = (fpMail && String(fpMail.text || '').match(/(?:^|\n)(\d{6})(?:\n|$)/) || [])[1];
    t('reset email contains a 6-digit code', !!resetCode);
    const reset = await req('POST', '/api/reset-password', { username: 'sara', code: resetCode, password: 'NajahPass2' });
    t('reset-password resolves school from username', reset.s === 200 && reset.j.ok === true);
    t('new password works on that school', (await req('POST', '/api/signin', { username: 'sara', password: 'NajahPass2' })).s === 200);
    t('old password fails on that school', (await req('POST', '/api/signin', { username: 'sara', password: 'NajahPass1' })).s === 401);
    t('other school manager password unchanged', (await req('POST', '/api/signin', { username: 'ahmad', password: 'AmalPass1' })).s === 200);

    // reject + deactivate
    const s3 = await req('POST', '/api/signup', signupBody({
      name: 'Ecole Atlas', city: 'Fes', managerName: 'Omar', email: 'omar.atlas@example.com',
      phone: '0699887766', username: 'omar', password: 'AtlasPass1',
    }));
    t('third school signup ok', s3.s === 200 && s3.j.code === 'ecole-atlas');
    const rej = await req('POST', '/api/owner/schools/ecole-atlas/reject', {}, {}, ock);
    t('reject pending school', rej.s === 200 && rej.j.school.status === 'rejected');
    t('rejected login -> school_rejected', (await req('POST', '/api/signin', { username: 'omar', password: 'AtlasPass1' })).j?.error === 'school_rejected');

    const deact = await req('POST', '/api/owner/schools/' + code2 + '/deactivate', {}, {}, ock);
    t('deactivate an active school', deact.s === 200 && deact.j.school.status === 'inactive');
    t('deactivated login -> school_inactive', (await req('POST', '/api/signin', { username: 'sara', password: 'NajahPass2' })).j?.error === 'school_inactive');
    const act = await req('POST', '/api/owner/schools/' + code2 + '/activate', {}, {}, ock);
    t('activate a deactivated school', act.s === 200 && act.j.school.status === 'active');
    t('reactivated school can sign in', (await req('POST', '/api/signin', { username: 'sara', password: 'NajahPass2' })).s === 200);

    const added = await req('POST', '/api/owner/schools', { name: 'Ecole Manual', managerUsername: 'manal', managerPassword: 'ManualPw1' }, {}, ock);
    t('owner can add a school account', added.s === 200 && added.j.school && added.j.school.code === 'ecole-manual' && added.j.school.status === 'active', JSON.stringify(added.j));
    t('manually added school signs in', (await req('POST', '/api/signin', { username: 'manal', password: 'ManualPw1' })).s === 200 && (await req('POST', '/api/signin', { username: 'manal', password: 'ManualPw1' })).j.user.role === 'manager');
    t('add school rejects taken username', (await req('POST', '/api/owner/schools', { name: 'Ecole X2', managerUsername: 'Manal', managerPassword: 'ManualPw2' }, {}, ock)).j?.error === 'username_taken');

    const AH = { Authorization: 'Bearer ' + ADMIN };
    const staff = (un, pw) => ({ settings: { school: 'Dup', absLimit: 3 }, users: [{ id: 'u1', name: 'M', role: 'manager', username: un, password: pw }], monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [] });
    const d1 = await req('POST', '/api/admin/schools', { code: 'dup1', name: 'Dup One', password: 'DupSchool1!' }, AH);
    const d2 = await req('POST', '/api/admin/schools', { code: 'dup2', name: 'Dup Two', password: 'DupSchool2!' }, AH);
    t('admin can create fixture schools', d1.s === 200 && d2.s === 200);
    t('admin import same username different passwords', (await req('PUT', '/api/admin/schools/dup1/import', { data: staff('shareduser', 'DupPassA1') }, AH)).s === 200
      && (await req('PUT', '/api/admin/schools/dup2/import', { data: staff('shareduser', 'DupPassB1') }, AH)).s === 200);
    t('duplicate username: matching password picks the right school', (await req('POST', '/api/signin', { username: 'shareduser', password: 'DupPassB1' })).j?.school?.code === 'dup2');
    t('duplicate username: other password picks the other school', (await req('POST', '/api/signin', { username: 'shareduser', password: 'DupPassA1' })).j?.school?.code === 'dup1');
    t('duplicate username + same password is ambiguous', (await req('PUT', '/api/admin/schools/dup2/import', { data: staff('shareduser', 'DupPassA1') }, AH)).s === 200
      && (await req('POST', '/api/signin', { username: 'shareduser', password: 'DupPassA1' })).j?.error === 'ambiguous_login');

    const manalLogin = await req('POST', '/api/signin', { username: 'manal', password: 'ManualPw1' });
    const cur = await req('GET', '/api/db', undefined, {}, manalLogin.ck);
    const data = cur.j.data;
    data.monitors = [{ id: 'm9', name: 'X', username: 'sara', password: 'MonitorPw1' }];
    const takenPut = await req('PUT', '/api/db', { version: cur.j.version, data }, {}, manalLogin.ck);
    t('manager cannot add a monitor username used in another school', takenPut.s === 400 && takenPut.j.error === 'username_taken');

    const lo = await req('POST', '/api/owner/logout', {}, {}, ock);
    t('owner logout', lo.s === 200);
    t('owner session ended', (await req('GET', '/api/owner/schools', undefined, {}, ock)).s === 401);

    // --- UI screenshots ---
    let pw;
    try { pw = require('playwright-core'); } catch (e) {
      try { pw = require('/tmp/pw/node_modules/playwright-core'); } catch (e2) { pw = null; }
    }
    if (!pw) {
      t('playwright available for UI shots', false, 'skipped');
    } else {
      const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(B + '/signup'); await page.waitForSelector('[data-oq-signup]');
        await page.screenshot({ path: path.join(SHOTS, 'signup-ar.png'), fullPage: true });
        await page.selectOption('#lang', 'fr'); await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOTS, 'signup-fr.png'), fullPage: true });
        await page.selectOption('#lang', 'en'); await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOTS, 'signup-en.png'), fullPage: true });
        await page.selectOption('#lang', 'ar');
        await page.fill('input[name=name]', 'مدرسة النور');
        await page.fill('input[name=city]', 'طنجة');
        await page.fill('input[name=managerName]', 'يوسف العلمي');
        await page.fill('input[name=email]', 'youssef.nour@example.com');
        await page.fill('input[name=phone]', '0612340000');
        await page.fill('input[name=username]', 'youssef');
        await page.fill('input[name=password]', 'NourPass1');
        await page.fill('input[name=password2]', 'NourPass1');
        await page.click('button[type=submit]');
        await page.waitForSelector('[data-oq-signup-success]', { timeout: 10000 });
        t('signup UI shows awaiting-approval message and no school code', (await page.locator('[data-oq-signup-success]').count()) === 1 && (await page.locator('[data-oq-signup-code]').count()) === 0 && !/رمز مدرستك|ستحتاجه لتسجيل الدخول/.test(await page.locator('[data-oq-signup-success]').innerText()));
        await page.screenshot({ path: path.join(SHOTS, 'signup-success-ar.png'), fullPage: true });

        await page.goto(B + '/app'); await page.waitForSelector('[data-oq-signin]');
        t('login UI is username + password only, with signup link', (await page.locator('[data-oq-signin] input').count()) === 2 && (await page.locator('[data-oq-signin] [data-oq-school]').count()) === 0 && (await page.locator('[data-oq-signup-link]').count()) === 1);
        await page.fill('[data-oq-signin] input[name=username]', 'youssef');
        await page.fill('[data-oq-signin] input[name=password]', 'NourPass1');
        await page.click('[data-oq-signin] button.b.pri');
        await page.waitForSelector('[data-oq-signin] .al.bad', { timeout: 10000 });
        t('pending login UI shows awaiting approval (MSA)', /قيد المراجعة|بعد الموافقة/.test(await page.locator('[data-oq-signin] .al.bad').innerText()));
        await page.screenshot({ path: path.join(SHOTS, 'login-pending-ar.png'), fullPage: true });

        await page.goto(B + '/owner'); await page.waitForSelector('[data-oq-owner-login]');
        t('owner login UI has username and password', (await page.locator('[data-oq-owner-login] input[name=username]').count()) === 1 && (await page.locator('[data-oq-owner-login] input[name=password]').count()) === 1);
        await page.screenshot({ path: path.join(SHOTS, 'owner-login-ar.png'), fullPage: true });
        await page.fill('input[name=username]', 'otoqol');
        await page.fill('input[name=password]', OWNER);
        await page.click('#go');
        await page.waitForSelector('[data-oq-owner-list]', { timeout: 10000 });
        t('owner dashboard shows totals', (await page.locator('[data-oq-totals]').count()) === 1 && (await page.locator('[data-oq-total=schools]').count()) === 1);
        t('owner add-school form has no school-code field', (await page.locator('[data-oq-add-school] input[name=code]').count()) === 0);
        const nourCard = page.locator('.sch', { hasText: 'مدرسة النور' });
        t('owner UI lists the pending school', (await nourCard.count()) === 1 && (await nourCard.getAttribute('data-oq-status')) === 'pending');
        t('owner UI has add-school form', (await page.locator('[data-oq-add-school]').count()) === 1);
        await page.screenshot({ path: path.join(SHOTS, 'owner-list-ar.png'), fullPage: true });
        const nourCode = await nourCard.getAttribute('data-oq-school');
        await page.click('[data-oq-approve="'+nourCode+'"]');
        await page.waitForSelector('[data-oq-school="'+nourCode+'"][data-oq-status=active]', { timeout: 10000 });
        t('owner can approve from the UI', (await page.locator('[data-oq-school="'+nourCode+'"][data-oq-status=active]').count()) === 1);
        await page.screenshot({ path: path.join(SHOTS, 'owner-approved-ar.png'), fullPage: true });
      } finally { await browser.close(); }
    }
  } finally {
    srv.kill();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}
  }
  if (stderr && /error|Error/.test(stderr) && !/JWT_SECRET not set/.test(stderr)) {
    // keep a hint if the server crashed, without secrets
    console.log('server stderr (trimmed):', stderr.slice(0, 500).replace(OWNER, '***').replace(ADMIN, '***').replace(SECRET, '***'));
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
