// Local load / stress test. Starts its own server (temp DB, rate limits raised) — never point this at the live site.
// node scripts/load-test.js [seconds-per-scenario=10]
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const SECS = Number(process.argv[2] || 10), PORT = Number(process.env.LOAD_PORT || 4200), B = 'http://127.0.0.1:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-load-'));
const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
let srv, mem = [];
const rss = () => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8'))[1]) / 1024; } catch (e) { return 0; } };
async function run(name, conc, fn) {
  const lat = []; let ok = 0, err = 0; const codes = {}; const end = Date.now() + SECS * 1000; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async (_, w) => {
    while (Date.now() < end) {
      const s = performance.now();
      try { const c = await fn(w); codes[c] = (codes[c] || 0) + 1; if (c >= 200 && c < 300 || c === 409) ok++; else err++; } catch (e) { err++; codes.ERR = (codes.ERR || 0) + 1; }
      lat.push(performance.now() - s);
    }
  }));
  lat.sort((a, b) => a - b); const dt = (Date.now() - t0) / 1000;
  const r = { scenario: name, conc, reqs: lat.length, rps: Math.round(lat.length / dt), p50: +pct(lat, .5).toFixed(1), p95: +pct(lat, .95).toFixed(1), p99: +pct(lat, .99).toFixed(1), errRate: +(err * 100 / Math.max(1, lat.length)).toFixed(2), codes: JSON.stringify(codes), rssMB: Math.round(rss()) };
  console.log(JSON.stringify(r)); return r;
}
const seed = () => {
  const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const cands = Array.from({ length: 300 }, (_, i) => ({ id: 'c' + i, name: 'Candidate ' + i, cin: 'AB' + i, phone: '06000' + i, license: 'B', price: 3500, stage: 'drive', createdAt: d(-i % 90), exams: [] }));
  return { settings: { school: 'Load', absLimit: 3 }, users: [{ id: 'u1', name: 'M', role: 'manager', username: 'admin', password: '1234' }, { id: 'u2', name: 'S', role: 'secretary', username: 'secretary', password: '1234' }],
    monitors: Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, name: 'Mon ' + i, username: 'mon' + i, password: '1234' })), vehicles: [{ id: 'v1', plate: '1-A-1', model: 'Logan' }],
    candidates: cands, sessions: Array.from({ length: 2000 }, (_, i) => ({ id: 's' + i, date: d((i % 120) - 60), time: '09:00', duration: 1, type: 'conduite', monitorId: 'm' + (i % 8), vehicleId: 'v1', att: [{ cid: 'c' + (i % 300), status: 'present', reason: '' }] })),
    payments: Array.from({ length: 900 }, (_, i) => ({ id: 'p' + i, no: i + 1, cid: 'c' + (i % 300), amount: 500, date: d(-(i % 90)), note: '' })), expenses: [], notifs: [], requests: [], notes: [], log: [] };
};
(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: 'ignore',
    env: { ...process.env, NODE_ENV: '', PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DIR, DB_FILE: '', SEED_SCHOOL_CODE: 'load', SEED_SCHOOL_PASSWORD: 'LoadPw2026!', DEFAULT_SCHOOL_CODE: '',
      RATE_PER_MIN: '100000000', LOGIN_PER_15MIN: '100000000', LOGIN_PER_ACCOUNT_15MIN: '100000000', TRUST_PROXY: '' } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  const timer = setInterval(() => mem.push(rss()), 500);
  const rssStart = rss();
  // owner setup + realistic data (300 candidates, 2000 sessions, 900 payments)
  let r = await fetch(B + '/api/signin', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin', password: 'LoadPw2026!' }) });
  let ck = r.headers.get('set-cookie').split(';')[0];
  r = await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: 0, data: seed() }) });
  r = await fetch(B + '/api/signin', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin', password: '1234' }) });
  ck = r.headers.get('set-cookie').split(';')[0]; const C = { ...H, Cookie: ck };
  const size = (await (await fetch(B + '/api/db', { headers: C })).text()).length;
  console.log(`data blob: ${(size / 1024).toFixed(0)} KB · ${SECS}s per scenario · server RSS at start ${rssStart.toFixed(0)} MB`);
  const res = [];
  for (const conc of [50, 100]) {
    res.push(await run('GET / (static app)', conc, async () => { const x = await fetch(B + '/'); await x.arrayBuffer(); return x.status; }));
    res.push(await run('GET /healthz', conc, async () => { const x = await fetch(B + '/healthz'); await x.arrayBuffer(); return x.status; }));
    res.push(await run('GET /api/db/version (poll)', conc, async () => { const x = await fetch(B + '/api/db/version', { headers: C }); await x.arrayBuffer(); return x.status; }));
    res.push(await run('GET /api/db (full data)', conc, async () => { const x = await fetch(B + '/api/db', { headers: C }); await x.arrayBuffer(); return x.status; }));
    res.push(await run('POST /api/signin (bcrypt)', conc, async w => { const x = await fetch(B + '/api/signin', { method: 'POST', headers: H, body: JSON.stringify({ username: w % 2 ? 'admin' : 'mon' + (w % 8), password: '1234' }) }); await x.arrayBuffer(); return x.status; }));
  }
  // concurrent writers: each adds one note with optimistic versioning (retry on 409) -> no write may be lost
  let wrote = 0, conflicts = 0;
  const wr = await run('PUT /api/db (50 writers, 409 retry)', 50, async w => {
    for (;;) {
      const g = await (await fetch(B + '/api/db', { headers: C })).json();
      g.data.notes.push({ id: 'n' + w + '-' + Date.now() + Math.random(), text: 'w' + w });
      const p = await fetch(B + '/api/db', { method: 'PUT', headers: C, body: JSON.stringify({ version: g.version, data: g.data }) }); await p.arrayBuffer();
      if (p.status === 200) { wrote++; return 200; } if (p.status === 409) { conflicts++; continue; } return p.status;
    }
  });
  res.push(wr);
  const fin = await (await fetch(B + '/api/db', { headers: C })).json();
  console.log(`writers: ${wrote} successful writes, ${conflicts} conflicts retried, notes on server: ${fin.data.notes.length} -> ${fin.data.notes.length === wrote ? 'NO LOST WRITES' : 'LOST WRITES!'}`);
  await new Promise(r => setTimeout(r, 3000)); if (global.gc) global.gc();
  clearInterval(timer);
  const peak = Math.max(...mem), endRss = rss();
  console.log(`server RSS: start ${rssStart.toFixed(0)} MB, peak ${peak.toFixed(0)} MB, after 3s idle ${endRss.toFixed(0)} MB`);
  const alive = (await fetch(B + '/healthz')).ok;
  console.log('server still healthy: ' + alive);
  srv.kill();
  const bad = res.filter(x => x.errRate > 0).length + (fin.data.notes.length === wrote ? 0 : 1) + (alive ? 0 : 1);
  console.log(bad ? 'LOAD TEST: ' + bad + ' PROBLEM(S)' : 'LOAD TEST OK'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); try { srv.kill(); } catch (x) {} process.exit(1); });
