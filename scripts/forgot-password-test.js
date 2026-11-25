// Email forgot-password tests with a capture SMTP stub. Starts its own server + temp DB.
// node scripts/forgot-password-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.FP_PORT || 4300), B = 'http://127.0.0.1:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-fp-'));
const SECRET = crypto.randomBytes(32).toString('hex'), ADMIN = crypto.randomBytes(24).toString('hex');
const CAPTURE = path.join(DIR, 'mail-capture.jsonl');
const SCHOOL_PW = 'SchoolPw2026!';
let fails = 0; const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
async function req(m, u, body, h = {}, ck = '') {
  const r = await fetch(B + u, {
    method: m,
    headers: { ...H, ...(ck ? { Cookie: ck } : {}), ...h },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = r.headers.get('set-cookie');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, sc, ck: sc && /otq_sess=[^;]+/.test(sc) && !/otq_sess=;/.test(sc) ? sc.split(';')[0] : '' };
}
const signin = (u, p, school) => req('POST', '/api/signin', school ? { school, username: u, password: p } : { username: u, password: p });
const forgot = (username, extra = {}, h = {}) => req('POST', '/api/forgot-password', { username, ...extra }, h);
const reset = (username, code, password, extra = {}) => req('POST', '/api/reset-password', { username, code, password, ...extra });

function readCapture() {
  if (!fs.existsSync(CAPTURE)) return [];
  return fs.readFileSync(CAPTURE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function lastMail() { const all = readCapture(); return all[all.length - 1] || null; }
async function waitForMail(prevLen, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const all = readCapture();
    if (all.length > prevLen) return all[all.length - 1];
    await new Promise(r => setTimeout(r, 20));
  }
  return lastMail();
}
async function settleNoMail(prevLen, ms = 150) {
  await new Promise(r => setTimeout(r, ms));
  return readCapture().length === prevLen;
}
function codeFrom(mail) {
  if (!mail) return null;
  const m = String(mail.text || '').match(/(?:^|\n)(\d{6})(?:\n|$)/);
  return m ? m[1] : null;
}

const seed = () => ({
  settings: { school: 'Otoqol Demo', absLimit: 3 },
  users: [
    { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'OldPass1', email: 'admin@example.com' },
    { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' },
  ],
  monitors: [{ id: 'm1', name: 'Karim', username: 'karim', password: 'MonPass1', email: 'karim@example.com' }],
  vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
});

function startServer(extraEnv = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: DIR,
    DB_FILE: path.join(DIR, 'otoqol.sqlite'),
    JWT_SECRET: SECRET,
    ADMIN_TOKEN: ADMIN,
    COOKIE_SECURE: 'false',
    SEED_SCHOOL_CODE: 'demo',
    SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: SCHOOL_PW,
    DEFAULT_SCHOOL_CODE: 'demo',
    BREVO_API_KEY: '',
    SMTP_HOST: 'capture',
    SMTP_PORT: '465',
    SMTP_USER: 'contact.otoqol@gmail.com',
    SMTP_PASS: 'test-capture',
    MAIL_FROM: 'Otoqol <contact.otoqol@gmail.com>',
    SMTP_CAPTURE_FILE: CAPTURE,
    FORGOT_PER_15MIN: '20',
    FORGOT_PER_ACCOUNT_15MIN: '10',
    RESET_PER_15MIN: '30',
    RESET_CODE_TTL_MS: '900000',
    RESET_MAX_ATTEMPTS: '5',
    ...extraEnv,
  };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
  srv.logs = () => out;
  return srv;
}

async function waitUp(ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(B + '/healthz')).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

function kill(srv) {
  return new Promise(resolve => {
    if (!srv || srv.killed) return resolve();
    srv.on('exit', () => resolve());
    srv.kill('SIGTERM');
    setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} }, 2000);
  });
}

