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
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
