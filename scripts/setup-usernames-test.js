// First-time setup must not reuse globally taken usernames (e.g. demo's admin).
// node scripts/setup-usernames-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const crypto = require('crypto');

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

function startServer(dir, extraEnv) {
  const env = Object.assign({}, process.env, {
    DATA_DIR: dir, DB_FILE: path.join(dir, 'otoqol.sqlite'),
    JWT_SECRET: 'setup-usernames-secret-32charsxxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    ADMIN_TOKEN: 'setup-admin-token-32charsxxxxxxx',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000',
    PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4480)
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
async function req(base, method, url, body, cookie, extra) {
  const r = await fetch(base + url, {
    method,
    headers: { ...H, Cookie: cookie || '', ...(extra || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, cookie: cookieOf(r) || cookie, error: j && j.error };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-setup-un-'));
  const PORT = Number(process.env.SETUP_UN_PORT || 4480);
  const B = 'http://127.0.0.1:' + PORT;
  const srv = startServer(dir, { PORT: String(PORT), PUBLIC_URL: B });
  try {
    t('server starts', await waitUp(B), srv.logs());
    const login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
    const cur = await req(B, 'GET', '/api/db', undefined, login.cookie);
    const seed = {
      settings: { school: 'Demo' },
      users: [
        { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'DemoAdm1' },
        { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'DemoSec1' }
      ],
      monitors: [], vehicles: [], candidates: [{ id: 'c1', name: 'A' }], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: []
    };
    const putDemo = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: seed }, login.cookie);
    t('demo school stores admin + secretary', putDemo.s === 200, 'status=' + putDemo.s);

    const tok = 'setup-admin-token-32charsxxxxxxx';
    const created = await req(B, 'POST', '/api/admin/schools', { code: 'najah', name: 'مدرسة النجاح', password: 'NajahPw2026!', status: 'active' }, '', { Authorization: 'Bearer ' + tok });
    t('admin API creates a second school', created.s === 200 && created.j && created.j.code === 'najah', 'status=' + created.s + ' err=' + created.error);

    const setup = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'NajahPw2026!' });
    t('fresh school: admin + school password still opens setup', setup.s === 200 && setup.j.setup === true && setup.j.school && setup.j.school.code === 'najah', 'status=' + setup.s + ' setup=' + (setup.j && setup.j.setup) + ' code=' + (setup.j && setup.j.school && setup.j.school.code));

    const empty = await req(B, 'GET', '/api/db', undefined, setup.cookie);
    const defaultLike = {
      settings: { school: 'مدرسة النجاح' },
      users: [
        { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'NajahPw2026!' },
        { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: '' }
      ],
      monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: []
    };
    const bad = await req(B, 'PUT', '/api/db', { version: empty.j.version, data: defaultLike }, setup.cookie);
    t('default admin/secretary on the second school -> username_taken', bad.s === 400 && bad.error === 'username_taken', 'status=' + bad.s + ' err=' + bad.error);

    const unique = JSON.parse(JSON.stringify(defaultLike));
    unique.users[0].username = 'admin_najah';
    unique.users[1].username = 'sec_najah';
    const ok = await req(B, 'PUT', '/api/db', { version: empty.j.version, data: unique }, setup.cookie);
    t('suffixed admin_najah / sec_najah can be saved', ok.s === 200, 'status=' + ok.s + ' err=' + ok.error);

    const mgr = await req(B, 'POST', '/api/signin', { username: 'admin_najah', password: 'NajahPw2026!' });
    t('admin_najah signs into the new school', mgr.s === 200 && mgr.j.school && mgr.j.school.code === 'najah' && mgr.j.user && mgr.j.user.role === 'manager');

    const demoAdm = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'DemoAdm1' });
    t('original demo admin still signs into demo', demoAdm.s === 200 && demoAdm.j.school && demoAdm.j.school.code === 'demo');

    // client helper: same rule as setupUsernames
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'index.html'), 'utf8');
    t('app setupDB assigns admin_<code> and sec_<code>', /username=names\.mgr/.test(html) && /username=names\.sec/.test(html) && /admin_'\+suffix/.test(html) && /sec_'\+suffix/.test(html));
  } finally {
    kill(srv);
  }
  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