(async () => {
  let srv = startServer();
  try {
    t('server starts', await waitUp(), srv.logs());
    // seed school data via admin login + PUT
    const lg = await req('POST', '/api/login', { school: 'demo', password: SCHOOL_PW });
    t('legacy school login still works', lg.s === 200 && !!lg.ck);
    const cur = await req('GET', '/api/db', undefined, {}, lg.ck);
    const put = await req('PUT', '/api/db', { version: cur.j.version, data: seed() }, {}, lg.ck);
    t('seed users/monitors with emails', put.s === 200);
    await req('POST', '/api/logout', {}, {}, lg.ck);

    t('existing signin (admin / OldPass1) still works', (await signin('admin', 'OldPass1')).s === 200);
    await req('POST', '/api/logout', {});

    t('forgot-password without X-Otoqol -> 403', (await forgot('admin', {}, { 'X-Otoqol': '' })).s === 403);
    t('forgot-password missing username -> 400', (await forgot('')).s === 400);

    const before = readCapture().length;
    const unk = await forgot('no-such-user');
    t('unknown username -> generic 200 {ok:true}', unk.s === 200 && unk.j && unk.j.ok === true && !('email' in (unk.j || {})) && !('code' in (unk.j || {})));
    t('unknown username does not send mail', await settleNoMail(before));

    const noem = await forgot('secretary');
    t('account without email -> generic 200, no mail', noem.s === 200 && noem.j.ok === true && await settleNoMail(before));

    const fp = await forgot('admin');
    t('known username+email -> generic 200 (no code in body)', fp.s === 200 && fp.j.ok === true && !JSON.stringify(fp.j).includes('@') && !/\d{6}/.test(JSON.stringify(fp.j)));
    const mail1 = await waitForMail(before);
    const code1 = codeFrom(mail1);
    t('capture transport received a bilingual branded email', !!(mail1 && code1 && mail1.to === 'admin@example.com'
      && /فريق Otoqol/.test(mail1.text) && /Réinitialisation/.test(mail1.text)
      && /\+212 716-396333/.test(mail1.text) && /@otoqol_officiel/.test(mail1.text)
      && /contact\.otoqol@gmail.com/.test(mail1.text)
      && /إدارة مدارس السياقة/.test(mail1.html) && mail1.subject.includes('Otoqol')
      && !/درهم|\bMAD\b|\bDH\b|prix|tarif|pricing/i.test(mail1.text + mail1.html)));
    t('code is 6 digits and only in the email', /^\d{6}$/.test(code1 || ''));

    t('wrong code -> 400 invalid_code, old password still works', (await reset('admin', '000000', 'NewPass9')).s === 400
      && (await signin('admin', 'OldPass1')).s === 200);

    const badShape = await reset('admin', '12', 'NewPass9');
    t('malformed code -> 400', badShape.s === 400);

    const weak = await reset('admin', code1, 'abc');
    t('short password -> 400 weak_password, code still valid', weak.s === 400 && weak.j.error === 'weak_password');

    const ok = await reset('admin', code1, 'NewPass9');
    t('valid code + new password -> 200', ok.s === 200 && ok.j.ok === true);
    t('login with new password works', (await signin('admin', 'NewPass9')).s === 200);
    t('login with old password fails', (await signin('admin', 'OldPass1')).s === 401);
    t('same code cannot be reused', (await reset('admin', code1, 'OtherPass')).s === 400);
    t('other accounts unchanged (secretary still signs in)', (await signin('secretary', 'SecPass1')).s === 200);

    // monitor reset
    const beforeM = readCapture().length;
    const fm = await forgot('karim');
    const mailM = await waitForMail(beforeM);
    const codeM = codeFrom(mailM);
    t('monitor request sends mail to monitor email', fm.s === 200 && mailM && mailM.to === 'karim@example.com' && !!codeM);
    t('Arabic-Indic digits accepted for the code', (await reset('karim', codeM.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]), 'MonPass2')).s === 200);
    t('monitor logs in with new password', (await signin('karim', 'MonPass2')).s === 200);
    t('monitor old password fails', (await signin('karim', 'MonPass1')).s === 401);

    // 5 attempts then lock
    const beforeLock = readCapture().length;
    await forgot('admin');
    const codeLock = codeFrom(await waitForMail(beforeLock));
    let lastAttempt;
    for (let i = 0; i < 5; i++) lastAttempt = await reset('admin', '111111', 'Whatever1');
    t('5 wrong attempts return invalid_code', lastAttempt.s === 400 && lastAttempt.j.error === 'invalid_code');
    t('correct code fails after 5 attempts', (await reset('admin', codeLock, 'Whatever1')).s === 400);
    t('password unchanged after locked attempts', (await signin('admin', 'NewPass9')).s === 200);

    // email field saved / rejected
    const a2 = await signin('admin', 'NewPass9');
    const db2 = await req('GET', '/api/db', undefined, {}, a2.ck);
    t('GET /api/db returns the email (password still redacted)', db2.s === 200 && db2.j.data.users.find(u => u.id === 'u1').email === 'admin@example.com'
      && db2.j.data.users.every(u => u.password === ''));
    const dataBad = JSON.parse(JSON.stringify(db2.j.data));
    dataBad.users.find(u => u.id === 'u2').email = 'not-an-email';
    t('PUT invalid email -> 400 invalid_email', (await req('PUT', '/api/db', { version: db2.j.version, data: dataBad }, {}, a2.ck)).s === 400);
    const dataOk = JSON.parse(JSON.stringify(db2.j.data));
    dataOk.users.find(u => u.id === 'u2').email = 'secretary@example.com';
    const saved = await req('PUT', '/api/db', { version: db2.j.version, data: dataOk }, {}, a2.ck);
    t('manager can save a valid staff email', saved.s === 200);
    const db3 = await req('GET', '/api/db', undefined, {}, a2.ck);
    t('saved email is returned', db3.j.data.users.find(u => u.id === 'u2').email === 'secretary@example.com');

    // expiry
    await kill(srv);
    fs.writeFileSync(CAPTURE, '');
    srv = startServer({ RESET_CODE_TTL_MS: '1' });
    t('server restarts with 1ms code TTL', await waitUp(), srv.logs());
    // re-seed is not needed: same DATA_DIR, passwords already updated
    const beforeExp = readCapture().length;
    const fpExp = await forgot('admin');
    t('forgot still generic after restart', fpExp.s === 200 && fpExp.j.ok === true);
    const codeExp = codeFrom(await waitForMail(beforeExp));
    await new Promise(r => setTimeout(r, 30));
    t('expired code is rejected', !!(codeExp) && (await reset('admin', codeExp, 'Another9')).s === 400);
    t('password still the current one after expiry', (await signin('admin', 'NewPass9')).s === 200);

  } finally {
    await kill(srv);
  }

  // SMTP not configured: process stays up, generic message, no mail, no crash
  fs.writeFileSync(CAPTURE, '');
  const unconfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-fp-nosmtp-'));
  const unconfCap = path.join(unconfDir, 'mail-capture.jsonl');
  const oldDir = DIR;
  // start with empty SMTP_PASS and SMTP_HOST=smtp.gmail.com (not capture)
  const srv2 = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development', PORT: String(PORT + 1), HOST: '127.0.0.1',
      DATA_DIR: unconfDir, DB_FILE: path.join(unconfDir, 'otoqol.sqlite'),
      JWT_SECRET: SECRET, ADMIN_TOKEN: ADMIN, COOKIE_SECURE: 'false',
      SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_PASSWORD: SCHOOL_PW, DEFAULT_SCHOOL_CODE: 'demo',
      BREVO_API_KEY: '',
      SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'contact.otoqol@gmail.com',
      SMTP_PASS: '', MAIL_FROM: 'Otoqol <contact.otoqol@gmail.com>',
      SMTP_CAPTURE_FILE: unconfCap,
    },
  });
  let logs2 = ''; srv2.stdout.on('data', d => { logs2 += d; }); srv2.stderr.on('data', d => { logs2 += d; });
  const B2 = 'http://127.0.0.1:' + (PORT + 1);
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 10000) {
    try { if ((await fetch(B2 + '/healthz')).ok) { up = true; break; } } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
  t('server starts without SMTP_PASS (does not crash)', up, logs2);
  try {
    const lg2 = await fetch(B2 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: SCHOOL_PW }) });
    const ck2 = (lg2.headers.get('set-cookie') || '').split(';')[0];
    const cur2 = await (await fetch(B2 + '/api/db', { headers: { ...H, Cookie: ck2 } })).json();
    await fetch(B2 + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck2 }, body: JSON.stringify({ version: cur2.version, data: seed() }) });
    const r2 = await fetch(B2 + '/api/forgot-password', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin' }) });
    const j2 = await r2.json();
    t('unconfigured SMTP still returns generic 200', r2.status === 200 && j2.ok === true);
    t('unconfigured SMTP sends no mail', !fs.existsSync(unconfCap) || !fs.readFileSync(unconfCap, 'utf8').trim());
    t('unconfigured SMTP is logged, process still alive', /not configured/.test(logs2) && (await fetch(B2 + '/healthz')).ok);
  } finally {
    await new Promise(resolve => { srv2.on('exit', () => resolve()); srv2.kill('SIGTERM'); setTimeout(() => { try { srv2.kill('SIGKILL'); } catch (e) {} }, 2000); });
  }

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
