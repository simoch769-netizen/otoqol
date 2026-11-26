'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const store = require('./db');
const mail = require('./mail');
const onboard = require('./onboard');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';
const MAX_BODY = process.env.MAX_BODY || '15mb';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (PROD) { console.error('JWT_SECRET is required in production'); process.exit(1); }
  // dev: a random secret kept next to the DB (never a predictable one)
  const f = path.join(store.DATA_DIR, '.jwt_secret');
  try { JWT_SECRET = require('fs').readFileSync(f, 'utf8').trim(); } catch (e) {}
  if (!JWT_SECRET || JWT_SECRET.length < 32) { JWT_SECRET = crypto.randomBytes(48).toString('hex'); require('fs').writeFileSync(f, JWT_SECRET, { mode: 0o600 }); }
  console.warn('[warn] JWT_SECRET not set — using a random dev secret from ' + f);
} else if (JWT_SECRET.length < 32) console.warn('[warn] JWT_SECRET is short; use at least 32 random characters');
const COOKIE = 'otq_sess';
const bcrypt = require('bcryptjs');
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);
const PW_ROUNDS = 10;

const app = express();
app.disable('x-powered-by');
// "1" must be the NUMBER 1 (= trust one proxy hop, e.g. Railway's edge). As a string Express reads it as an IP address,
// so every visitor looked like the proxy and shared one rate-limit bucket.
const TP = process.env.TRUST_PROXY;
if (TP) app.set('trust proxy', TP === 'true' ? 1 : /^\d+$/.test(TP) ? Number(TP) : TP);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // The app uses React UMD + Babel standalone from unpkg (in-browser JSX => needs unsafe-eval/inline)
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://unpkg.com', 'https://accounts.google.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'", 'https://accounts.google.com', 'https://www.googleapis.com', 'https://oauth2.googleapis.com'],
      'frame-src': ["'self'", 'https://accounts.google.com'],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  strictTransportSecurity: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'); next(); });
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || CORS_ORIGINS.includes(origin)),
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: MAX_BODY }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_PER_MIN || 240), standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, skipSuccessfulRequests: true, limit: Number(process.env.LOGIN_PER_15MIN || 10), standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'too_many_attempts' } });
// second limiter per account (username), across all IPs: slows distributed guessing of short in-app passwords
const accountLimiter = rateLimit({ windowMs: 15 * 60_000, skipSuccessfulRequests: true, limit: Number(process.env.LOGIN_PER_ACCOUNT_15MIN || 30), standardHeaders: false, legacyHeaders: false,
  keyGenerator: req => 'acct:' + String((req.body && req.body.school) || '').trim().toLowerCase().slice(0, 40) + ':' + String((req.body && (req.body.username || req.body.school)) || '').trim().toLowerCase().slice(0, 100),
  validate: { keyGeneratorIpFallback: false }, message: { error: 'too_many_attempts' } });
app.use('/api', apiLimiter);

// CSRF guard: every state-changing /api call must carry this header (browsers can't send it cross-site without CORS approval)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Otoqol') !== '1' && !req.get('Authorization')) return res.status(403).json({ error: 'missing_header' });
  next();
});

const JWT_OPTS = { algorithm: 'HS256', issuer: 'otoqol', audience: 'otoqol-app' };
/** Issue a token + a server-side session row (so logout really ends it). */
function sign(s, u) {
  const jti = crypto.randomBytes(18).toString('base64url');
  store.addSession(jti, s.id, Date.now() + SESSION_DAYS * 864e5);
  return jwt.sign(u ? { sid: s.id, gen: s.token_gen, u } : { sid: s.id, gen: s.token_gen }, JWT_SECRET, { ...JWT_OPTS, expiresIn: SESSION_DAYS + 'd', jwtid: jti });
}
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: PROD && process.env.COOKIE_SECURE !== 'false', maxAge: SESSION_DAYS * 864e5, path: '/' };
const clearCookie = res => res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
const tokenOf = req => { const h = req.get('Authorization') || ''; return req.cookies[COOKIE] || (h.startsWith('Bearer ') ? h.slice(7) : ''); };
const verifyTok = tok => jwt.verify(tok, JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });

