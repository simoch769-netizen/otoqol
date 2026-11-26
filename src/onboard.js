'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const USERNAME_RE = /^[A-Za-z0-9._\u00C0-\u024F\u0600-\u06FF-]{2,40}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const nz = v => String(v == null ? '' : v).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const normEmail = v => String(v == null ? '' : v).trim();
const normPhone = v => nz(v).replace(/[\s().-]/g, '');

function validEmailReq(v) {
  const e = normEmail(v);
  return !!e && e.length <= 120 && EMAIL_RE.test(e);
}
function validPhone(v) {
  const p = normPhone(v);
  return /^\+?[0-9]{8,15}$/.test(p);
}
function validName(v, min, max) {
  const s = String(v == null ? '' : v).trim();
  return s.length >= min && s.length <= max;
}
function validUsername(v) {
  const u = nz(v);
  return USERNAME_RE.test(u);
}

function statusError(s, store) {
  if (!s) return null;
  const st = store.schoolStatus(s);
  if (st === 'pending') return 'school_pending';
  if (st === 'rejected') return 'school_rejected';
  if (st !== 'active' || !s.active) return 'school_inactive';
  return null;
}

function validateSignup(body, store) {
  const b = body || {};
  const name = String(b.name == null ? '' : b.name).trim();
  const city = String(b.city == null ? '' : b.city).trim();
  const managerName = String(b.managerName == null ? b.manager_name || '' : b.managerName).trim();
  const email = normEmail(b.email);
  const phone = normPhone(b.phone);
  const username = nz(b.username);
  const password = String(b.password == null ? '' : b.password);
  const wanted = b.code == null ? '' : String(b.code);

  if (!validName(name, 2, 80)) return { error: 'invalid_name' };
  if (!validName(city, 2, 80)) return { error: 'invalid_city' };
  if (!validName(managerName, 2, 80)) return { error: 'invalid_manager_name' };
  if (!validEmailReq(email)) return { error: 'invalid_email' };
  if (!validPhone(phone)) return { error: 'invalid_phone' };
  if (!validUsername(username)) return { error: 'invalid_username' };
  if (password.length < 6 || password.length > 200) return { error: 'weak_password' };
  if (wanted.length > 40) return { error: 'invalid_code' };

  if (store.findByEmail(email)) return { error: 'email_used' };

  let code;
  try { code = store.allocateCode(name, wanted); }
  catch (e) {
    if (e.message === 'code_taken') return { error: 'code_taken' };
    if (e.message === 'invalid_code') return { error: 'invalid_code' };
    throw e;
  }
  return { ok: true, name, city, managerName, email, phone, username, password, code };
}

function managerData({ name, managerName, username, passwordHash, email }) {
  return {
    settings: { school: name, absLimit: 3 },
    users: [{ id: 'u1', name: managerName, role: 'manager', username, password: passwordHash, email }],
    monitors: [], vehicles: [], candidates: [], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [],
  };
}

function pubOwnerSchool(s) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    status: s.status || (s.active ? 'active' : 'inactive'),
    active: !!s.active,
    city: s.city || '',
    contact_name: s.contact_name || '',
    contact_email: s.contact_email || '',
    contact_phone: s.contact_phone || '',
    created_at: s.created_at,
    decided_at: s.decided_at || null,
    version: s.version,
    updated_at: s.updated_at,
  };
}

function parseSchoolData(s, store) {
  const d = store.getData(s.id);
  if (!d || d.data == null) return { data: null, updated_at: d && d.updated_at };
  try { return { data: JSON.parse(d.data), updated_at: d.updated_at }; }
  catch (e) { return { data: null, updated_at: d.updated_at }; }
}

function schoolStats(s, store) {
  const { data, updated_at } = parseSchoolData(s, store);
  const arr = k => (data && Array.isArray(data[k]) ? data[k] : []);
  const payments = arr('payments').reduce((n, p) => n + (Number(p && p.amount) || 0), 0);
  return {
    candidates: arr('candidates').length,
    sessions: arr('sessions').length,
    users: arr('users').length,
    payments_total: Math.round(payments * 100) / 100,
    last_activity: updated_at || null,
  };
}

function ownerDashboard(store) {
  const schools = store.listSchools().map(s => ({ ...pubOwnerSchool(s), ...schoolStats(s, store) }));
  const totals = {
    schools: schools.length,
    pending: 0, active: 0, rejected: 0, inactive: 0,
    candidates: 0, sessions: 0, users: 0, payments_total: 0,
  };
  for (const s of schools) {
    if (s.status === 'pending') totals.pending++;
    else if (s.status === 'active') totals.active++;
    else if (s.status === 'rejected') totals.rejected++;
    else totals.inactive++;
    totals.candidates += s.candidates;
    totals.sessions += s.sessions;
    totals.users += s.users;
    totals.payments_total += s.payments_total;
  }
  totals.payments_total = Math.round(totals.payments_total * 100) / 100;
  return { schools, totals };
}

