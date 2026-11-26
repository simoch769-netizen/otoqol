// Google Drive backup helpers + /api/config + settings UI (manager only).
// node scripts/drive-backup-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const Drive = require('../public/assets/otoqol-drive.js');

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

function unitTests() {
  t('backup file name shape', /^otoqol-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(Drive.backupFileName(new Date('2026-11-26T09:05:00'))));
  t('folder name is Otoqol Backups', Drive.FOLDER_NAME === 'Otoqol Backups');
  t('scope is drive.file', Drive.SCOPE === 'https://www.googleapis.com/auth/drive.file');
  const ok = Drive.parseBackup(JSON.stringify({ settings: {}, candidates: [], users: [] }));
  t('parseBackup accepts a candidates array', Array.isArray(ok.candidates));
  let threw = false;
  try { Drive.parseBackup('{"foo":1}'); } catch (e) { threw = e.message === 'invalid'; }
  t('parseBackup rejects JSON without candidates', threw);
  threw = false;
  try { Drive.parseBackup('not-json'); } catch (e) { threw = e.message === 'invalid'; }
  t('parseBackup rejects non-JSON', threw);
}

async function mockDriveTests() {
  const orig = global.fetch;
  const calls = [];
  const files = {};
  let folders = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    calls.push({ method, u, auth });
    const json = (obj, status = 200) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: () => 'application/json' },
      json: async () => obj, text: async () => JSON.stringify(obj),
    });
    const text = (body, status = 200, ct = 'application/json') => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: () => ct },
      json: async () => JSON.parse(body), text: async () => body,
    });
    if (auth !== 'Bearer test-token') return json({ error: 'invalid' }, 401);
    if (u.startsWith('https://www.googleapis.com/drive/v3/about')) return json({ user: { emailAddress: 'manager@example.com', displayName: 'Mgr' } });
    if (method === 'GET' && u.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      if (u.includes('alt=media')) return text('{}', 404);
      if (decodeURIComponent(u).includes("name='Otoqol Backups'")) return json({ files: folders.slice() });
      return json({ files: Object.values(files) });
    }
    if (method === 'GET' && /\/files\/[^?]+\\?alt=media/.test(u) || (method === 'GET' && u.includes('alt=media'))) {
      const id = decodeURIComponent(u.split('/files/')[1].split('?')[0]);
      const f = files[id];
      if (!f) return text('missing', 404, 'text/plain');
      return text(f.body, 200, 'application/json');
    }
    if (method === 'POST' && u.startsWith('https://www.googleapis.com/drive/v3/files')) {
      const body = JSON.parse(opts.body || '{}');
      const id = 'fld1';
      folders = [{ id, name: body.name }];
      return json({ id, name: body.name });
    }
    if (method === 'POST' && u.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const id = 'file1';
      files[id] = { id, name: 'otoqol-backup-test.json', modifiedTime: '2026-11-26T09:00:00.000Z', size: '12', body: JSON.stringify({ candidates: [], settings: { school: 'Demo' } }) };
      return json({ id, name: files[id].name, modifiedTime: files[id].modifiedTime });
    }
    return json({ error: 'unexpected ' + method + ' ' + u }, 500);
  };

  const user = await Drive.getUser('test-token');
  t('getUser reads email', user.email === 'manager@example.com');

  const folder = await Drive.ensureFolder('test-token');
  t('ensureFolder creates Otoqol Backups', folder && folder.name === 'Otoqol Backups' && folder.id === 'fld1');
  const folder2 = await Drive.ensureFolder('test-token');
  t('ensureFolder reuses the existing folder', folder2.id === 'fld1');

  const up = await Drive.uploadBackup('test-token', { candidates: [], settings: { school: 'Demo' } }, new Date('2026-11-26T09:07:00'));
  t('uploadBackup returns a file in the folder', !!(up.file && up.file.id === 'file1' && up.name === 'otoqol-backup-2026-11-26-0907.json' && up.folder.id === 'fld1'));

  const list = await Drive.listBackups('test-token');
  t('listBackups returns uploaded files', list.files.some(f => f.id === 'file1'));

  const data = await Drive.downloadBackup('test-token', 'file1');
  t('downloadBackup parses the JSON backup', Array.isArray(data.candidates) && data.settings.school === 'Demo');

  let unauth = false;
  try { await Drive.getUser('wrong'); } catch (e) { unauth = e.code === 'unauthorized'; }
  t('401 becomes unauthorized', unauth);

  // bad backup payload
  files.file1.body = '{"nope":true}';
  let inv = false;
  try { await Drive.downloadBackup('test-token', 'file1'); } catch (e) { inv = e.message === 'invalid'; }
  t('downloadBackup rejects an invalid backup file', inv);

  global.fetch = orig;
}