function auth(req, res, next) {
  const tok = tokenOf(req);
  if (!tok) return res.status(401).json({ error: 'not_logged_in' });
  let p;
  try { p = verifyTok(tok); } catch (e) { return res.status(401).json({ error: 'bad_session' }); }
  if (!p.jti || !store.hasSession(p.jti)) { clearCookie(res); return res.status(401).json({ error: 'session_revoked' }); }
  const s = store.getSchoolById(p.sid);
  if (!s || s.token_gen !== p.gen) { clearCookie(res); return res.status(401).json({ error: 'session_revoked' }); }
  if (!s.active) return res.status(403).json({ error: 'school_inactive' });
  req.school = s; req.jti = p.jti; req.appUser = p.u || null;
  // the app user must still exist with the same password; its CURRENT role is used (not the one in the token)
  if (req.appUser) {
    const cur = currentAppUser(cachedData(s.id), req.appUser);
    if (!cur) { store.delSession(p.jti); clearCookie(res); return res.status(401).json({ error: 'user_changed' }); }
    req.role = cur.role;
  } else req.role = 'owner'; // legacy /api/login session = school password = owner
  next();
}
const pub = s => ({ id: s.id, code: s.code, name: s.name });

// ---------- school auth ----------
app.post('/api/login', loginLimiter, (req, res) => {
  const { school, password } = req.body || {};
  if (typeof school !== 'string' || typeof password !== 'string' || school.length > 100 || password.length > 200)
    return res.status(400).json({ error: 'bad_request' });
  const s = store.findSchool(school);
  // always run bcrypt to keep timing similar
  const ok = s ? store.checkPassword(s, password) : (store.checkPassword({ password_hash: DUMMY_HASH }, password), false);
  if (!s || !ok) return res.status(401).json({ error: 'bad_credentials' });
  const blocked = onboard.statusError(s, store);
  if (blocked) return res.status(403).json({ error: blocked });
  const token = sign(s, null);
  res.cookie(COOKIE, token, cookieOpts);
  res.json({ school: pub(s), token: req.body.wantToken ? token : undefined });
});
// ---------- single sign-in: school code + in-app username/password ----------
// Same normalisation as the app's own login(): trim, Arabic-Indic digits -> 0-9, username case-insensitive.
const nz = v => String(v == null ? '' : v).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const pwTag = stored => crypto.createHash('sha256').update('otq:' + String(stored == null ? '' : stored)).digest('base64url').slice(0, 12);
const isOff = x => x && (x.active === false || x.disabled === true);
const isHash = v => typeof v === 'string' && /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(v);
// bcrypt results are memoised (hash + typed password) so a burst of requests doesn't block the event loop
const memo = new Map();
function pwMatches(stored, typed) {
  const t = nz(typed);
  if (!isHash(stored)) return nz(stored) === t && t !== '';             // legacy plain text (migrated on sign-in)
  const k = crypto.createHash('sha256').update(stored + '\0' + t).digest('base64');
  if (memo.has(k)) return memo.get(k);
  const ok = bcrypt.compareSync(t, stored);
  if (memo.size > 5000) memo.clear(); memo.set(k, ok); return ok;
}
const hashPw = plain => bcrypt.hashSync(nz(plain), PW_ROUNDS);
function parseData(schoolId) {
  const d = store.getData(schoolId);
  if (!d || d.data == null) return null;
  try { return JSON.parse(d.data); } catch (e) { return null; }
}
// parsed data cached per school and version (only re-read when the version changes)
const dataCache = new Map();
function cachedData(schoolId) {
  const v = store.getVersion(schoolId); if (!v) return null;
  const c = dataCache.get(schoolId);
  if (c && c.version === v.version) return c.data;
  const data = v.empty ? null : parseData(schoolId);
  dataCache.set(schoolId, { version: v.version, data }); return data;
}
/** Find the in-app account the app itself would accept (users first, then monitors). */
function findAppUser(data, username, password) {
  if (!data) return null;
  const un = nz(username).toLowerCase();
  const pick = (list, role) => {
    const x = (list || []).find(y => y && typeof y === 'object' && nz(y.username).toLowerCase() === un && !isOff(y));
    return x ? { rec: x, role: role || x.role } : null;
  };
  const cands = [pick(data.users), pick(data.monitors, 'monitor')].filter(Boolean);
  for (const c of cands) if (pwMatches(c.rec.password, password)) return { id: c.rec.id, name: c.rec.name, role: c.role, rec: c.rec };
  if (!cands.length) bcrypt.compareSync(nz(password), DUMMY_HASH); // same cost whether the username exists or not
  return null;
}
const hasUsername = (data, un) => !!data && [...(data.users || []), ...(data.monitors || [])].some(x => x && nz(x.username).toLowerCase() === un);
/** The session's app user as it is NOW in the data (null if removed, disabled or password changed). */
function currentAppUser(data, u) {
  if (!data) return u.id === 'u1' && u.owner ? { role: 'manager' } : null;  // fresh school: only the setup owner
  const list = u.role === 'monitor' ? (data.monitors || []) : (data.users || []);
  const x = list.find(y => y && y.id === u.id);
  if (!x || isOff(x)) return null;
  if (!u.owner && pwTag(x.password) !== u.tag) return null;
  return { role: u.role === 'monitor' ? 'monitor' : (x.role || 'secretary') };
}
/** Hash every plain-text in-app password; keep stored hashes for blank/unchanged ones. Returns true if something changed. */
function securePasswords(data, stored) {
  let changed = false;
  for (const k of ['users', 'monitors']) {
    const old = new Map(((stored && stored[k]) || []).filter(x => x && typeof x === 'object').map(x => [x.id, x]));
    for (const x of (data[k] || [])) {
      if (!x || typeof x !== 'object') continue;
      const o = old.get(x.id);
      const pw = x.password;
      if (pw == null || pw === '') { if (o && o.password) { x.password = o.password; } continue; }   // blank = unchanged
      if (typeof pw !== 'string') { x.password = String(pw); }
      if (isHash(x.password)) continue;
      if (o && isHash(o.password) && pwMatches(o.password, x.password)) { x.password = o.password; continue; } // same password, keep hash
      x.password = hashPw(x.password); changed = true;
    }
  }
  return changed;
}
const redact = data => {
  if (!data) return data;
  const strip = list => Array.isArray(list) ? list.map(x => (x && typeof x === 'object') ? { ...x, password: '' } : x) : list;
  return { ...data, users: strip(data.users), monitors: strip(data.monitors) };
};
/** The deployment's school: DEFAULT_SCHOOL_CODE, else SEED_SCHOOL_CODE, else the first active school. */
function defaultSchool() {
  const code = process.env.DEFAULT_SCHOOL_CODE || process.env.SEED_SCHOOL_CODE;
  if (code) return store.findSchool(code);
  return store.db.prepare('SELECT * FROM schools WHERE active = 1 ORDER BY id LIMIT 1').get();
}
const pubUser = u => u && ({ id: u.id, name: u.name, role: u.role });

