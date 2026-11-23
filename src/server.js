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
  JWT_SECRET = 'dev-only-' + crypto.createHash('sha256').update(store.DB_FILE).digest('hex');
  console.warn('[warn] JWT_SECRET not set — using a dev secret. Set it in production!');
}
const COOKIE = 'otq_sess';
const DUMMY_HASH = require('bcryptjs').hashSync('dummy-password', 11);

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // The app uses React UMD + Babel standalone from unpkg (in-browser JSX => needs unsafe-eval/inline)
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://unpkg.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || CORS_ORIGINS.includes(origin)),
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: MAX_BODY }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_PER_MIN || 240), standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, skipSuccessfulRequests: true, limit: Number(process.env.LOGIN_PER_15MIN || 10), standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'too_many_attempts' } });
app.use('/api', apiLimiter);

// CSRF guard: every state-changing /api call must carry this header (browsers can't send it cross-site without CORS approval)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Otoqol') !== '1' && !req.get('Authorization')) return res.status(403).json({ error: 'missing_header' });
  next();
});

const sign = s => jwt.sign({ sid: s.id, gen: s.token_gen }, JWT_SECRET, { expiresIn: SESSION_DAYS + 'd' });
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: PROD && process.env.COOKIE_SECURE !== 'false', maxAge: SESSION_DAYS * 864e5, path: '/' };

function auth(req, res, next) {
  const h = req.get('Authorization') || '';
  const tok = req.cookies[COOKIE] || (h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!tok) return res.status(401).json({ error: 'not_logged_in' });
  try {
    const p = jwt.verify(tok, JWT_SECRET);
    const s = store.getSchoolById(p.sid);
    if (!s || s.token_gen !== p.gen) return res.status(401).json({ error: 'session_revoked' });
    if (!s.active) return res.status(403).json({ error: 'school_inactive' });
    req.school = s; req.appUser = p.u || null; next();
  } catch (e) { return res.status(401).json({ error: 'bad_session' }); }
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
  if (!s.active) return res.status(403).json({ error: 'school_inactive' });
  const token = sign(s);
  res.cookie(COOKIE, token, cookieOpts);
  res.json({ school: pub(s), token: req.body.wantToken ? token : undefined });
});
// ---------- single sign-in: school code + in-app username/password ----------
// Same normalisation as the app's own login(): trim, Arabic-Indic digits -> 0-9, username case-insensitive.
const nz = v => String(v == null ? '' : v).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const pwTag = p => crypto.createHash('sha256').update('otq:' + nz(p)).digest('base64url').slice(0, 12);
const isOff = x => x && (x.active === false || x.disabled === true);
function parseData(schoolId) {
  const d = store.getData(schoolId);
  if (!d || d.data == null) return null;
  try { return JSON.parse(d.data); } catch (e) { return null; }
}
/** Find the in-app account the app itself would accept (users first, then monitors). */
function findAppUser(data, username, password) {
  if (!data) return null;
  const un = nz(username).toLowerCase(), pw = nz(password);
  const a = (data.users || []).find(x => x && nz(x.username).toLowerCase() === un && nz(x.password) === pw && !isOff(x));
  if (a) return { id: a.id, name: a.name, role: a.role, tag: pwTag(a.password) };
  const m = (data.monitors || []).find(x => x && nz(x.username).toLowerCase() === un && nz(x.password) === pw && !isOff(x));
  if (m) return { id: m.id, name: m.name, role: 'monitor', tag: pwTag(m.password) };
  return null;
}
const hasUsername = (data, un) => !!data && [...(data.users || []), ...(data.monitors || [])].some(x => x && nz(x.username).toLowerCase() === un);
/** Is the session's app user still valid (exists, same password, not disabled)? */
function appUserStillValid(data, u) {
  if (!data) return u.id === 'u1';          // fresh school: only the setup owner
  const list = u.role === 'monitor' ? (data.monitors || []) : (data.users || []);
  const x = list.find(y => y && y.id === u.id);
  if (!x || isOff(x)) return false;
  return u.owner ? true : pwTag(x.password) === u.tag;
}
/** The deployment's school: DEFAULT_SCHOOL_CODE, else SEED_SCHOOL_CODE, else the first active school. */
function defaultSchool() {
  const code = process.env.DEFAULT_SCHOOL_CODE || process.env.SEED_SCHOOL_CODE;
  if (code) return store.findSchool(code);
  return store.db.prepare('SELECT * FROM schools WHERE active = 1 ORDER BY id LIMIT 1').get();
}
const signUser = (s, u) => jwt.sign({ sid: s.id, gen: s.token_gen, u }, JWT_SECRET, { expiresIn: SESSION_DAYS + 'd' });
const pubUser = u => u && ({ id: u.id, name: u.name, role: u.role });