async function waitUp(base, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(base + '/healthz')).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 120));
  }
  return false;
}

function startServer(dir, extraEnv = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'development', HOST: '127.0.0.1',
    DATA_DIR: dir, DB_FILE: path.join(dir, 'otoqol.sqlite'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
    COOKIE_SECURE: 'false',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!',
    DEFAULT_SCHOOL_CODE: 'demo',
    BREVO_API_KEY: '', SMTP_PASS: '', GOOGLE_CLIENT_ID: '',
    ...extraEnv,
  };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let logs = ''; srv.stdout.on('data', d => { logs += d; }); srv.stderr.on('data', d => { logs += d; });
  srv.logs = () => logs;
  return srv;
}
function kill(srv) {
  return new Promise(resolve => {
    if (!srv || srv.killed) return resolve();
    srv.on('exit', () => resolve());
    srv.kill('SIGTERM');
    setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} }, 2000);
  });
}

async function apiTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-drive-api-'));
  const PORT = Number(process.env.DRIVE_API_PORT || 4330);
  const B = 'http://127.0.0.1:' + PORT;
  const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
  const srv = startServer(dir, { PORT: String(PORT), GOOGLE_CLIENT_ID: '' });
  t('api server starts (no client id)', await waitUp(B), srv.logs());
  try {
    const noAuth = await fetch(B + '/api/config');
    t('/api/config without session -> 401', noAuth.status === 401);

    const login = await fetch(B + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
    const ck = (login.headers.get('set-cookie') || '').split(';')[0];
    const cur = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    const data = {
      settings: { school: 'Otoqol Demo', absLimit: 3 },
      users: [
        { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
        { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' },
      ],
      monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
    };
    await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data }) });

    const si = await fetch(B + '/api/signin', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin', password: 'MgrPass1' }) });
    const ck2 = (si.headers.get('set-cookie') || '').split(';')[0];
    const cfg = await (await fetch(B + '/api/config', { headers: { ...H, Cookie: ck2 } })).json();
    t('/api/config with empty env returns empty googleClientId', cfg.googleClientId === '');

    const csp = (await fetch(B + '/app')).headers.get('content-security-policy') || '';
    t('CSP allows Google GIS + Drive API', csp.includes('https://accounts.google.com') && csp.includes('https://www.googleapis.com') && /frame-src[^;]*accounts\.google\.com/.test(csp));
    const js = await (await fetch(B + '/assets/otoqol-drive.js')).text();
    t('/assets/otoqol-drive.js is served (not the SPA)', js.includes('Otoqol Backups') && !js.includes('<html'));
  } finally { await kill(srv); }

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-drive-api2-'));
  const PORT2 = PORT + 1, B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), GOOGLE_CLIENT_ID: '  1234567890-abc.apps.googleusercontent.com  ' });
  t('api server starts (with client id)', await waitUp(B2), srv2.logs());
  try {
    const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
    const login = await fetch(B2 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
    const ck = (login.headers.get('set-cookie') || '').split(';')[0];
    const cur = await (await fetch(B2 + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    await fetch(B2 + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data: {
      settings: { school: 'Otoqol Demo', absLimit: 3 },
      users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' }],
      monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
    } }) });
    const si = await fetch(B2 + '/api/signin', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin', password: 'MgrPass1' }) });
    const ck2 = (si.headers.get('set-cookie') || '').split(';')[0];
    const cfg = await (await fetch(B2 + '/api/config', { headers: { ...H, Cookie: ck2 } })).json();
    t('/api/config trims and returns the client id', cfg.googleClientId === '1234567890-abc.apps.googleusercontent.com');
  } finally { await kill(srv2); }
}