app.post('/api/signin', loginLimiter, accountLimiter, (req, res) => {
  const { school, username, password } = req.body || {};
  // `school` is optional: empty / omitted uses this deployment's default school (DEFAULT_SCHOOL_CODE / first active).
  if ((school !== undefined && school !== null && typeof school !== 'string') || typeof username !== 'string' || typeof password !== 'string' ||
      !username.trim() || !password || (school && school.length > 100) || username.length > 100 || password.length > 200)
    return res.status(400).json({ error: 'bad_request' });
  const s = school && school.trim() ? store.findSchool(school) : defaultSchool();
  if (!s) { store.checkPassword({ password_hash: DUMMY_HASH }, password); return res.status(401).json({ error: 'bad_credentials' }); }
  const blocked = onboard.statusError(s, store);
  if (blocked) { store.checkPassword({ password_hash: DUMMY_HASH }, password); return res.status(403).json({ error: blocked }); }
  let data = parseData(s.id);
  let user = findAppUser(data, username, password), setup = false;
  // one-time migration: plain-text in-app passwords -> bcrypt (the app keeps working, passwords are no longer readable)
  if (user && !isHash(user.rec.password)) {
    const cur = store.getData(s.id);
    if (securePasswords(data, JSON.parse(cur.data))) store.putData(s.id, null, JSON.stringify(data), 'before-password-hashing');
    data = parseData(s.id); user = findAppUser(data, username, password);
    if (!user) return res.status(500).json({ error: 'server_error' });
  }
  if (user) user = { id: user.id, name: user.name, role: user.role, tag: pwTag(user.rec.password) };
  // Owner fallback: username "admin" + the SCHOOL password, only while no in-app account is called "admin"
  // (fresh school, or the admin account was renamed/deleted). Logs in as the first manager (or the default u1 on a fresh school).
  if (!user && nz(username).toLowerCase() === 'admin' && !hasUsername(data, 'admin') && store.checkPassword(s, password)) {
    if (!data) { user = { id: 'u1', name: 'المدير', role: 'manager', owner: true }; setup = true; }
    else { const m = (data.users || []).find(x => x && x.role === 'manager' && !isOff(x)); if (m) user = { id: m.id, name: m.name, role: 'manager', owner: true }; }
  }
  if (!user) return res.status(401).json({ error: 'bad_credentials' });
  res.cookie(COOKIE, sign(s, user), cookieOpts);
  res.json({ school: pub(s), user: pubUser(user), setup });
});


