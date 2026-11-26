// One-time owner setup token + DB creds override env. Starts its own server + temp DB.
// node scripts/owner-setup-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.SU_PORT || 4410), B = 'http://127.0.0.1:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-os-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN = crypto.randomBytes(24).toString('hex');
const ENV_OWNER_PW = crypto.randomBytes(24).toString('hex');
const TOKEN = crypto.randomBytes(32).toString('base64url');
const HASH = crypto.createHash('sha256').update('otq-setup:' + TOKEN).digest('hex');
const NEW_USER = 'mohamed';
const NEW_PW = 'MyOwnPass1!';

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
      OWNER_PASSWORD: ENV_OWNER_PW,
      OWNER_PASSWORD_HASH: '',
      OWNER_SETUP_TOKEN_HASH: HASH,
      COOKIE_SECURE: 'false',
      PUBLIC_URL: B,
      SEED_SCHOOL_CODE: 'demo',
      SEED_SCHOOL_NAME: 'Otoqol Demo',
      SEED_SCHOOL_PASSWORD: 'SchoolPw2026!',
      DEFAULT_SCHOOL_CODE: 'demo',
      BREVO_API_KEY: '',
      SMTP_HOST: '',
      LOGIN_PER_15MIN: '1000',
      LOGIN_PER_ACCOUNT_15MIN: '1000',
      SIGNUP_PER_15MIN: '1000',
      OWNER_LOGIN_PER_15MIN: '1000',
      OWNER_SETUP_PER_15MIN: '1000',
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
function stop(srv) {
  return new Promise(resolve => {
    if (!srv || srv.exitCode != null || srv.killed) return resolve();
    srv.once('exit', resolve);
    srv.kill('SIGTERM');
    setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} }, 2000);
  });
}

