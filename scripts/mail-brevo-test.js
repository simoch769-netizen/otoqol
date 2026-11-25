// Brevo HTTPS path + non-blocking forgot-password. Uses a mock fetch (no real API calls).
// node scripts/mail-brevo-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

function freshMail() {
  // Reload after mutating process.env so isConfigured / hasBrevo see current values.
  delete require.cache[require.resolve('../src/mail')];
  return require('../src/mail');
}

function clearMailEnv() {
  delete process.env.BREVO_API_KEY;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_CAPTURE_FILE;
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_TIMEOUT_MS;
}

async function unitTests() {
  const origFetch = global.fetch;

  clearMailEnv();
  let mail = freshMail();
  t('isConfigured false when no key and no SMTP', mail.isConfigured() === false);
  t('default sender is Otoqol / contact.otoqol@gmail.com', (() => {
    const s = mail.senderFrom();
    return s.name === 'Otoqol' && s.email === 'contact.otoqol@gmail.com';
  })());

  process.env.MAIL_FROM = 'Otoqol <contact.otoqol@gmail.com>';
  mail = freshMail();
  t('MAIL_FROM parses to Otoqol + contact.otoqol@gmail.com', (() => {
    const s = mail.senderFrom();
    return s.name === 'Otoqol' && s.email === 'contact.otoqol@gmail.com';
  })());

  process.env.BREVO_API_KEY = 'test-brevo-key';
  mail = freshMail();
  t('isConfigured true when BREVO_API_KEY is set', mail.isConfigured() === true);

  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 201, text: async () => '{"messageId":"mock"}' };
  };
  const sent = await mail.sendResetEmail({ to: 'admin@example.com', code: '123456' });
  t('Brevo path returns sent:true via brevo', sent.sent === true && sent.via === 'brevo');
  t('POST https://api.brevo.com/v3/smtp/email', captured && captured.url === mail.BREVO_URL && captured.opts.method === 'POST');
  t('api-key header is the env key', captured && captured.opts.headers['api-key'] === 'test-brevo-key');
  const body = captured && JSON.parse(captured.opts.body);
  t('sender name Otoqol and email contact.otoqol@gmail.com', !!(body && body.sender && body.sender.name === 'Otoqol' && body.sender.email === 'contact.otoqol@gmail.com'));
  t('to / subject / htmlContent / textContent present', !!(body && body.to && body.to[0].email === 'admin@example.com' && body.subject && body.htmlContent && body.textContent && body.textContent.includes('123456')));

  // HTTP error
  global.fetch = async () => ({ ok: false, status: 401, text: async () => '{"message":"Key not found"}' });
  const fail = await mail.sendResetEmail({ to: 'admin@example.com', code: '123456' });
  t('Brevo HTTP error returns sent:false without throwing', fail.sent === false && fail.reason === 'send_failed');

  // Timeout: hanging fetch, 200ms budget
  process.env.MAIL_TIMEOUT_MS = '200';
  mail = freshMail();
  let fetchStarted = 0;
  global.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    fetchStarted++;
    const signal = opts && opts.signal;
    const onAbort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
    }
  });
  const t0 = Date.now();
  const timed = await mail.sendResetEmail({ to: 'admin@example.com', code: '654321' });
  const elapsed = Date.now() - t0;
  t('hanging Brevo fetch times out in ~10s budget (200ms here)', timed.sent === false && timed.reason === 'timeout' && elapsed >= 150 && elapsed < 2000, 'elapsed=' + elapsed + 'ms');
  t('hanging fetch was started', fetchStarted === 1);

  // Fallback: no Brevo key, capture SMTP
  delete process.env.BREVO_API_KEY;
  delete process.env.MAIL_TIMEOUT_MS;
  const cap = path.join(os.tmpdir(), 'oq-brevo-cap-' + Date.now() + '.jsonl');
  process.env.SMTP_HOST = 'capture';
  process.env.SMTP_CAPTURE_FILE = cap;
  process.env.SMTP_PASS = 'unused';
  mail = freshMail();
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return { ok: true, status: 200, text: async () => '' }; };
  t('isConfigured true in capture mode without Brevo', mail.isConfigured() === true);
  const capRes = await mail.sendResetEmail({ to: 'karim@example.com', code: '111222' });
  t('without BREVO_API_KEY, uses capture SMTP and does not call fetch', capRes.sent === true && capRes.via === 'capture' && fetchCalled === false);
  const rows = fs.existsSync(cap) ? fs.readFileSync(cap, 'utf8').split('\n').filter(Boolean) : [];
  t('capture file has the message', rows.length === 1 && JSON.parse(rows[0]).to === 'karim@example.com');
  try { fs.unlinkSync(cap); } catch (e) {}

  global.fetch = origFetch;
  clearMailEnv();
}