const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const normEmail = v => String(v == null ? '' : v).trim();
function validEmail(v) {
  const e = normEmail(v);
  if (!e) return true;
  return e.length <= 120 && EMAIL_RE.test(e);
}
/** Optional email on staff / monitors. Empty is cleared; invalid format rejects the whole write. */
function sanitizeEmails(data) {
  for (const k of ['users', 'monitors']) {
    for (const x of (data[k] || [])) {
      if (!x || typeof x !== 'object') continue;
      if (x.email == null || x.email === '') { delete x.email; continue; }
      if (typeof x.email !== 'string' || !validEmail(x.email)) return false;
      x.email = normEmail(x.email);
    }
  }
  return true;
}
/** Find an in-app account by username only (users first, then monitors). Skips disabled accounts. */
function findAccountByUsername(data, username) {
  if (!data) return null;
  const un = nz(username).toLowerCase();
  const pick = (list, role) => {
    const x = (list || []).find(y => y && typeof y === 'object' && nz(y.username).toLowerCase() === un && !isOff(y));
    return x ? { rec: x, role: role || x.role } : null;
  };
  return pick(data.users) || pick(data.monitors, 'monitor');
}

const RESET_TTL_MS = Number(process.env.RESET_CODE_TTL_MS || 15 * 60_000);
const RESET_MAX_ATTEMPTS = Number(process.env.RESET_MAX_ATTEMPTS || 5);
const resetCodes = new Map(); // key: schoolId + ':' + usernameLower
const hashResetCode = code => crypto.createHash('sha256').update('otq-reset:' + JWT_SECRET + ':' + String(code)).digest('hex');
function resetKey(schoolId, username) { return String(schoolId) + ':' + nz(username).toLowerCase(); }
function purgeResetCodes() {
  const now = Date.now();
  for (const [k, v] of resetCodes) if (!v || v.expires <= now) resetCodes.delete(k);
}
setInterval(purgeResetCodes, 60_000).unref();

