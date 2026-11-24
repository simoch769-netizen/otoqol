// Quick API smoke test: node scripts/api-test.js [baseUrl] [school] [password]
const B = process.argv[2] || 'http://localhost:3000', S = process.argv[3] || 'demo', P = process.argv[4] || 'Demo2026!';
let cookie = '', fails = 0;
const t = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };
async function req(m, u, body, h = {}) {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Otoqol': '1', Cookie: cookie, ...h }, body: body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, h: r.headers };
}
(async () => {
  const home = await fetch(B + '/').then(r => r.text()), appHtml = await fetch(B + '/app').then(r => r.text());
  t('GET / = landing page, GET /app = app', /data-login/.test(home) && /href="\/app"/.test(home) && /SchoolGate/.test(appHtml));
  t('unauth GET /api/db -> 401', (await req('GET', '/api/db')).s === 401);
  t('bad password -> 401', (await req('POST', '/api/login', { school: S, password: 'nope' })).s === 401);
  const l = await req('POST', '/api/login', { school: S, password: P });
  t('login -> 200 + httpOnly cookie', l.s === 200 && /otq_sess/.test(cookie), JSON.stringify(l.j));
  const me = await req('GET', '/api/me'); t('GET /api/me', me.s === 200, JSON.stringify(me.j));
  const g0 = await req('GET', '/api/db'); const v0 = g0.j.version;
  const data = { settings: { school: 'Demo', absLimit: 3 }, users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: '1234' }], monitors: [], vehicles: [], candidates: [{ id: 'c1', name: 'Test ' + Date.now() }], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [] };
  const p1 = await req('PUT', '/api/db', { version: v0, data }); t('PUT with current version -> 200', p1.s === 200 && p1.j.version === v0 + 1, JSON.stringify(p1.j));
  const g1 = await req('GET', '/api/db'); t('GET returns saved data', g1.j.data.candidates[0].name === data.candidates[0].name && g1.j.version === v0 + 1);
  const p2 = await req('PUT', '/api/db', { version: v0, data }); t('PUT with stale version -> 409', p2.s === 409 && p2.j.version === v0 + 1, JSON.stringify(p2.j));
  t('PUT invalid data -> 400', (await req('PUT', '/api/db', { version: v0 + 1, data: { foo: 1 } })).s === 400);
  t('PUT without X-Otoqol header -> 403', (await req('PUT', '/api/db', { version: v0 + 1, data }, { 'X-Otoqol': '' })).s === 403);
  const big = { ...data, notes: ['x'.repeat(16 * 1024 * 1024)] };
  t('PUT > 15MB -> 413', (await req('PUT', '/api/db', { version: v0 + 1, data: big })).s === 413);
  t('helmet headers present', !!(g1.h.get('content-security-policy') && g1.h.get('x-content-type-options')));
  t('admin without token -> 401/404', [401, 404].includes((await req('GET', '/api/admin/schools')).s));
  await req('POST', '/api/logout', {}); cookie = '';
  t('after logout -> 401', (await req('GET', '/api/db')).s === 401);

  // ---------- single sign-in (/api/signin): school code + in-app username/password ----------
  const si = (u, p, sc = S) => req('POST', '/api/signin', { school: sc, username: u, password: p });
  t('signin WITHOUT school -> default school of this install', (await req('POST', '/api/signin', { username: 'admin', password: '1234' })).j?.school?.code === S.toLowerCase()); cookie = '';
  t('signin without school, wrong password -> 401', (await req('POST', '/api/signin', { username: 'admin', password: 'nope' })).s === 401);
  let r = await si('admin', '1234');
  t('signin admin/1234 -> 200 + cookie + manager', r.s === 200 && r.j.user.role === 'manager' && r.j.user.id === 'u1' && /otq_sess/.test(cookie), JSON.stringify(r.j));
  let me2 = await req('GET', '/api/me'); t('/api/me returns the app user', me2.s === 200 && me2.j.user && me2.j.user.id === 'u1', JSON.stringify(me2.j));
  t('signin session can read /api/db', (await req('GET', '/api/db')).s === 200);
  await req('POST', '/api/logout', {}); cookie = '';
  t('signin same normalisation as the app (ADMIN + Arabic digits)', (await si('  ADMIN ', '١٢٣٤')).s === 200); cookie = '';
  t('signin wrong password -> 401', (await si('admin', 'nope')).s === 401);
  t('signin unknown school -> 401', (await si('admin', '1234', 'no-such-school-xyz')).s === 401);
  t('admin + school password refused while in-app admin exists', (await si('admin', P)).s === 401);
  t('signin missing username -> 400', (await req('POST', '/api/signin', { school: S, password: '1234' })).s === 400);
  t('signin without X-Otoqol header -> 403', (await req('POST', '/api/signin', { school: S, username: 'admin', password: '1234' }, { 'X-Otoqol': '' })).s === 403);
  // monitor + disabled account + password change ends the session
  await si('admin', '1234'); const cur = (await req('GET', '/api/db')).j;
  const d2 = { ...cur.data, users: [...cur.data.users, { id: 'u9', name: 'Off', role: 'secretary', username: 'off', password: 'x1', active: false }],
    monitors: [{ id: 'm1', name: 'Karim', username: 'karim', password: '1234' }] };
  t('seed monitor + disabled user', (await req('PUT', '/api/db', { version: cur.version, data: d2 })).s === 200);
  cookie = ''; r = await si('karim', '1234'); t('monitor signin -> role monitor', r.s === 200 && r.j.user.role === 'monitor' && r.j.user.id === 'm1', JSON.stringify(r.j));
  cookie = ''; t('disabled (active:false) user refused', (await si('off', 'x1')).s === 401);
  r = await si('admin', '1234'); const adminCookie = cookie; const c3 = (await req('GET', '/api/db')).j;
  const d3 = JSON.parse(JSON.stringify(c3.data)); d3.users.find(x => x.id === 'u1').password = '5678';
  await req('PUT', '/api/db', { version: c3.version, data: d3 });
  cookie = adminCookie; t('in-app password changed -> /api/me 401 (session ends)', (await req('GET', '/api/me')).s === 401);
  cookie = ''; t('new in-app password works', (await si('admin', '5678')).s === 200);
  const c4 = (await req('GET', '/api/db')).j; d3.users.find(x => x.id === 'u1').password = '1234';
  await req('PUT', '/api/db', { version: c4.version, data: { ...d3, users: d3.users.filter(x => x.id !== 'u9') } }); // restore
  await req('POST', '/api/logout', {}); cookie = '';
  t('legacy /api/login still works', (await req('POST', '/api/login', { school: S, password: P })).s === 200);
  me2 = await req('GET', '/api/me'); t('legacy session: /api/me user=null', me2.s === 200 && me2.j.user == null); cookie = '';

  // fresh school: admin + SCHOOL password = first-time setup (needs ADMIN_TOKEN to create the school)
  const AT = process.env.ADMIN_TOKEN;
  if (AT) {
    const code = 'fresh' + Date.now().toString(36), FP = 'Fresh2026!';
    const auth = { Authorization: 'Bearer ' + AT };
    const cr = await req('POST', '/api/admin/schools', { code, name: 'Fresh', password: FP }, auth); cookie = '';
    t('admin API creates fresh school', cr.s === 200, JSON.stringify(cr.j));
    t('fresh school: admin/1234 refused (no data yet)', (await si('admin', '1234', code)).s === 401);
    t('fresh school: other username + school password refused', (await si('boss', FP, code)).s === 401);
    r = await si('admin', FP, code); t('fresh school: admin + school password -> setup', r.s === 200 && r.j.setup === true && r.j.user.id === 'u1' && r.j.user.role === 'manager', JSON.stringify(r.j));
    t('fresh school setup session valid', (await req('GET', '/api/me')).s === 200); cookie = '';
    await req('POST', '/api/admin/schools/' + code + '/active', { active: false }, auth); cookie = '';
    t('inactive school -> 403', (await si('admin', FP, code)).s === 403);
  } else console.log('SKIP fresh-school tests (set ADMIN_TOKEN)');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