app.post('/api/signin', loginLimiter, (req, res) => {
  const { school, username, password } = req.body || {};
  // one install per school: `school` is optional, default = this deployment's school
  if ((school !== undefined && school !== null && typeof school !== 'string') || typeof username !== 'string' || typeof password !== 'string' ||
      !username.trim() || (school && school.length > 100) || username.length > 100 || password.length > 200)
    return res.status(400).json({ error: 'bad_request' });
  const s = school && school.trim() ? store.findSchool(school) : defaultSchool();
  if (!s) { store.checkPassword({ password_hash: DUMMY_HASH }, password); return res.status(401).json({ error: 'bad_credentials' }); }
  const data = parseData(s.id);
  let user = findAppUser(data, username, password), setup = false;
  // Owner fallback: username "admin" + the SCHOOL password, only while no in-app account is called "admin"
  // (fresh school, or the admin account was renamed/deleted). Logs in as the first manager (or the default u1 on a fresh school).
  if (!user && nz(username).toLowerCase() === 'admin' && !hasUsername(data, 'admin') && store.checkPassword(s, password)) {
    if (!data) { user = { id: 'u1', name: 'المدير', role: 'manager', owner: true }; setup = true; }
    else { const m = (data.users || []).find(x => x && x.role === 'manager' && !isOff(x)); if (m) user = { id: m.id, name: m.name, role: 'manager', owner: true }; }
  } else if (!user) store.checkPassword({ password_hash: DUMMY_HASH }, password); // keep timing similar
  if (!user) return res.status(401).json({ error: 'bad_credentials' });
  if (!s.active) return res.status(403).json({ error: 'school_inactive' });
  res.cookie(COOKIE, signUser(s, user), cookieOpts);
  res.json({ school: pub(s), user: pubUser(user), setup });
});

app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined }); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => {
  const d = store.getData(req.school.id);
  // single sign-in sessions carry the app user; if that account was removed / its password changed, the session ends
  if (req.appUser && !appUserStillValid(parseData(req.school.id), req.appUser)) {
    res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
    return res.status(401).json({ error: 'user_changed' });
  }
  res.json({ school: pub(req.school), user: pubUser(req.appUser), version: d.version, empty: d.data == null, updated_at: d.updated_at });
});

// ---------- data ----------
app.get('/api/db', auth, (req, res) => {
  const d = store.getData(req.school.id);
  res.set('Cache-Control', 'no-store');
  res.json({ version: d.version, updated_at: d.updated_at, data: d.data == null ? null : JSON.parse(d.data) });
});
app.get('/api/db/version', auth, (req, res) => {
  const d = store.getData(req.school.id);
  res.set('Cache-Control', 'no-store');
  res.json({ version: d.version, updated_at: d.updated_at });
});
function validDB(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  for (const k of ['users', 'monitors', 'vehicles', 'candidates', 'sessions', 'payments', 'expenses'])
    if (o[k] !== undefined && !Array.isArray(o[k])) return false;
  return Array.isArray(o.candidates) && Array.isArray(o.users);
}
app.put('/api/db', auth, (req, res) => {
  const { version, data, reason } = req.body || {};
  if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'version_required' });
  if (!validDB(data)) return res.status(400).json({ error: 'invalid_data' });
  const r = store.putData(req.school.id, version, JSON.stringify(data), reason === 'import' ? 'before-import' : 'auto');
  if (!r.ok) return res.status(409).json({ error: 'version_conflict', version: r.version });
  res.json({ ok: true, version: r.version });
});

// ---------- admin (Bearer ADMIN_TOKEN) ----------
const admin = express.Router();
admin.use(rateLimit({ windowMs: 60_000, limit: 60 }));
admin.use((req, res, next) => {
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 16) return res.status(404).json({ error: 'admin_disabled' });
  const h = req.get('Authorization') || '';
  const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const exp = Buffer.from(ADMIN_TOKEN);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return res.status(401).json({ error: 'unauthorized' });
  next();
});
const wrap = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(400).json({ error: e.message }); } };
const need = ident => { const s = store.findSchool(ident); if (!s) throw new Error('school not found'); return s; };
admin.get('/schools', wrap(() => store.listSchools()));
admin.post('/schools', wrap(req => store.createSchool(req.body || {})));
admin.post('/schools/:code/password', wrap(req => store.setPassword(req.params.code, (req.body || {}).password)));
admin.post('/schools/:code/active', wrap(req => store.setActive(req.params.code, !!(req.body || {}).active)));
admin.get('/schools/:code/export', wrap(req => { const s = need(req.params.code); const d = store.getData(s.id); return { school: pub(s), version: d.version, data: d.data && JSON.parse(d.data) }; }));
admin.put('/schools/:code/import', wrap(req => {
  const s = need(req.params.code); const data = (req.body || {}).data;
  if (!validDB(data)) throw new Error('invalid_data');
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
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
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

if (require.main === module) { seedSchool(); app.listen(PORT, HOST, () => console.log(`Otoqol backend on http://${HOST}:${PORT}  (db: ${store.DB_FILE})`)); }
module.exports = app;