function genResetCode() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); }
function storeResetCode(schoolId, username, meta) {
  const code = genResetCode();
  resetCodes.set(resetKey(schoolId, username), {
    hash: hashResetCode(code),
    expires: Date.now() + RESET_TTL_MS,
    attempts: 0,
    userId: meta.userId,
    role: meta.role,
  });
  return code;
}
function takeResetCode(schoolId, username, code) {
  purgeResetCodes();
  const key = resetKey(schoolId, username);
  const rec = resetCodes.get(key);
  if (!rec || rec.expires <= Date.now()) { resetCodes.delete(key); return { ok: false }; }
  rec.attempts += 1;
  const typed = nz(code);
  const match = typed.length === 6 && /^\d{6}$/.test(typed)
    && crypto.timingSafeEqual(Buffer.from(rec.hash, 'hex'), Buffer.from(hashResetCode(typed), 'hex'));
  if (!match) {
    if (rec.attempts >= RESET_MAX_ATTEMPTS) resetCodes.delete(key);
    return { ok: false };
  }
  resetCodes.delete(key);
  return { ok: true, userId: rec.userId, role: rec.role };
}
function updateAccountPassword(schoolId, role, userId, hashed) {
  for (let i = 0; i < 5; i++) {
    const cur = store.getData(schoolId);
    if (!cur || cur.data == null) return false;
    const data = JSON.parse(cur.data);
    const list = role === 'monitor' ? data.monitors : data.users;
    const rec = (list || []).find(x => x && x.id === userId);
    if (!rec || isOff(rec)) return false;
    rec.password = hashed;
    const r = store.putData(schoolId, cur.version, JSON.stringify(data), 'password-reset');
    if (r.ok) { dataCache.delete(schoolId); bodyCache.delete(schoolId); return true; }
  }
  return false;
}

const forgotIpLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: Number(process.env.FORGOT_PER_15MIN || 5),
  standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
});
const forgotAccountLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: Number(process.env.FORGOT_PER_ACCOUNT_15MIN || 3),
  keyGenerator: req => 'fp:' + String((req.body && req.body.school) || '').trim().toLowerCase().slice(0, 40) + ':' + String((req.body && req.body.username) || '').trim().toLowerCase().slice(0, 100),
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: false, legacyHeaders: false, message: { error: 'too_many_attempts' },
});
const resetIpLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: Number(process.env.RESET_PER_15MIN || 10),
  standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
});

const forgotGeneric = (res) => res.json({ ok: true });

app.post('/api/forgot-password', forgotIpLimiter, forgotAccountLimiter, async (req, res) => {
  const { school, username } = req.body || {};
  if ((school !== undefined && school !== null && typeof school !== 'string') || typeof username !== 'string' ||
      !username.trim() || (school && school.length > 100) || username.length > 100)
    return res.status(400).json({ error: 'bad_request' });
  const s = school && school.trim() ? store.findSchool(school) : defaultSchool();
  // Always spend a comparable amount of work, then return the same payload.
  const dummy = hashResetCode(genResetCode());
  void dummy;
  if (!s || !s.active) return forgotGeneric(res);
  const data = parseData(s.id);
  const acc = findAccountByUsername(data, username);
  const email = acc ? normEmail(acc.rec.email) : '';
  if (!acc || !email || !validEmail(email) || email === '') return forgotGeneric(res);
  if (!mail.isConfigured()) {
    console.warn('[mail] mail not configured — password reset email not sent');
    return forgotGeneric(res);
  }
  const code = storeResetCode(s.id, username, { userId: acc.rec.id, role: acc.role });
  // Respond immediately; a blocked SMTP/API must not stall the login screen.
  // sendResetEmail itself has a ~10s timeout so background work cannot hang forever.
  void mail.sendResetEmail({ to: email, code }).catch((e) => {
    console.error('[mail] forgot-password send error:', e && e.message);
  });
  return forgotGeneric(res);
});

app.post('/api/reset-password', resetIpLimiter, (req, res) => {
  const { school, username, code, password } = req.body || {};
  if ((school !== undefined && school !== null && typeof school !== 'string') || typeof username !== 'string' ||
      typeof code !== 'string' || typeof password !== 'string' ||
      !username.trim() || (school && school.length > 100) || username.length > 100 || code.length > 20 || password.length > 200)
    return res.status(400).json({ error: 'bad_request' });
  const pw = nz(password);
  if (pw.length < 4) return res.status(400).json({ error: 'weak_password' });
  const s = school && school.trim() ? store.findSchool(school) : defaultSchool();
  if (!s || !s.active) return res.status(400).json({ error: 'invalid_code' });
  const got = takeResetCode(s.id, username, code);
  if (!got.ok) return res.status(400).json({ error: 'invalid_code' });
  const hashed = hashPw(pw);
  if (!updateAccountPassword(s.id, got.role, got.userId, hashed))
    return res.status(400).json({ error: 'invalid_code' });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  // end the session on the server too (a copied token stops working)
  try { const p = verifyTok(tokenOf(req)); if (p.jti) store.delSession(p.jti); } catch (e) {}
  clearCookie(res); res.json({ ok: true });
});
app.get('/api/config', auth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ googleClientId: String(process.env.GOOGLE_CLIENT_ID || '').trim() });
});
app.get('/api/me', auth, (req, res) => {

  const d = store.getVersion(req.school.id);
  const u = req.appUser && { ...pubUser(req.appUser), role: req.role };
  res.set('Cache-Control', 'no-store');
  res.json({ school: pub(req.school), user: u || null, version: d.version, empty: !!d.empty, updated_at: d.updated_at });
});