async function hangEndpointTest() {
  const PORT = Number(process.env.FP_BREVO_PORT || 4310);
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-brevo-hang-'));
  const hook = path.join(DIR, 'fetch-hook.js');
  // Preload: replace global.fetch so the child server never talks to Brevo.
  fs.writeFileSync(hook, `
    const { pathToFileURL } = require('url');
    const hangMs = Number(process.env.MOCK_HANG_MS || 30000);
    global.fetch = (url, opts) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 201, text: async () => '{}' }), hangMs);
      const sig = opts && opts.signal;
      if (sig) {
        const onAbort = () => { clearTimeout(timer); reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); };
        if (sig.aborted) return onAbort();
        sig.addEventListener('abort', onAbort);
      }
    });
  `);
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: DIR,
    DB_FILE: path.join(DIR, 'otoqol.sqlite'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
    COOKIE_SECURE: 'false',
    SEED_SCHOOL_CODE: 'demo',
    SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!',
    DEFAULT_SCHOOL_CODE: 'demo',
    BREVO_API_KEY: 'test-brevo-key',
    MAIL_FROM: 'Otoqol <contact.otoqol@gmail.com>',
    MAIL_TIMEOUT_MS: '8000',
    MOCK_HANG_MS: '30000',
    NODE_OPTIONS: '--require ' + hook,
    FORGOT_PER_15MIN: '20',
    FORGOT_PER_ACCOUNT_15MIN: '10',
  };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  let logs = '';
  srv.stdout.on('data', d => { logs += d; });
  srv.stderr.on('data', d => { logs += d; });
  const B = 'http://127.0.0.1:' + PORT;
  const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
  const t0up = Date.now();
  let up = false;
  while (Date.now() - t0up < 10000) {
    try { if ((await fetch(B + '/healthz')).ok) { up = true; break; } } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  t('hang-test server starts with mock fetch hook', up, logs);
  try {
    const lg = await fetch(B + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ school: 'demo', password: 'SchoolPw2026!' }) });
    const ck = (lg.headers.get('set-cookie') || '').split(';')[0];
    const cur = await (await fetch(B + '/api/db', { headers: { ...H, Cookie: ck } })).json();
    const data = {
      settings: { school: 'Otoqol Demo', absLimit: 3 },
      users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'OldPass1', email: 'admin@example.com' }],
      monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
    };
    await fetch(B + '/api/db', { method: 'PUT', headers: { ...H, Cookie: ck }, body: JSON.stringify({ version: cur.version, data }) });
    const t0 = Date.now();
    const r = await fetch(B + '/api/forgot-password', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin' }) });
    const elapsed = Date.now() - t0;
    const j = await r.json();
    t('forgot-password returns generic 200 quickly while Brevo hangs', r.status === 200 && j.ok === true && elapsed < 1500, 'elapsed=' + elapsed + 'ms');
  } finally {
    await new Promise(resolve => {
      srv.on('exit', () => resolve());
      srv.kill('SIGTERM');
      setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} }, 2000);
    });
  }
}

(async () => {
  await unitTests();
  await hangEndpointTest();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