function install(app, ctx) {
  const { store, mail, hashPw, JWT_SECRET, JWT_OPTS, cookieOpts, PROD } = ctx;
  const OWNER_COOKIE = 'otq_owner';
  const ownerCookieOpts = { ...cookieOpts, maxAge: 12 * 3600 * 1000, path: '/' };
  const ownerSessions = new Map(); // jti -> exp
  setInterval(() => { const now = Date.now(); for (const [k, exp] of ownerSessions) if (exp <= now) ownerSessions.delete(k); }, 3600e3).unref();

  store.armSetupTokenFromEnv();

  function envOwnerUsername() { return String(process.env.OWNER_USERNAME || '').trim(); }
  function ownerPasswordHash() { return String(process.env.OWNER_PASSWORD_HASH || '').trim(); }
  function ownerPasswordPlain() {
    const a = String(process.env.OWNER_PASSWORD || '').trim();
    if (a) return a;
    const b = String(process.env.ADMIN_TOKEN || '').trim();
    return b.length >= 16 ? b : '';
  }
  function dbOwner() { return store.getOwnerAccount(); }
  function ownerUsername() {
    const acc = dbOwner();
    return acc ? acc.username : envOwnerUsername();
  }
  function ownerConfigured() {
    if (dbOwner()) return true;
    return !!(envOwnerUsername() && (ownerPasswordHash() || ownerPasswordPlain()));
  }
  function checkOwnerUsername(typed) {
    const exp = ownerUsername();
    const got = String(typed == null ? '' : typed).trim();
    if (!exp) return false;
    const a = Buffer.from(got.toLowerCase());
    const b = Buffer.from(exp.toLowerCase());
    if (a.length !== b.length) {
      crypto.timingSafeEqual(b, Buffer.alloc(b.length));
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }
  function checkOwnerPassword(typed) {
    const got = String(typed == null ? '' : typed);
    const acc = dbOwner();
    if (acc && acc.password_hash) {
      try { return bcrypt.compareSync(got, acc.password_hash); } catch (e) { return false; }
    }
    const hash = ownerPasswordHash();
    if (hash) {
      try { return bcrypt.compareSync(got, hash); } catch (e) { return false; }
    }
    const exp = ownerPasswordPlain();
    if (!exp) { try { bcrypt.compareSync(got || 'x', '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345'); } catch (e) {} return false; }
    const a = Buffer.from(got);
    const b = Buffer.from(exp);
    if (a.length !== b.length) { crypto.timingSafeEqual(b, b); return false; }
    return crypto.timingSafeEqual(a, b);
  }
  function signOwner() {
    const jti = crypto.randomBytes(18).toString('base64url');
    const expMs = Date.now() + 12 * 3600 * 1000;
    ownerSessions.set(jti, expMs);
    return jwt.sign({ role: 'owner' }, JWT_SECRET, { ...JWT_OPTS, audience: 'otoqol-owner', expiresIn: '12h', jwtid: jti });
  }
  function clearOwner(res) { res.clearCookie(OWNER_COOKIE, { ...ownerCookieOpts, maxAge: undefined }); }
  function ownerAuth(req, res, next) {
    if (!ownerConfigured()) return res.status(404).json({ error: 'owner_disabled' });
    const tok = req.cookies[OWNER_COOKIE] || '';
    if (!tok) return res.status(401).json({ error: 'not_logged_in' });
    let p;
    try { p = jwt.verify(tok, JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: 'otoqol-owner' }); }
    catch (e) { clearOwner(res); return res.status(401).json({ error: 'bad_session' }); }
    if (!p.jti || !ownerSessions.has(p.jti) || ownerSessions.get(p.jti) <= Date.now()) {
      clearOwner(res); return res.status(401).json({ error: 'session_revoked' });
    }
    req.ownerJti = p.jti;
    next();
  }

  const signupLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: Number(process.env.SIGNUP_PER_15MIN || 5),
    standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
  });
  const ownerLoginLimiter = rateLimit({
    windowMs: 15 * 60_000, skipSuccessfulRequests: true, limit: Number(process.env.OWNER_LOGIN_PER_15MIN || 10),
    standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
  });
  const ownerAccountLimiter = rateLimit({
    windowMs: 15 * 60_000, skipSuccessfulRequests: true, limit: Number(process.env.OWNER_LOGIN_PER_15MIN || 10),
    keyGenerator: req => 'owner:' + String((req.body && req.body.username) || '').trim().toLowerCase().slice(0, 100),
    validate: { keyGeneratorIpFallback: false },
    standardHeaders: false, legacyHeaders: false, message: { error: 'too_many_attempts' },
  });
  const setupLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: Number(process.env.OWNER_SETUP_PER_15MIN || 8),
    standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
  });

  app.get('/api/owner/setup', setupLimiter, (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const p = store.peekSetupToken(token);
    if (!p.ok) return res.status(400).json({ error: p.error });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, expires_at: p.expires_at });
  });
  app.post('/api/owner/setup', setupLimiter, (req, res) => {
    const b = req.body || {};
    const token = b.token;
    const username = nz(b.username);
    const password = String(b.password == null ? '' : b.password);
    if (typeof token !== 'string' || typeof (b.username) !== 'string' || typeof (b.password) !== 'string' ||
        token.length > 200 || username.length > 100 || password.length > 200)
      return res.status(400).json({ error: 'bad_request' });
    if (!validUsername(username)) return res.status(400).json({ error: 'invalid_username' });
    if (password.length < 8) return res.status(400).json({ error: 'weak_password' });
    const peeked = store.peekSetupToken(token);
    if (!peeked.ok) return res.status(400).json({ error: peeked.error });
    const used = store.consumeSetupToken(token);
    if (!used.ok) return res.status(400).json({ error: used.error });
    const hash = bcrypt.hashSync(password, 11);
    store.setOwnerAccount(username, hash);
    res.cookie(OWNER_COOKIE, signOwner(), ownerCookieOpts);
    res.json({ ok: true, user: { username, role: 'owner' } });
  });

  app.post('/api/signup', signupLimiter, (req, res) => {
    const b = req.body || {};
    if (b.name != null && typeof b.name !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.city != null && typeof b.city !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.managerName != null && typeof b.managerName !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.manager_name != null && typeof b.manager_name !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.email != null && typeof b.email !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.phone != null && typeof b.phone !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.username != null && typeof b.username !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.password != null && typeof b.password !== 'string') return res.status(400).json({ error: 'bad_request' });
    if (b.code != null && typeof b.code !== 'string') return res.status(400).json({ error: 'bad_request' });
    const v = validateSignup(b, store);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const schoolPass = crypto.randomBytes(16).toString('base64url');
    let school;
    try {
      school = store.createSchool({
        code: v.code,
        name: v.name,
        password: schoolPass,
        status: 'pending',
        city: v.city,
        contact_name: v.managerName,
        contact_email: v.email,
        contact_phone: v.phone,
      });
    } catch (e) {
      if (/UNIQUE|already/i.test(String(e && e.message))) return res.status(400).json({ error: 'code_taken' });
      throw e;
    }
    const data = managerData({
      name: v.name,
      managerName: v.managerName,
      username: v.username,
      passwordHash: hashPw(v.password),
      email: v.email,
    });
    store.putData(school.id, null, JSON.stringify(data), 'signup');
    void mail.sendOwnerSignupNotice({
      name: v.name, code: school.code, city: v.city, managerName: v.managerName,
      email: v.email, phone: v.phone, username: v.username,
    }).catch((e) => { console.error('[mail] owner signup notice error:', e && e.message); });
    res.json({ ok: true, code: school.code });
  });

  app.post('/api/owner/login', ownerLoginLimiter, ownerAccountLimiter, (req, res) => {
    if (!ownerConfigured()) return res.status(404).json({ error: 'owner_disabled' });
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() ||
        username.length > 100 || password.length > 200) return res.status(400).json({ error: 'bad_request' });
    const userOk = checkOwnerUsername(username);
    const passOk = checkOwnerPassword(password);
    if (!userOk || !passOk) return res.status(401).json({ error: 'bad_credentials' });
    res.cookie(OWNER_COOKIE, signOwner(), ownerCookieOpts);
    res.json({ ok: true, user: { username: ownerUsername(), role: 'owner' } });
  });
  app.post('/api/owner/logout', (req, res) => {
    try {
      const tok = req.cookies[OWNER_COOKIE] || '';
      const p = jwt.verify(tok, JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: 'otoqol-owner' });
      if (p.jti) ownerSessions.delete(p.jti);
    } catch (e) {}
    clearOwner(res); res.json({ ok: true });
  });
  app.get('/api/owner/me', ownerAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, role: 'owner', username: ownerUsername() });
  });
  app.get('/api/owner/schools', ownerAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(ownerDashboard(store));
  });
  app.post('/api/owner/schools', ownerAuth, (req, res) => {
    const b = req.body || {};
    const name = String(b.name == null ? '' : b.name).trim();
    const wanted = b.code == null ? '' : String(b.code);
    const managerName = String(b.managerName == null ? b.manager_name || '' : b.managerName).trim() || 'المدير';
    const username = nz(b.managerUsername != null ? b.managerUsername : (b.username != null ? b.username : ''));
    const password = String(b.managerPassword != null ? b.managerPassword : (b.password != null ? b.password : ''));
    const city = String(b.city == null ? '' : b.city).trim();
    const email = normEmail(b.email);
    const phone = b.phone ? normPhone(b.phone) : '';
    if (typeof (b.name) !== 'string' && b.name != null) return res.status(400).json({ error: 'bad_request' });
    if (!validName(name, 2, 80)) return res.status(400).json({ error: 'invalid_name' });
    if (!validUsername(username)) return res.status(400).json({ error: 'invalid_username' });
    if (password.length < 6 || password.length > 200) return res.status(400).json({ error: 'weak_password' });
    if (email && !validEmailReq(email)) return res.status(400).json({ error: 'invalid_email' });
    if (phone && !validPhone(phone)) return res.status(400).json({ error: 'invalid_phone' });
    if (email && store.findByEmail(email)) return res.status(400).json({ error: 'email_used' });
    let code;
    try { code = store.allocateCode(name, wanted); }
    catch (e) {
      if (e.message === 'code_taken') return res.status(400).json({ error: 'code_taken' });
      if (e.message === 'invalid_code') return res.status(400).json({ error: 'invalid_code' });
      throw e;
    }
    const schoolPass = crypto.randomBytes(16).toString('base64url');
    let school;
    try {
      school = store.createSchool({
        code, name, password: schoolPass, status: 'active',
        city: city || null, contact_name: managerName,
        contact_email: email || null, contact_phone: phone || null,
      });
    } catch (e) {
      if (/UNIQUE|already/i.test(String(e && e.message))) return res.status(400).json({ error: 'code_taken' });
      throw e;
    }
    const data = managerData({ name, managerName, username, passwordHash: hashPw(password), email: email || undefined });
    store.putData(school.id, null, JSON.stringify(data), 'owner-create');
    const row = store.listSchools().find(x => x.id === school.id) || school;
    res.json({ ok: true, school: { ...pubOwnerSchool(row), ...schoolStats(row, store) } });
  });

  function loadSchool(req, res) {
    const s = store.findSchool(req.params.code);
    if (!s) { res.status(404).json({ error: 'school_not_found' }); return null; }
    return s;
  }
  app.post('/api/owner/schools/:code/approve', ownerAuth, (req, res) => {
    const s = loadSchool(req, res); if (!s) return;
    const st = store.schoolStatus(s);
    if (st !== 'pending') return res.status(400).json({ error: st === 'active' ? 'already_active' : 'not_pending' });
    const out = store.setStatus(s.code, 'active');
    const email = s.contact_email;
    if (email) {
      void mail.sendSchoolApprovedEmail({ to: email, code: s.code, name: s.name }).catch((e) => {
        console.error('[mail] school approved email error:', e && e.message);
      });
    }
    res.json({ ok: true, school: { ...pubOwnerSchool(s), ...out } });
  });
  app.post('/api/owner/schools/:code/reject', ownerAuth, (req, res) => {
    const s = loadSchool(req, res); if (!s) return;
    const st = store.schoolStatus(s);
    if (st !== 'pending') return res.status(400).json({ error: 'not_pending' });
    const out = store.setStatus(s.code, 'rejected');
    res.json({ ok: true, school: { ...pubOwnerSchool(s), ...out } });
  });
  app.post('/api/owner/schools/:code/deactivate', ownerAuth, (req, res) => {
    const s = loadSchool(req, res); if (!s) return;
    const st = store.schoolStatus(s);
    if (st !== 'active') return res.status(400).json({ error: 'not_active' });
    const out = store.setStatus(s.code, 'inactive');
    res.json({ ok: true, school: { ...pubOwnerSchool(s), ...out } });
  });
  app.post('/api/owner/schools/:code/activate', ownerAuth, (req, res) => {
    const s = loadSchool(req, res); if (!s) return;
    const st = store.schoolStatus(s);
    if (st === 'active') return res.status(400).json({ error: 'already_active' });
    if (st === 'pending') return res.status(400).json({ error: 'not_pending_use_approve' });
    const out = store.setStatus(s.code, 'active');
    res.json({ ok: true, school: { ...pubOwnerSchool(s), ...out } });
  });

  return { ownerAuth, statusError, validateSignup, ownerConfigured };
}

module.exports = { install, validateSignup, statusError, managerData, pubOwnerSchool, schoolStats, ownerDashboard, validEmailReq, validPhone, validUsername };