// ---------- data ----------
// passwords never leave the server (blank = unchanged when the app sends the data back).
// The redacted JSON is built once per data version and reused (many devices poll the same school).
const bodyCache = new Map();
app.get('/api/db', auth, (req, res) => {
  const v = store.getVersion(req.school.id);
  let c = bodyCache.get(req.school.id);
  if (!c || c.version !== v.version) {
    const d = store.getData(req.school.id);
    c = { version: d.version, body: JSON.stringify({ version: d.version, updated_at: d.updated_at, data: d.data == null ? null : redact(JSON.parse(d.data)) }) };
    bodyCache.set(req.school.id, c);
  }
  res.set('Cache-Control', 'no-store'); res.type('application/json').send(c.body);
});
app.get('/api/db/version', auth, (req, res) => {
  const d = store.getVersion(req.school.id);
  res.set('Cache-Control', 'no-store');
  res.json({ version: d.version, updated_at: d.updated_at });
});
function validDB(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  for (const k of ['users', 'monitors', 'vehicles', 'candidates', 'sessions', 'payments', 'expenses', 'notifs', 'requests', 'notes', 'log'])
    if (o[k] !== undefined && !Array.isArray(o[k])) return false;
  if (o.settings !== undefined && (!o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings))) return false;
  return Array.isArray(o.candidates) && Array.isArray(o.users);
}
// What each role may NOT change through the API (same limits as the app's screens): taken from the stored copy.
const LOCKED = { secretary: ['users', 'monitors', 'settings'], monitor: ['users', 'monitors', 'settings', 'vehicles', 'payments', 'expenses'] };
app.put('/api/db', auth, (req, res) => {
  const { version, data } = req.body || {};
  if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'version_required' });
  if (!validDB(data)) return res.status(400).json({ error: 'invalid_data' });
  const cur = store.getData(req.school.id);
  if (cur.version !== version) return res.status(409).json({ error: 'version_conflict', version: cur.version });
  const stored = cur.data == null ? null : JSON.parse(cur.data);
  const locked = (req.role === 'manager' || req.role === 'owner') ? null : (LOCKED[req.role] || LOCKED.monitor);
  if (locked) {
    if (!stored) return res.status(403).json({ error: 'forbidden' });
    for (const k of locked) { if (stored[k] === undefined) delete data[k]; else data[k] = stored[k]; }
  }
  securePasswords(data, stored);
  if (!sanitizeEmails(data)) return res.status(400).json({ error: 'invalid_email' });
  const r = store.putData(req.school.id, version, JSON.stringify(data), 'auto');
  if (!r.ok) return res.status(409).json({ error: 'version_conflict', version: r.version });
  // the signed-in user changed their own password: keep them signed in with a fresh session
  if (req.appUser && !req.appUser.owner) {
    const list = req.appUser.role === 'monitor' ? data.monitors : data.users;
    const me = (list || []).find(x => x && x.id === req.appUser.id);
    if (me && pwTag(me.password) !== req.appUser.tag) {
      store.delSession(req.jti);
      res.cookie(COOKIE, sign(req.school, { ...req.appUser, tag: pwTag(me.password) }), cookieOpts);
    }
  }
  res.json({ ok: true, version: r.version });
});

// ---------- admin (Bearer ADMIN_TOKEN) ----------
const admin = express.Router();
admin.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
admin.use(rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: false, legacyHeaders: false,
  requestWasSuccessful: (req, res) => res.statusCode !== 401, message: { error: 'too_many_attempts' } }));
