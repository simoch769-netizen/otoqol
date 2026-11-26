'use strict';
const templates = require('./templates');
const hoursMod = require('./hours');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const CONSENT_VERSION = '1';
const INVITE_TTL_MS = Number(process.env.PORTAL_INVITE_TTL_MS || 7 * 864e5);
const SLOT_DAYS = Number(process.env.PORTAL_SLOT_DAYS || 14);
const DEFAULT_OPEN = '08:00';
const DEFAULT_CLOSE = '18:00';
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6]; // Mon–Sat (JS: 0=Sun)
const MIN_PASSWORD = 4;

function portalEnabled(settings) {
  return !settings || settings.studentPortal !== false;
}

function casablancaNow() {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' });
  const ttf = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hour12: false });
  const date = dtf.format(new Date());
  const parts = ttf.formatToParts(new Date());
  const hour = (parts.find(p => p.type === 'hour') || {}).value || '00';
  const minute = (parts.find(p => p.type === 'minute') || {}).value || '00';
  return { date, time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') };
}

function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function weekday(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

function toMin(t) {
  const p = String(t || '00:00').split(/[:.]/).map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

function fromMin(n) {
  const h = Math.floor(n / 60), m = n % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function overlaps(aDate, aTime, aDur, bDate, bTime, bDur) {
  if (String(aDate) !== String(bDate)) return false;
  const s1 = toMin(aTime), e1 = s1 + Number(aDur) * 60;
  const s2 = toMin(bTime), e2 = s2 + Number(bDur) * 60;
  return s1 < e2 && s2 < e1;
}

function attActive(a) {
  return a && a.cid && a.status !== 'absent' && a.status !== 'cancelled';
}

function sessionActiveFor(s, { monitorId, cid } = {}) {
  if (!s) return false;
  if (monitorId && s.monitorId !== monitorId) return false;
  if (cid && !(s.att || []).some(a => a.cid === cid && attActive(a))) return false;
  return !cid || (s.att || []).some(attActive);
}

function hoursDone(data, cid, type) {
  return (data.sessions || []).reduce((sum, x) => {
    const a = (x.att || []).find(y => y.cid === cid);
    const counted = a && (a.status === 'present' || a.status === 'late');
    return sum + ((counted && (!type || x.type === type)) ? Number(x.duration) || 0 : 0);
  }, 0);
}

function paidOf(data, cid) {
  return (data.payments || []).filter(p => p.cid === cid).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function sessionStartPast(s, now) {
  if (s.date < now.date) return true;
  if (s.date > now.date) return false;
  return toMin(s.time) <= toMin(now.time);
}

function openHours(settings) {
  const days = Array.isArray(settings && settings.portalDays) && settings.portalDays.length
    ? settings.portalDays.map(Number).filter(d => d >= 0 && d <= 6)
    : DEFAULT_DAYS;
  return {
    open: (settings && settings.portalOpen) || DEFAULT_OPEN,
    close: (settings && settings.portalClose) || DEFAULT_CLOSE,
    days: days.length ? days : DEFAULT_DAYS,
  };
}

function freeSlots(data, monitorId, opts) {
  const now = (opts && opts.now) || casablancaNow();
  const days = (opts && opts.days) || SLOT_DAYS;
  const hours = openHours(data.settings || {});
  const step = 60;
  const open = toMin(hours.open), close = toMin(hours.close);
  const duration = (opts && opts.duration) || 1;
  const out = [];
  if (!monitorId) return out;
  for (let i = 0; i < days; i++) {
    const date = addDays(now.date, i);
    if (!hours.days.includes(weekday(date))) continue;
    for (let m = open; m + duration * 60 <= close; m += step) {
      const time = fromMin(m);
      if (i === 0 && toMin(time) <= toMin(now.time)) continue;
      const clash = (data.sessions || []).some(s =>
        s.monitorId === monitorId && overlaps(date, time, duration, s.date, s.time, s.duration)
      );
      if (!clash) out.push({ date, time, duration, monitorId });
    }
  }
  return out;
}

function suggestUsername(name, cin, taken) {
  const raw = String(name || '').trim().toLowerCase()
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  let base = raw.replace(/[^a-z0-9\u0600-\u06ff]+/g, '.').replace(/^\.+|\.+$/g, '');
  if (!base || base === '.') {
    const tail = String(cin || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4);
    base = 'eleve' + (tail ? tail.toLowerCase() : '');
  }
  if (base.length > 24) base = base.slice(0, 24);
  let u = base, n = 2;
  while (taken(u)) { u = base.slice(0, 20) + n; n += 1; if (n > 9999) break; }
  return u;
}

function waDigits(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = '212' + p.slice(1);
  else if (p.length === 9 && /^[5-7]/.test(p)) p = '212' + p;
  return p;
}

function waLink(phone, text) {
  const p = waDigits(phone);
  if (!p) return '';
  return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
}

function nextLesson(data, cid, now) {
  const upcoming = (data.sessions || [])
    .filter(s => (s.att || []).some(a => a.cid === cid && attActive(a)) && !sessionStartPast(s, now))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return upcoming[0] || null;
}

function studentPayload(data, cid, extra) {
  const c = (data.candidates || []).find(x => x && x.id === cid);
  if (!c) return { error: 'candidate_not_found' };
  const now = (extra && extra.now) || casablancaNow();
  const mon = c.monitorId ? (data.monitors || []).find(m => m && m.id === c.monitorId) : null;
  const nxt = nextLesson(data, cid, now);
  const paid = paidOf(data, cid);
  const price = Number(c.price) || 0;
  const codeDone = hoursDone(data, cid, 'code');
  const driveDone = hoursDone(data, cid, 'conduite');
  const codeHours = Number(c.codeHours) || 0;
  const driveHours = Number(c.driveHours) || 0;
  return {
    candidate: {
      id: c.id, name: c.name, firstName: c.firstName || '', lastName: c.lastName || '',
      cin: c.cin || '', phone: c.phone || '', license: c.license || '', stage: c.stage || 'reg',
      codeHours, driveHours, price, monitorId: c.monitorId || '',
    },
    instructor: mon ? { id: mon.id, name: mon.name } : null,
    hours: {
      codeDone, driveDone, codeHours, driveHours,
      codeLeft: Math.max(0, codeHours - codeDone),
      driveLeft: Math.max(0, driveHours - driveDone),
    },
    balance: { price, paid, due: Math.max(0, price - paid) },
    paidHours: hoursMod.publicSnapshot(data, cid),
    nextLesson: nxt ? publicSession(data, nxt, cid) : null,
    exams: Array.isArray(c.exams) ? c.exams.map(e => ({ id: e.id, type: e.type, date: e.date, result: e.result })) : [],
  };
}

function publicSession(data, s, cid) {
  const a = (s.att || []).find(x => x.cid === cid) || {};
  const mon = (data.monitors || []).find(m => m && m.id === s.monitorId);
  return {
    id: s.id, date: s.date, time: s.time, duration: Number(s.duration) || 1,
    type: s.type, status: a.status || 'planned',
    monitorId: s.monitorId || '', monitorName: mon ? mon.name : '',
    portalBookingId: s.portalBookingId || null,
  };
}

function publicBooking(b, data) {
  const mon = (data.monitors || []).find(m => m && m.id === b.monitorId);
  const c = (data.candidates || []).find(x => x && x.id === b.cid);
  const tplId = templates.bookingTemplate(b.kind, b.status);
  const lang = templates.studentLang(c, data.settings, data.messageTemplates);
  const message = (tplId && c) ? templates.render(tplId, {
    school: (data.settings && data.settings.school) || 'Otoqol',
    student: c.name,
    date: b.date,
    time: b.time,
    instructor: mon ? mon.name : '',
    type: templates.typeLabel(b.type, lang),
    phone: (data.settings && data.settings.phone) || '',
  }, lang, data.messageTemplates) : '';
  return {
    id: b.id, kind: b.kind, status: b.status, cid: b.cid,
    studentName: c ? c.name : '', studentPhone: c ? (c.phone || '') : '',
    date: b.date, time: b.time,
    duration: Number(b.duration) || 1, type: b.type,
    monitorId: b.monitorId || '', monitorName: mon ? mon.name : '',
    sessionId: b.sessionId || null, createdAt: b.createdAt, decidedAt: b.decidedAt || null,
    message, whatsappUrl: (c && c.phone && message) ? templates.waLink(c.phone, message) : '',
  };
}

function hashInvite(secret, token) {
  return crypto.createHash('sha256').update('otq-invite:' + String(secret) + ':' + String(token)).digest('hex');
}

function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function ensureArrays(data) {
  if (!Array.isArray(data.portalUsers)) data.portalUsers = [];
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (!Array.isArray(data.portalInvites)) data.portalInvites = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.notifs)) data.notifs = [];
  if (!Array.isArray(data.log)) data.log = [];
}

function notify(data, to, text, cid) {
  data.notifs.unshift({ id: uid(), to, text, cid: cid || '', date: new Date().toISOString(), read: false });
  if (data.notifs.length > 500) data.notifs.length = 500;
}

function inviteUrl(publicUrl, token) {
  const base = String(publicUrl || 'https://otoqol.com').replace(/\/+$/, '');
  return base + '/portal/invite?token=' + encodeURIComponent(token);
}

function install(app, deps) {
  const {
    store, mail, auth, hashPw, nz, bump, JWT_SECRET, publicUrl,
  } = deps;

  const staff = (req, res, next) => {
    if (req.role === 'manager' || req.role === 'secretary' || req.role === 'owner') return next();
    return res.status(403).json({ error: 'forbidden' });
  };
  const studentOnly = (req, res, next) => {
    if (req.role !== 'student') return res.status(403).json({ error: 'forbidden' });
    const data = deps.cachedData(req.school.id);
    if (!portalEnabled(data && data.settings)) return res.status(403).json({ error: 'portal_disabled' });
    const u = (data && data.portalUsers || []).find(x => x && x.id === req.appUser.id);
    if (!u || u.active === false) return res.status(401).json({ error: 'user_changed' });
    const c = (data.candidates || []).find(x => x && x.id === u.cid);
    if (!c) return res.status(403).json({ error: 'candidate_not_found' });
    req.portalUser = u;
    req.cid = u.cid;
    req.schoolData = data;
    next();
  };

  const mutate = (schoolId, reason, fn) => {
    for (let i = 0; i < 8; i++) {
      const cur = store.getData(schoolId);
      if (!cur || cur.data == null) return { error: 'no_data', status: 400 };
      let data;
      try { data = JSON.parse(cur.data); } catch (e) { return { error: 'no_data', status: 400 }; }
      ensureArrays(data);
      const extra = fn(data) || {};
      if (extra.error) return extra;
      const r = store.putData(schoolId, cur.version, JSON.stringify(data), reason);
      if (r.ok) { bump(schoolId); return { ok: true, data, version: r.version, ...extra }; }
    }
    return { error: 'version_conflict', status: 409 };
  };

  const inviteLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: Number(process.env.PORTAL_INVITE_PER_15MIN || 20),
    standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
  });
  const activateLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: Number(process.env.PORTAL_ACTIVATE_PER_15MIN || 20),
    standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
  });

  const takenUsername = (username, schoolId, exceptUserId) => {
    const un = store.normUsername(username);
    if (!un) return true;
    const hits = store.findAccountsByUsername(un);
    return hits.some(a => !(a.schoolId === schoolId && a.id === exceptUserId));
  };

  app.get('/api/portal/invite/:token', activateLimiter, (req, res) => {
    const token = String(req.params.token || '');
    if (!token || token.length > 200) return res.status(400).json({ error: 'invalid_invite' });
    const hash = hashInvite(JWT_SECRET, token);
    const now = Date.now();
    for (const s of store.listSchools()) {
      const data = deps.cachedData(s.id);
      if (!data) continue;
      const inv = (data.portalInvites || []).find(x => x && x.hash === hash);
      if (!inv) continue;
      if (!portalEnabled(data.settings)) return res.status(403).json({ error: 'portal_disabled' });
      if (inv.expires && inv.expires <= now) return res.status(400).json({ error: 'invite_expired' });
      if (inv.usedAt) return res.status(400).json({ error: 'invite_used' });
      const c = (data.candidates || []).find(x => x && x.id === inv.cid);
      if (!c) return res.status(400).json({ error: 'invalid_invite' });
      return res.json({
        schoolName: (data.settings && data.settings.school) || s.name,
        studentName: c.name,
        username: inv.username,
        consentVersion: CONSENT_VERSION,
      });
    }
    return res.status(400).json({ error: 'invalid_invite' });
  });

  app.post('/api/portal/activate', activateLimiter, async (req, res) => {
    const { token, password, consent } = req.body || {};
    if (typeof token !== 'string' || typeof password !== 'string' || token.length > 200 || password.length > 200)
      return res.status(400).json({ error: 'bad_request' });
    if (consent !== true) return res.status(400).json({ error: 'consent_required' });
    const pw = String(password).trim();
    if (pw.length < MIN_PASSWORD) return res.status(400).json({ error: 'weak_password' });
    const hash = hashInvite(JWT_SECRET, token);
    const now = Date.now();
    let school = null;
    for (const s of store.listSchools()) {
      const data = deps.cachedData(s.id);
      const inv = data && (data.portalInvites || []).find(x => x && x.hash === hash);
      if (inv) { school = store.getSchoolById(s.id); break; }
    }
    if (!school) return res.status(400).json({ error: 'invalid_invite' });
    const hashed = hashPw(pw);
    const r = mutate(school.id, 'portal-activate', data => {
      if (!portalEnabled(data.settings)) return { error: 'portal_disabled', status: 403 };
      const inv = (data.portalInvites || []).find(x => x && x.hash === hash);
      if (!inv) return { error: 'invalid_invite', status: 400 };
      if (inv.expires && inv.expires <= now) return { error: 'invite_expired', status: 400 };
      if (inv.usedAt) return { error: 'invite_used', status: 400 };
      const c = (data.candidates || []).find(x => x && x.id === inv.cid);
      if (!c) return { error: 'invalid_invite', status: 400 };
      let user = (data.portalUsers || []).find(x => x && x.id === inv.userId);
      if (!user) user = (data.portalUsers || []).find(x => x && x.cid === inv.cid);
      if (!user) {
        if (takenUsername(inv.username, school.id)) return { error: 'username_taken', status: 400 };
        user = { id: 'p-' + uid(), cid: inv.cid, username: inv.username, email: inv.email || c.email || '', active: true };
        data.portalUsers.push(user);
      }
      user.password = hashed;
      user.active = true;
      user.name = c.name;
      user.email = inv.email || user.email || c.email || '';
      user.username = inv.username || user.username;
      user.activatedAt = new Date().toISOString();
      user.consentAt = new Date().toISOString();
      user.consentVersion = CONSENT_VERSION;
      inv.usedAt = new Date().toISOString();
      return { user };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    const user = { id: r.user.id, name: r.user.name, role: 'student', tag: deps.pwTag(r.user.password), cid: r.user.cid };
    deps.finishSignin(res, school, user, false);
  });

  app.post('/api/portal/invite', auth, staff, inviteLimiter, async (req, res) => {
    const { cid, email, username } = req.body || {};
    if (typeof cid !== 'string' || !cid || cid.length > 80) return res.status(400).json({ error: 'bad_request' });
    const data0 = deps.cachedData(req.school.id);
    if (!data0) return res.status(400).json({ error: 'no_data' });
    if (!portalEnabled(data0.settings)) return res.status(403).json({ error: 'portal_disabled' });
    const c = (data0.candidates || []).find(x => x && x.id === cid);
    if (!c) return res.status(404).json({ error: 'candidate_not_found' });
    const emailIn = (typeof email === 'string' ? email : (c.email || '')).trim();
    if (emailIn && !deps.validEmail(emailIn)) return res.status(400).json({ error: 'invalid_email' });
    const existing = (data0.portalUsers || []).find(x => x && x.cid === cid && x.activatedAt);
    if (existing) {
      const loginUrl = String((publicUrl || mail.publicUrl)()).replace(/\/+$/, '') + '/portal';
      const schoolName0 = (data0.settings && data0.settings.school) || req.school.name;
      const lang0 = templates.studentLang(c, data0.settings, data0.messageTemplates);
      const text = templates.render('portal_invite', {
        school: schoolName0, student: c.name, link: loginUrl, username: existing.username || '',
        phone: (data0.settings && data0.settings.phone) || '',
      }, lang0, data0.messageTemplates);
      const whatsappUrl = waLink(c.phone, text);
      if (emailIn && mail.isConfigured()) {
        void mail.sendStudentInviteEmail({
          to: emailIn, name: c.name, schoolName: schoolName0,
          username: existing.username, url: loginUrl, alreadyActive: true, text,
        }).catch(e => console.error('[mail] student invite send error:', e && e.message));
      }
      return res.json({
        alreadyActive: true, username: existing.username, url: loginUrl, loginUrl,
        whatsappUrl, emailSent: !!(emailIn && mail.isConfigured()),
      });
    }
    let un = typeof username === 'string' ? store.normUsername(username) : '';
    const existingUser = (data0.portalUsers || []).find(x => x && x.cid === cid);
    if (!un) un = (existingUser && existingUser.username) || suggestUsername(c.name || c.firstName || '', c.cin, u => takenUsername(u, req.school.id, existingUser && existingUser.id));
    if (takenUsername(un, req.school.id, existingUser && existingUser.id)) return res.status(400).json({ error: 'username_taken' });
    const token = crypto.randomBytes(24).toString('base64url');
    const r = mutate(req.school.id, 'portal-invite', data => {
      if (!portalEnabled(data.settings)) return { error: 'portal_disabled', status: 403 };
      const cand = (data.candidates || []).find(x => x && x.id === cid);
      if (!cand) return { error: 'candidate_not_found', status: 404 };
      if (emailIn) cand.email = emailIn;
      let user = (data.portalUsers || []).find(x => x && x.cid === cid);
      if (!user) {
        user = { id: 'p-' + uid(), cid, username: un, email: emailIn, name: cand.name, active: true };
        data.portalUsers.push(user);
      } else {
        user.username = un;
        if (emailIn) user.email = emailIn;
        user.name = cand.name;
      }
      data.portalInvites = (data.portalInvites || []).filter(x => !(x && x.cid === cid && !x.usedAt));
      data.portalInvites.push({
        id: 'i-' + uid(), cid, userId: user.id, username: un, email: emailIn,
        hash: hashInvite(JWT_SECRET, token),
        expires: Date.now() + INVITE_TTL_MS,
        createdAt: new Date().toISOString(),
      });
      notify(data, 'secretary', 'تم إرسال دعوة بوابة التلميذ إلى ' + cand.name, cid);
      return { user };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    const url = inviteUrl((publicUrl || mail.publicUrl)(), token);
    const schoolName = (r.data.settings && r.data.settings.school) || req.school.name;
    const langInv = templates.studentLang(c, r.data.settings, r.data.messageTemplates);
    const text = templates.render('portal_invite', {
      school: schoolName, student: c.name, link: url, username: un,
      phone: (r.data.settings && r.data.settings.phone) || '',
    }, langInv, r.data.messageTemplates);
    const whatsappUrl = waLink(c.phone, text);
    let emailSent = false;
    if (emailIn && mail.isConfigured()) {
      try {
        await mail.sendStudentInviteEmail({ to: emailIn, name: c.name, schoolName, username: un, url, text });
        emailSent = true;
      } catch (e) {
        console.error('[mail] student invite send error:', e && e.message);
      }
    }
    res.json({ alreadyActive: false, username: un, url, whatsappUrl, emailSent, expiresInDays: Math.round(INVITE_TTL_MS / 864e5) });
  });

  app.get('/api/portal/requests', auth, staff, (req, res) => {
    const data = deps.cachedData(req.school.id) || { bookings: [] };
    ensureArrays(data);
    const all = (data.bookings || []).map(b => publicBooking(b, data));
    const pending = all.filter(b => b.status === 'pending');
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: portalEnabled(data.settings), pending: pending.length, requests: all });
  });

  function decideBooking(req, res, status) {
    const id = String(req.params.id || '');
    const r = mutate(req.school.id, 'portal-booking-' + status, data => {
      const b = (data.bookings || []).find(x => x && x.id === id);
      if (!b) return { error: 'not_found', status: 404 };
      if (b.status !== 'pending') return { error: 'not_pending', status: 400 };
      b.status = status;
      b.decidedAt = new Date().toISOString();
      b.decidedBy = req.appUser && req.appUser.id;
      if (b.kind === 'book') {
        const sess = (data.sessions || []).find(s => s && s.id === b.sessionId);
        if (status === 'approved') {
          if (sess) (sess.att || []).forEach(a => { if (a.cid === b.cid && a.status === 'pending') a.status = 'planned'; });
        } else {
          if (sess) {
            sess.att = (sess.att || []).filter(a => a.cid !== b.cid);
            if (!sess.att.length) data.sessions = data.sessions.filter(s => s.id !== sess.id);
          }
        }
      } else if (b.kind === 'cancel') {
        const sess = (data.sessions || []).find(s => s && s.id === b.sessionId);
        if (status === 'approved' && sess) {
          sess.att = (sess.att || []).filter(a => a.cid !== b.cid);
          if (!sess.att.length) data.sessions = data.sessions.filter(s => s.id !== sess.id);
        }
      }
      const c = (data.candidates || []).find(x => x && x.id === b.cid);
      const label = (b.kind === 'cancel' ? 'طلب إلغاء حصة ' : 'طلب حجز حصة ') + (b.date || '') + ' ' + (b.time || '');
      notify(data, 'secretary', (status === 'approved' ? 'تم قبول ' : 'تم رفض ') + label + (c ? ' — ' + c.name : ''), b.cid);
      return { booking: b };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, request: publicBooking(r.booking, r.data) });
  }

  app.post('/api/portal/requests/:id/approve', auth, staff, (req, res) => decideBooking(req, res, 'approved'));
  app.post('/api/portal/requests/:id/reject', auth, staff, (req, res) => decideBooking(req, res, 'rejected'));

  app.get('/api/portal/me', auth, studentOnly, (req, res) => {
    const data = req.schoolData;
    const payload = studentPayload(data, req.cid);
    if (payload.error) return res.status(404).json({ error: payload.error });
    const user = req.portalUser;
    res.set('Cache-Control', 'no-store');
    res.json({
      school: { id: req.school.id, name: (data.settings && data.settings.school) || req.school.name },
      user: { id: user.id, name: user.name, role: 'student', username: user.username, cid: req.cid, consentAt: user.consentAt, consentVersion: user.consentVersion },
      ...payload,
    });
  });

  app.get('/api/portal/schedule', auth, studentOnly, (req, res) => {
    const data = req.schoolData;
    const c = (data.candidates || []).find(x => x.id === req.cid);
    const monitorId = String(req.query.monitorId || (c && c.monitorId) || '');
    const now = casablancaNow();
    const lessons = (data.sessions || [])
      .filter(s => (s.att || []).some(a => a.cid === req.cid && attActive(a)))
      .map(s => publicSession(data, s, req.cid))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const mine = (data.bookings || []).filter(b => b.cid === req.cid).map(b => publicBooking(b, data));
    const monitors = (data.monitors || []).filter(m => m && m.id).map(m => ({ id: m.id, name: m.name }));
    const slots = monitorId ? freeSlots(data, monitorId, { now }) : [];
    res.set('Cache-Control', 'no-store');
    res.json({
      monitorId: monitorId || '',
      assignedMonitorId: (c && c.monitorId) || '',
      monitors, slots,
      lessons,
      upcoming: lessons.filter(s => !sessionStartPast(s, now)),
      history: lessons.filter(s => sessionStartPast(s, now)),
      requests: mine,
    });
  });

  app.get('/api/portal/payments', auth, studentOnly, (req, res) => {
    const data = req.schoolData;
    const c = (data.candidates || []).find(x => x.id === req.cid);
    const payments = (data.payments || []).filter(p => p.cid === req.cid)
      .map(p => ({ id: p.id, no: p.no, amount: Number(p.amount) || 0, date: p.date, note: p.note || '' }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const price = Number(c && c.price) || 0;
    res.set('Cache-Control', 'no-store');
    res.json({
      price, paid, due: Math.max(0, price - paid),
      hours: {
        codeDone: hoursDone(data, req.cid, 'code'),
        driveDone: hoursDone(data, req.cid, 'conduite'),
        codeHours: Number(c && c.codeHours) || 0,
        driveHours: Number(c && c.driveHours) || 0,
      },
      payments,
    });
  });

  app.get('/api/portal/history', auth, studentOnly, (req, res) => {
    const data = req.schoolData;
    const now = casablancaNow();
    const lessons = (data.sessions || [])
      .filter(s => (s.att || []).some(a => a.cid === req.cid))
      .map(s => publicSession(data, s, req.cid))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const notes = (data.notes || []).filter(n => n.cid === req.cid).map(n => {
      const mon = (data.monitors || []).find(m => m && m.id === n.monitorId);
      return { id: n.id, date: n.date, text: n.text, monitorName: mon ? mon.name : '' };
    });
    res.set('Cache-Control', 'no-store');
    res.json({ lessons, notes, now });
  });

  app.post('/api/portal/bookings', auth, studentOnly, (req, res) => {
    const { date, time, duration, type, monitorId } = req.body || {};
    if (typeof date !== 'string' || typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time))
      return res.status(400).json({ error: 'bad_request' });
    const dur = Number(duration == null ? 1 : duration);
    if (![1, 2].includes(dur)) return res.status(400).json({ error: 'bad_request' });
    const typ = type === 'code' ? 'code' : (type === 'conduite' ? 'conduite' : '');
    if (!typ) return res.status(400).json({ error: 'bad_request' });
    const now = casablancaNow();
    if (date < now.date || (date === now.date && toMin(time) <= toMin(now.time)))
      return res.status(400).json({ error: 'slot_past' });
    const r = mutate(req.school.id, 'portal-book', data => {
      if (!portalEnabled(data.settings)) return { error: 'portal_disabled', status: 403 };
      const c = (data.candidates || []).find(x => x && x.id === req.cid);
      if (!c) return { error: 'candidate_not_found', status: 404 };
      const mid = String(monitorId || c.monitorId || '');
      const mon = (data.monitors || []).find(m => m && m.id === mid);
      if (!mon) return { error: 'monitor_required', status: 400 };
      const hours = openHours(data.settings);
      if (!hours.days.includes(weekday(date))) return { error: 'slot_closed', status: 400 };
      if (toMin(time) < toMin(hours.open) || toMin(time) + dur * 60 > toMin(hours.close))
        return { error: 'slot_closed', status: 400 };
      const clashMon = (data.sessions || []).some(s => s.monitorId === mid && overlaps(date, time, dur, s.date, s.time, s.duration));
      if (clashMon) return { error: 'slot_taken', status: 409 };
      const clashMe = (data.sessions || []).some(s =>
        (s.att || []).some(a => a.cid === req.cid && attActive(a)) && overlaps(date, time, dur, s.date, s.time, s.duration)
      );
      if (clashMe) return { error: 'already_booked', status: 409 };
      const snap = hoursMod.snapshot(data, c.id);
      if (snap.blockedFor(dur)) return { error: 'paid_hours_blocked', status: 403, paidHours: hoursMod.publicSnapshot(data, c.id) };
      const booking = {
        id: 'b-' + uid(), kind: 'book', status: 'pending', cid: req.cid,
        monitorId: mid, date, time, duration: dur, type: typ,
        createdAt: new Date().toISOString(),
      };
      const sess = {
        id: 's-' + uid(), date, time, duration: dur, type: typ,
        monitorId: mid, vehicleId: '', notes: '',
        portalBookingId: booking.id,
        att: [{ cid: req.cid, status: 'pending', reason: '' }],
      };
      booking.sessionId = sess.id;
      data.bookings.unshift(booking);
      data.sessions.push(sess);
      notify(data, 'secretary', 'طلب حجز حصة من ' + c.name + ' — ' + date + ' ' + time, req.cid);
      notify(data, 'manager', 'طلب حجز حصة من ' + c.name + ' — ' + date + ' ' + time, req.cid);
      return { booking, sess };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error, paidHours: r.paidHours });
    res.status(201).json({ ok: true, request: publicBooking(r.booking, r.data) });
  });

  app.post('/api/portal/bookings/:id/cancel', auth, studentOnly, (req, res) => {
    const id = String(req.params.id || '');
    const now = casablancaNow();
    const r = mutate(req.school.id, 'portal-cancel', data => {
      if (!portalEnabled(data.settings)) return { error: 'portal_disabled', status: 403 };
      const c = (data.candidates || []).find(x => x && x.id === req.cid);
      // Cancel a pending booking request by id, or a confirmed upcoming session by session id.
      let b = (data.bookings || []).find(x => x && x.id === id && x.cid === req.cid);
      let sess = (data.sessions || []).find(s => s && s.id === id && (s.att || []).some(a => a.cid === req.cid && attActive(a)));
      if (!b && !sess) {
        // maybe the id is a session tied to a booking
        sess = (data.sessions || []).find(s => s && (s.portalBookingId === id || s.id === id));
      }
      if (b && b.kind === 'book' && b.status === 'pending') {
        b.status = 'cancelled';
        b.decidedAt = new Date().toISOString();
        const s = (data.sessions || []).find(x => x && x.id === b.sessionId);
        if (s) {
          s.att = (s.att || []).filter(a => a.cid !== req.cid);
          if (!s.att.length) data.sessions = data.sessions.filter(x => x.id !== s.id);
        }
        if (c) notify(data, 'secretary', 'سحب طلب حجز من ' + c.name + ' — ' + b.date + ' ' + b.time, req.cid);
        return { booking: b, immediate: true };
      }
      if (!sess && b && b.sessionId) sess = (data.sessions || []).find(x => x && x.id === b.sessionId);
      if (!sess) return { error: 'not_found', status: 404 };
      const att = (sess.att || []).find(a => a.cid === req.cid && attActive(a));
      if (!att) return { error: 'not_found', status: 404 };
      if (sessionStartPast(sess, now)) return { error: 'too_late', status: 400 };
      if (att.status === 'pending') {
        // still awaiting staff: withdraw immediately
        sess.att = (sess.att || []).filter(a => a.cid !== req.cid);
        if (!sess.att.length) data.sessions = data.sessions.filter(x => x.id !== sess.id);
        if (b && b.status === 'pending') { b.status = 'cancelled'; b.decidedAt = new Date().toISOString(); }
        return { booking: b || null, immediate: true };
      }
      const open = (data.bookings || []).find(x => x.kind === 'cancel' && x.sessionId === sess.id && x.cid === req.cid && x.status === 'pending');
      if (open) return { error: 'already_requested', status: 409, booking: open };
      const cancel = {
        id: 'b-' + uid(), kind: 'cancel', status: 'pending', cid: req.cid,
        monitorId: sess.monitorId, date: sess.date, time: sess.time,
        duration: Number(sess.duration) || 1, type: sess.type,
        sessionId: sess.id, createdAt: new Date().toISOString(),
      };
      data.bookings.unshift(cancel);
      if (c) {
        notify(data, 'secretary', 'طلب إلغاء حصة من ' + c.name + ' — ' + sess.date + ' ' + sess.time, req.cid);
        notify(data, 'manager', 'طلب إلغاء حصة من ' + c.name + ' — ' + sess.date + ' ' + sess.time, req.cid);
      }
      return { booking: cancel, immediate: false };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, immediate: !!r.immediate, request: r.booking ? publicBooking(r.booking, r.data) : null });
  });
}

module.exports = {
  install, CONSENT_VERSION, portalEnabled, overlaps, freeSlots, hoursDone, paidOf,
  suggestUsername, waLink, waDigits, casablancaNow, addDays, toMin, studentPayload,
  hashInvite, attActive, sessionStartPast, openHours,
};