async function uiTests() {
  let pw;
  try { pw = require('playwright-core'); } catch (e1) {
    try { pw = require('/tmp/pw/node_modules/playwright-core'); } catch (e2) {
      pw = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
    }
  }
  const OUT = process.env.DRIVE_SHOT_DIR || '/tmp/oq-drive-shots';
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-drive-ui-'));
  const PORT = Number(process.env.DRIVE_UI_PORT || 4332);
  const B = 'http://127.0.0.1:' + PORT;
  const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
  const seed = () => ({
    settings: { school: 'Otoqol Demo', absLimit: 3 },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' },
    ],
    monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
  });
  async function seedSchool(base) {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
    const ck = (login.headers.get('set-cookie') || '').split(';')[0];
    const cur = await (await fetch(base + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    await fetch(base + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data: seed() }) });
  }
  async function signIn(page, base, user, pass) {
    await page.goto(base + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-signin]', { timeout: 15000 });
    await page.fill('input[name="username"]', user);
    await page.fill('input[name="password"]', pass);
    await page.click('button.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
  }
  async function openSettings(page) {
    await page.getByText('الإعدادات', { exact: false }).first().click();
    await page.waitForTimeout(300);
  }

  const srv = startServer(dir, { PORT: String(PORT), GOOGLE_CLIENT_ID: '' });
  t('ui server starts (unconfigured)', await waitUp(B), srv.logs());
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    await seedSchool(B);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
    await signIn(page, B, 'admin', 'MgrPass1');
    t('manager reaches the app', !!(await page.$('.nav')));
    await openSettings(page);
    const download = await page.$('[data-oq-backup-download]');
    const restoreFile = await page.$('[data-oq-backup-restore-file]');
    const unconf = await page.$('[data-oq-drive="unconfigured"]');
    const unconfText = unconf ? (await unconf.innerText()).trim() : '';
    t('existing JSON backup/restore buttons still present', !!(download && restoreFile));
    t('unconfigured Drive message is shown (MSA)', !!(unconf && unconfText === 'ربط Google Drive غير مضبوط بعد.'));
    t('Connect button is hidden when not configured', !(await page.$('[data-oq-drive-connect]')));
    await page.locator('.card', { hasText: 'النسخ الاحتياطي' }).screenshot({ path: path.join(OUT, 'settings-backup-unconfigured-ar.png') });

    // secretary must not see the backup card (AdminSettings is manager-only)
    await page.click('[data-oq-logout]');
    await page.waitForSelector('[data-oq-signin]', { timeout: 15000 });
    await signIn(page, B, 'secretary', 'SecPass1');
    await openSettings(page);
    t('secretary does not see Drive or JSON backup controls', !(await page.$('[data-oq-drive]')) && !(await page.$('[data-oq-backup-download]')));
  } finally {
    await kill(srv);
  }

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-drive-ui2-'));
  const PORT2 = PORT + 1, B2 = 'http://127.0.0.1:' + PORT2;
  const srv2 = startServer(dir2, { PORT: String(PORT2), GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com' });
  t('ui server starts (configured)', await waitUp(B2), srv2.logs());
  try {
    await seedSchool(B2);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
    await signIn(page, B2, 'admin', 'MgrPass1');
    await openSettings(page);
    const ready = await page.$('[data-oq-drive="ready"]');
    const connect = await page.$('[data-oq-drive-connect]');
    t('Connect Google Drive is shown when client id is set', !!(ready && connect));
    t('unconfigured message is hidden when client id is set', !(await page.$('[data-oq-drive="unconfigured"]')));
    t('JSON backup buttons still present when Drive is configured', !!(await page.$('[data-oq-backup-download]')) && !!(await page.$('[data-oq-backup-restore-file]')));
    await page.locator('.card', { hasText: 'النسخ الاحتياطي' }).screenshot({ path: path.join(OUT, 'settings-backup-ready-ar.png') });
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    await kill(srv2);
  }
}

(async () => {
  unitTests();
  await mockDriveTests();
  await apiTests();
  await uiTests();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