admin.use((req, res, next) => {
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 16) return res.status(404).json({ error: 'admin_disabled' });
  const h = req.get('Authorization') || '';
  const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const exp = Buffer.from(ADMIN_TOKEN);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return res.status(401).json({ error: 'unauthorized' });
  next();
});
const wrap = fn => (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(fn(req)); } catch (e) {
  // our own validation messages are fine to show; database internals are not
  const msg = /^SQLITE|constraint|sql/i.test(e.code || '') || /constraint|sqlite/i.test(e.message) ? (/UNIQUE/i.test(e.message) ? 'already_exists' : 'bad_request') : e.message;
  res.status(400).json({ error: msg }); } };
const need = ident => { const s = store.findSchool(ident); if (!s) throw new Error('school not found'); return s; };
admin.get('/schools', wrap(() => store.listSchools()));
admin.post('/schools', wrap(req => store.createSchool(req.body || {})));
admin.post('/schools/:code/password', wrap(req => store.setPassword(req.params.code, (req.body || {}).password)));
admin.post('/schools/:code/active', wrap(req => store.setActive(req.params.code, !!(req.body || {}).active)));
admin.get('/schools/:code/export', wrap(req => { const s = need(req.params.code); const d = store.getData(s.id); return { school: pub(s), version: d.version, data: d.data && JSON.parse(d.data) }; }));
admin.put('/schools/:code/import', wrap(req => {
  const s = need(req.params.code); const data = (req.body || {}).data;
  if (!validDB(data)) throw new Error('invalid_data');
  const cur = store.getData(s.id); securePasswords(data, cur.data == null ? null : JSON.parse(cur.data));
  if (!sanitizeEmails(data)) throw new Error('invalid_email');
  return store.putData(s.id, null, JSON.stringify(data), 'before-admin-import');
}));
admin.get('/schools/:code/history', wrap(req => store.listHistory(need(req.params.code).id)));
admin.post('/schools/:code/restore/:hid', wrap(req => {
  const s = need(req.params.code); const h = store.getHistory(s.id, Number(req.params.hid));
  if (!h) throw new Error('snapshot not found');
  return store.putData(s.id, null, h.data, 'before-restore');
}));
app.use('/api/admin', admin);

app.get('/healthz', (req, res) => res.json({ ok: true }));
onboard.install(app, { store, mail, hashPw, JWT_SECRET, JWT_OPTS, cookieOpts, PROD });

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
const PUBLIC = path.join(__dirname, '..', 'public');
// the app lives at /app (any /app/... path too, so a refresh never 404s); the landing page is /
const sendApp = (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(PUBLIC, 'app', 'index.html')); };
app.get(['/app', '/app/', '/app/{*rest}'], sendApp);
const sendPage = file => (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(PUBLIC, file)); };
app.get(['/signup', '/signup/'], sendPage('signup.html'));
app.get(['/owner', '/owner/'], sendPage('owner.html'));
app.use(express.static(PUBLIC, { index: 'index.html', maxAge: 0, redirect: false }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'bad_request' });
  console.error(err); res.status(500).json({ error: 'server_error' });
});

// First-run seed (handy on Render where there is no shell): creates one school on boot if it doesn't exist yet.
function seedSchool() {
  const code = process.env.SEED_SCHOOL_CODE, pass = process.env.SEED_SCHOOL_PASSWORD;
  if (!code || !pass) return;
  try {
    if (store.findSchool(code)) return console.log(`[seed] school "${code}" already exists`);
    const s = store.createSchool({ code, name: process.env.SEED_SCHOOL_NAME || code, password: pass });
    console.log(`[seed] created school "${s.code}" (licence ${s.licence_key})`);
  } catch (e) { console.error('[seed] failed: ' + e.message); }
}

if (require.main === module) { seedSchool(); store.purgeSessions(); setInterval(() => { try { store.purgeSessions(); } catch (e) {} }, 3600e3).unref(); app.listen(PORT, HOST, () => console.log(`Otoqol backend on http://${HOST}:${PORT}  (db: ${store.DB_FILE})`)); }
module.exports = app;