(async () => {
  let srv = startServer();
  let stderr = '';
  srv.stderr.on('data', d => { stderr += d; });
  try {
    await waitUp();

    const page = await fetch(B + '/owner/setup?token=placeholder');
    const html = await page.text();
    t('GET /owner/setup 200', page.status === 200 && /data-oq-owner-setup/.test(html) && /إنشاء حساب المالك/.test(html));
    t('setup page has no pricing text', !/درهم|\bMAD\b|\bDH\b|\bprix\b|tarif|\bprices?\b|pricing/i.test(html));

    const envLogin = await req('POST', '/api/owner/login', { username: 'otoqol', password: ENV_OWNER_PW });
    t('env owner login works before setup', envLogin.s === 200 && !!envLogin.owner);

    t('setup peek missing token -> 400', (await req('GET', '/api/owner/setup')).j?.error === 'invalid_token');
    t('setup peek bad token -> 400', (await req('GET', '/api/owner/setup?token=not-the-token')).j?.error === 'invalid_token');
    const peek = await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN));
    t('setup peek valid token', peek.s === 200 && peek.j?.ok === true && Number(peek.j.expires_at) > Date.now());
    const firstExp = peek.j.expires_at;

    t('setup short password -> 400', (await req('POST', '/api/owner/setup', { token: TOKEN, username: NEW_USER, password: 'short7x' })).j?.error === 'weak_password');
    t('token still valid after short password', (await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN))).j?.ok === true);
    t('setup bad username -> 400', (await req('POST', '/api/owner/setup', { token: TOKEN, username: 'x', password: NEW_PW })).j?.error === 'invalid_username');

    const ok = await req('POST', '/api/owner/setup', { token: TOKEN, username: NEW_USER, password: NEW_PW });
    t('setup success 200', ok.s === 200 && ok.j?.ok === true && ok.j.user?.username === NEW_USER && ok.j.user?.role === 'owner');
    t('setup sets owner cookie', !!ok.owner);
    t('setup response has no password', !JSON.stringify(ok.j).includes(NEW_PW) && !JSON.stringify(ok.j).includes('password_hash'));

    const me = await req('GET', '/api/owner/me', undefined, {}, ok.owner);
    t('setup session is owner', me.s === 200 && me.j?.role === 'owner' && me.j?.username === NEW_USER);

    t('token reuse fails', (await req('POST', '/api/owner/setup', { token: TOKEN, username: 'other', password: 'AnotherPw1' })).j?.error === 'used_token');
    t('peek after use is used_token', (await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN))).j?.error === 'used_token');

    const newLogin = await req('POST', '/api/owner/login', { username: NEW_USER, password: NEW_PW });
    t('login with new creds', newLogin.s === 200 && newLogin.j?.user?.username === NEW_USER);
    const upper = await req('POST', '/api/owner/login', { username: 'MOHAMED', password: NEW_PW });
    t('login username is case-insensitive', upper.s === 200);
    t('env creds no longer work', (await req('POST', '/api/owner/login', { username: 'otoqol', password: ENV_OWNER_PW })).s === 401);
    t('new username + env password fails', (await req('POST', '/api/owner/login', { username: NEW_USER, password: ENV_OWNER_PW })).s === 401);

    // restart: used hash must not re-arm
    await stop(srv);
    srv = startServer();
    stderr = '';
    srv.stderr.on('data', d => { stderr += d; });
    await waitUp();
    t('used hash not re-armed after restart', (await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN))).j?.error === 'used_token');
    t('db creds still work after restart', (await req('POST', '/api/owner/login', { username: NEW_USER, password: NEW_PW })).s === 200);

  } finally {
    await stop(srv);
  }

  // expired token (separate DB)
  const DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-os-exp-'));
  const TOKEN2 = crypto.randomBytes(32).toString('base64url');
  const HASH2 = crypto.createHash('sha256').update('otq-setup:' + TOKEN2).digest('hex');
  process.env.DATA_DIR = DIR2;
  process.env.DB_FILE = path.join(DIR2, 'otoqol.sqlite');
  delete require.cache[require.resolve('../src/db')];
  const store = require('../src/db');
  store.createSetupToken(TOKEN2, -1000);
  // expired already; start a server on this DB without env hash (so it won't re-arm this one)
  const envFor2 = {
    DATA_DIR: DIR2,
    DB_FILE: path.join(DIR2, 'otoqol.sqlite'),
    OWNER_SETUP_TOKEN_HASH: '',
  };
  srv = startServer(envFor2);
  try {
    await waitUp();
    t('expired token rejected', (await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN2))).j?.error === 'expired_token');
    t('expired post rejected', (await req('POST', '/api/owner/setup', { token: TOKEN2, username: NEW_USER, password: NEW_PW })).j?.error === 'expired_token');
  } finally {
    await stop(srv);
  }

  // already_live: expiry must not reset on restart
  const DIR3 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-os-live-'));
  const TOKEN3 = crypto.randomBytes(32).toString('base64url');
  const HASH3 = crypto.createHash('sha256').update('otq-setup:' + TOKEN3).digest('hex');
  srv = startServer({ DATA_DIR: DIR3, DB_FILE: path.join(DIR3, 'otoqol.sqlite'), OWNER_SETUP_TOKEN_HASH: HASH3 });
  try {
    await waitUp();
    const p1 = await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN3));
    t('fresh env hash armed', p1.s === 200 && p1.j?.ok === true);
    const exp1 = p1.j.expires_at;
    await stop(srv);
    srv = startServer({ DATA_DIR: DIR3, DB_FILE: path.join(DIR3, 'otoqol.sqlite'), OWNER_SETUP_TOKEN_HASH: HASH3 });
    await waitUp();
    const p2 = await req('GET', '/api/owner/setup?token=' + encodeURIComponent(TOKEN3));
    t('restart does not reset live token expiry', p2.s === 200 && p2.j?.expires_at === exp1);
  } finally {
    await stop(srv);
  }

  if (stderr && /Error|EADDRINUSE/.test(stderr)) t('stderr clean', false, stderr.slice(0, 200));
  console.log(fails ? ('FAILED ' + fails) : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
