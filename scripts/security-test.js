// Security regression tests. Starts its own server (production mode, default rate limits, temp DB).
// node scripts/security-test.js            (port 4100; needs playwright-core + Chrome for the XSS check, else skipped)
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const jwt = require('jsonwebtoken');
const PORT = Number(process.env.SEC_PORT || 4100), B = 'http://localhost:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-sec-'));
const SECRET = crypto.randomBytes(32).toString('hex'), ADMIN = crypto.randomBytes(24).toString('hex');
let fails = 0; const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
async function req(m, u, body, h = {}, ck = '') {
  const r = await fetch(B + u, { method: m, redirect: 'manual', headers: { ...H, ...(ck ? { Cookie: ck } : {}), ...h }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const sc = r.headers.get('set-cookie'); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { s: r.status, j, text, h: r.headers, sc, ck: sc && /otq_sess=[^;]+/.test(sc) && !/otq_sess=;/.test(sc) ? sc.split(';')[0] : '' };
}
const signin = (u, p, h = {}) => req('POST', '/api/signin', { username: u, password: p }, h);
const AH = { Authorization: 'Bearer ' + ADMIN };
const plainDB = () => ({ settings: { school: 'Sec', absLimit: 3 },
  users: [{ id: 'u1', name: 'Boss', role: 'manager', username: 'admin', password: '1234' }, { id: 'u2', name: 'Sec', role: 'secretary', username: 'secretary', password: '1234' }],
  monitors: [{ id: 'm1', name: 'Karim', username: 'karim', password: '1234' }], vehicles: [], candidates: [{ id: 'c1', name: '<img src=x onerror="window.__xss=1">' }], sessions: [],
  payments: [{ id: 'p1', no: '<img src=x onerror="window.opener.__xss=2">', cid: 'c1', amount: 100, date: '2026-01-01', note: '' }], expenses: [], notifs: [], requests: [], notes: [], log: [] });

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DIR, DB_FILE: '', JWT_SECRET: SECRET, ADMIN_TOKEN: ADMIN, TRUST_PROXY: '1',
      SEED_SCHOOL_CODE: 'sec', SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: '', LOGIN_PER_15MIN: '', LOGIN_PER_ACCOUNT_15MIN: '', RATE_PER_MIN: '' } });
  let stderr = ''; srv.stderr.on('data', d => stderr += d);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  let ip = 1; const nextIp = () => ({ 'X-Forwarded-For': '10.0.0.' + (ip++) }); // each check from its own client IP (rate limits are tested separately)
  try {
    // ---- headers
    const home = await req('GET', '/');
    const appPage = await req('GET', '/app');
    t('/ = landing page, /app = the app (security headers on both)', /data-login/.test(home.text) && !/SchoolGate/.test(home.text) && /SchoolGate/.test(appPage.text)
      && (appPage.h.get('content-security-policy') || '') === (home.h.get('content-security-policy') || '') && appPage.h.get('x-frame-options') === 'DENY');
    t('/app deep refresh (e.g. /app/settings) serves the app', /SchoolGate/.test((await req('GET', '/app/settings')).text));
    t('landing has no external scripts', !/<script[^>]+src=/i.test(home.text));
    const hh = k => home.h.get(k) || '';
    t('CSP present, no framing (frame-ancestors none)', /frame-ancestors 'none'/.test(hh('content-security-policy')) && /object-src 'none'/.test(hh('content-security-policy')));
    t('X-Frame-Options DENY', hh('x-frame-options') === 'DENY');
    t('nosniff + Referrer-Policy + Permissions-Policy', hh('x-content-type-options') === 'nosniff' && hh('referrer-policy') === 'no-referrer' && /camera=\(\)/.test(hh('permissions-policy')));
    t('HSTS in production', /max-age=31536000/.test(hh('strict-transport-security')));
    t('no X-Powered-By', !home.h.get('x-powered-by'));
    t('CDN scripts pinned with SRI', (appPage.text.match(/integrity="sha384-/g) || []).length === 3 && !/unpkg\.com\/react@18\//.test(appPage.text));

    // ---- store plain-text passwords directly in the DB = how the live DB looks before this release
    const Database = require('better-sqlite3'); const raw = new Database(path.join(DIR, 'otoqol.sqlite'));
    raw.prepare("UPDATE school_data SET version=1, data=? WHERE school_id=(SELECT id FROM schools WHERE code='sec')").run(JSON.stringify(plainDB())); raw.close();

    // ---- CSRF
    t('signin without X-Otoqol header -> 403', (await req('POST', '/api/signin', { username: 'admin', password: '1234' }, { 'X-Otoqol': '', ...nextIp() })).s === 403);
    const si = await signin('admin', '1234', nextIp()); const ck = si.ck;
    t('legacy plain-text admin/1234 still signs in', si.s === 200 && si.j.user.role === 'manager');
    t('cookie HttpOnly + Secure + SameSite=Strict', /HttpOnly/i.test(si.sc) && /Secure/i.test(si.sc) && /SameSite=Strict/i.test(si.sc), si.sc);
    t('PUT /api/db without X-Otoqol -> 403', (await req('PUT', '/api/db', { version: 1, data: plainDB() }, { 'X-Otoqol': '' }, ck)).s === 403);
    t('logout without X-Otoqol -> 403', (await req('POST', '/api/logout', {}, { 'X-Otoqol': '' }, ck)).s === 403);
    t('cross-origin request gets no CORS grant', !(await req('GET', '/api/me', undefined, { Origin: 'https://evil.example' }, ck)).h.get('access-control-allow-origin'));

    // ---- passwords: hashed at rest, never sent to the browser
    const exp = await req('GET', '/api/admin/schools/sec/export', undefined, AH);
    t('in-app passwords migrated to bcrypt on first sign-in', exp.j.data.users.concat(exp.j.data.monitors).every(u => /^\$2[aby]\$/.test(u.password)));
    let g = await req('GET', '/api/db', undefined, {}, ck);
    t('GET /api/db never returns passwords', g.j.data.users.concat(g.j.data.monitors).every(u => u.password === ''));
    t('/api/me has no password', !/1234|\$2/.test((await req('GET', '/api/me', undefined, {}, ck)).text));
    t('admin/1234 still works after migration', (await signin('admin', '1234', nextIp())).s === 200);
    t('karim (monitor) still works after migration', (await signin('karim', '1234', nextIp())).j?.user?.role === 'monitor');
    // round-trip: the app sends back blank passwords -> kept
    let put = await req('PUT', '/api/db', { version: g.j.version, data: g.j.data }, {}, ck);
    t('app PUT with blank passwords keeps them', put.s === 200 && (await signin('secretary', '1234', nextIp())).s === 200);
    t('empty password rejected', (await signin('admin', '', nextIp())).s === 400);

    // ---- JWT
    const p = jwt.decode(decodeURIComponent(ck.split('=')[1]));
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.';
    t('alg=none token rejected', (await req('GET', '/api/db', undefined, {}, 'otq_sess=' + none)).s === 401);
    const wrong = jwt.sign({ ...p }, 'not-the-secret');
    t('token with wrong secret rejected', (await req('GET', '/api/db', undefined, {}, 'otq_sess=' + wrong)).s === 401);
    const noJti = jwt.sign({ sid: p.sid, gen: p.gen, u: p.u }, SECRET, { issuer: 'otoqol', audience: 'otoqol-app', expiresIn: '1d' });
    t('valid signature but no server session -> 401', (await req('GET', '/api/db', undefined, {}, 'otq_sess=' + noJti)).s === 401);
    const forgedRole = jwt.sign({ ...p, u: { ...p.u, role: 'manager', id: 'm1', owner: true } }, 'x');
    t('forged role claim rejected', (await req('GET', '/api/db', undefined, {}, 'otq_sess=' + forgedRole)).s === 401);

    // ---- logout ends the session server-side
    const s2 = (await signin('admin', '1234', nextIp())).ck;
    t('session works before logout', (await req('GET', '/api/me', undefined, {}, s2)).s === 200);
    await req('POST', '/api/logout', {}, {}, s2);
    t('copied cookie is dead after logout', (await req('GET', '/api/me', undefined, {}, s2)).s === 401);

    // ---- role enforcement (server side)
    const mon = (await signin('karim', '1234', nextIp())).ck;
    g = await req('GET', '/api/db', undefined, {}, mon);
    const evil = JSON.parse(JSON.stringify(g.j.data));
    evil.users.push({ id: 'hack', name: 'Hacker', role: 'manager', username: 'hacker', password: 'hacked1' });
    evil.monitors[0].password = 'newpw'; evil.settings.school = 'PWNED'; evil.payments = []; evil.candidates.push({ id: 'c9', name: 'by monitor' });
    put = await req('PUT', '/api/db', { version: g.j.version, data: evil }, {}, mon);
    const after = (await req('GET', '/api/admin/schools/sec/export', undefined, AH)).j.data;
    t('monitor cannot add a manager / change passwords / settings / payments', put.s === 200 && !after.users.some(u => u.id === 'hack') && after.settings.school !== 'PWNED' && after.payments.length === 1 && (await signin('hacker', 'hacked1', nextIp())).s === 401);
    t('monitor can still do monitor work (e.g. data it owns)', after.candidates.some(c => c.id === 'c9'));
    const sec = (await signin('secretary', '1234', nextIp())).ck;
    g = await req('GET', '/api/db', undefined, {}, sec); const e2 = JSON.parse(JSON.stringify(g.j.data));
    e2.users.find(u => u.id === 'u2').role = 'manager'; e2.settings.school = 'PWNED2'; e2.payments.push({ id: 'p2', no: 2, cid: 'c1', amount: 50, date: '2026-01-02', note: '' });
    await req('PUT', '/api/db', { version: g.j.version, data: e2 }, {}, sec);
    const a2 = (await req('GET', '/api/admin/schools/sec/export', undefined, AH)).j.data;
    t('secretary cannot promote herself or change settings', a2.users.find(u => u.id === 'u2').role === 'secretary' && a2.settings.school !== 'PWNED2');
    t('secretary can still record payments', a2.payments.length === 2);
    // manager removes the secretary -> her session ends at once
    const mg = (await signin('admin', '1234', nextIp())).ck; g = await req('GET', '/api/db', undefined, {}, mg);
    const e3 = JSON.parse(JSON.stringify(g.j.data)); e3.users = e3.users.filter(u => u.id !== 'u2');
    await req('PUT', '/api/db', { version: g.j.version, data: e3 }, {}, mg);
    t('removed user is signed out on the next request', (await req('GET', '/api/db/version', undefined, {}, sec)).s === 401);
    // manager changes own password -> stays signed in (new cookie), old password stops working
    g = await req('GET', '/api/db', undefined, {}, mg); const e4 = JSON.parse(JSON.stringify(g.j.data)); e4.users.find(u => u.id === 'u1').password = '1234';
    t('re-saving the same password keeps the session', (await req('PUT', '/api/db', { version: g.j.version, data: e4 }, {}, mg)).s === 200 && (await req('GET', '/api/me', undefined, {}, mg)).s === 200);

    // ---- input handling
    t('SQL injection in username -> plain 401', (await signin("admin' OR '1'='1", "x' OR '1'='1", nextIp())).s === 401);
    const injSch = await req('POST', '/api/signin', { school: "x' OR 1=1 --", username: 'admin', password: '1234' }, nextIp());
    t('SQL injection in unused school field is ignored (no 500)', injSch.s === 200 && injSch.j?.user?.role === 'manager');
    t('SQL injection in school on legacy /api/login -> plain 401', (await req('POST', '/api/login', { school: "x' OR 1=1 --", password: '1234' }, nextIp())).s === 401);
    t('non-string fields -> 400', (await req('POST', '/api/signin', { username: { $ne: 1 }, password: ['1'] }, nextIp())).s === 400);
    const bad = await req('POST', '/api/signin', '{"username":', nextIp());
    t('malformed JSON -> 400 without stack trace', bad.s === 400 && !/at |node_modules|Error:/.test(bad.text));
    g = await req('GET', '/api/db', undefined, {}, mg);
    const proto = JSON.parse(JSON.stringify(g.j.data)); proto.settings = JSON.parse('{"school":"x","__proto__":{"polluted":true}}');
    t('settings must be an object', (await req('PUT', '/api/db', { version: g.j.version, data: { ...g.j.data, settings: [1] } }, {}, mg)).s === 400);
    t('__proto__ payload is rejected', (await req('PUT', '/api/db', { version: g.j.version, data: proto }, {}, mg)).s === 400);
    t('__proto__ payload does not break the server', (await req('GET', '/healthz')).s === 200 && (await req('GET', '/api/me', undefined, {}, mg)).j.user.role === 'manager');
    t('body over 15MB -> 413', (await req('PUT', '/api/db', { version: 0, data: { users: [], candidates: [], x: 'x'.repeat(16 << 20) } }, {}, mg)).s === 413);
    for (const u of ['/../src/server.js', '/%2e%2e/package.json', '/..%2fsrc/db.js', '/.env', '/data/otoqol.sqlite'])
      { const r = await req('GET', u); if (/require\(|"dependencies"|JWT_SECRET|SQLite format/.test(r.text)) { t('no file disclosure ' + u, false); } }
    t('no source / env / DB disclosure via static paths', true);
    t('unknown API route -> JSON 404', (await req('GET', '/api/nope')).s === 404);

    // ---- admin API
    t('admin with wrong token -> 401', (await req('GET', '/api/admin/schools', undefined, { Authorization: 'Bearer ' + 'x'.repeat(48) })).s === 401);
    const cr = await req('POST', '/api/admin/schools', { code: 'other', password: 'ChosenPw2026' }, AH);
    t('admin create does not echo a chosen password', cr.s === 200 && !('password' in cr.j));
    const dup = await req('POST', '/api/admin/schools', { code: 'other', password: 'ChosenPw2026' }, AH);
    t('admin errors hide SQL details', dup.s === 400 && !/SQLITE|constraint/i.test(dup.text), dup.text);
    t('school isolation: "other" school cannot read "sec" data', (await (async () => { const o = await req('POST', '/api/login', { school: 'other', password: 'ChosenPw2026' }, nextIp()); const d = await req('GET', '/api/db', undefined, {}, o.ck); return d.s === 200 && d.j.data === null; })()));
    let last; for (let i = 0; i < 11; i++) last = await req('GET', '/api/admin/schools', undefined, { Authorization: 'Bearer wrong-token-' + i, 'X-Forwarded-For': '10.9.9.9' });
    t('admin token brute force -> 429 after 10 failures', last.s === 429);

    // ---- rate limits (default: 10 failures / 15 min per IP, 30 per account)
    const ipA = await req('POST', '/api/signin', { username: 'nobody', password: 'x' }, { 'X-Forwarded-For': '10.7.7.1' });
    const ipB = await req('POST', '/api/signin', { username: 'nobody2', password: 'x' }, { 'X-Forwarded-For': '10.7.7.2' });
    t('TRUST_PROXY=1: each client IP has its own rate-limit bucket', /remaining=9/.test(ipA.h.get('ratelimit') || '') && /remaining=9/.test(ipB.h.get('ratelimit') || ''), ipA.h.get('ratelimit') + ' / ' + ipB.h.get('ratelimit'));
    let r; for (let i = 0; i < 11; i++) r = await signin('admin', 'bad' + i, { 'X-Forwarded-For': '10.1.1.1' });
    t('11th bad sign-in from one IP -> 429', r.s === 429);
    t('…even with the right password from that IP', (await signin('admin', '1234', { 'X-Forwarded-For': '10.1.1.1' })).s === 429);
    for (let i = 0; i < 31; i++) r = await signin('karim', 'bad' + i, { 'X-Forwarded-For': '10.2.' + Math.floor(i / 5) + '.' + i });
    t('distributed guessing on one account (many IPs) -> 429', r.s === 429);
    t('legacy /api/login also rate limited', await (async () => { let x; for (let i = 0; i < 11; i++) x = await req('POST', '/api/login', { school: 'sec', password: 'bad' + i }, { 'X-Forwarded-For': '10.3.3.3' }); return x.s === 429; })());

    // ---- stored XSS (browser)
    let pw = null; try { pw = require('playwright-core'); } catch (e) { try { pw = require('/tmp/pw/node_modules/playwright-core'); } catch (e2) {} }
    if (pw) {
      const raw2 = new Database(path.join(DIR, 'otoqol.sqlite')); const x = plainDB(); x.users = after.users; x.monitors = after.monitors;
      raw2.prepare("UPDATE school_data SET version=version+1, data=? WHERE school_id=(SELECT id FROM schools WHERE code='sec')").run(JSON.stringify(x)); raw2.close();
      // the browser talks plain http here, so use a non-production twin of the cookie
      const br = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
      const ctx = await br.newContext(); const page = await ctx.newPage(); page.on('dialog', d => d.dismiss());
      const fresh = await signin('admin', '1234', nextIp());
      await ctx.addCookies([{ name: 'otq_sess', value: fresh.ck.split('=')[1], url: B, httpOnly: true, sameSite: 'Strict' }]);
      await page.goto(B + '/app'); await page.waitForSelector('.nav', { timeout: 30000 });
      await page.click('.nav button:has-text("المترشحون")'); await page.waitForTimeout(400);
      const shown = await page.locator('text=<img src=x').count();
      await page.locator('tr.cl').first().click(); await page.waitForTimeout(200);
      const tabs = page.locator('.md .tabs button'); for (let k = 0; k < await tabs.count(); k++) { await tabs.nth(k).click(); await page.waitForTimeout(100);
        if (await page.locator('button:has-text("🖨")').count()) { const [pop] = await Promise.all([page.waitForEvent('popup'), page.locator('button:has-text("🖨")').first().click()]); await pop.waitForLoadState(); await pop.waitForTimeout(300); break; } }
      const xss = await page.evaluate(() => window.__xss);
      t('stored XSS payloads render as text (list, modal, printed receipt)', shown > 0 && xss === undefined, 'xss=' + xss);
      await br.close();
    } else console.log('SKIP browser XSS check (no playwright-core)');
  } catch (e) { console.error(e); fails++; }
  finally { srv.kill(); }
  if (/Error|at /.test(stderr)) console.log('server stderr:\n' + stderr);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
