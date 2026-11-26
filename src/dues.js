'use strict';
const crypto = require('crypto');
const templates = require('./templates');

const CHANNELS = new Set(['whatsapp', 'email', 'manual']);

function todayCasablanca() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = String(from).slice(0, 10), b = String(to).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 864e5);
}

function weekStart(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay(); // 0=Sun
  const back = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() + -back);
  return dt.toISOString().slice(0, 10);
}

function inThisWeek(dateStr, today) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  return d >= weekStart(today) && d <= today;
}

function paidOf(data, cid) {
  return (data.payments || []).filter(p => p && p.cid === cid)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function dueOf(data, cid) {
  const c = (data.candidates || []).find(x => x && x.id === cid);
  if (!c) return 0;
  return Math.max(0, (Number(c.price) || 0) - paidOf(data, cid));
}

function lastPaymentDate(data, cid) {
  const dates = (data.payments || []).filter(p => p && p.cid === cid && p.date)
    .map(p => String(p.date).slice(0, 10)).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function remindersFor(data, cid) {
  return (data.reminders || []).filter(r => r && r.cid === cid)
    .slice().sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date)));
}

function lastReminder(data, cid) {
  const list = remindersFor(data, cid);
  return list.length ? list[list.length - 1] : null;
}

function silenceAnchor(data, c) {
  const pay = lastPaymentDate(data, c.id);
  const rem = lastReminder(data, c.id);
  const remDate = rem ? String(rem.date || rem.at || '').slice(0, 10) : null;
  const created = c.createdAt ? String(c.createdAt).slice(0, 10) : null;
  const dates = [pay, remDate].filter(Boolean).sort();
  if (dates.length) return dates[dates.length - 1];
  return created || null;
}

function daysSilent(data, c, today) {
  const anchor = silenceAnchor(data, c);
  const n = daysBetween(anchor || today, today);
  return n == null ? 0 : Math.max(0, n);
}

function isHighDue(c, due) {
  const price = Number(c.price) || 0;
  if (price > 0) return due > price / 2;
  return due > 0;
}

function formatAmount(n, lang) {
  const v = Number(n) || 0;
  const loc = lang === 'en' ? 'en-US' : 'fr-FR';
  const num = v.toLocaleString(loc);
  if (lang === 'fr') return num + ' DH';
  if (lang === 'en') return num + ' MAD';
  return num + ' د.م';
}

function reminderMessage({ schoolName, studentName, amount, lang, data }) {
  const school = String(schoolName || 'Otoqol');
  return templates.render('debt', {
    school: school,
    student: studentName,
    amount: amount,
    due: amount,
    phone: (data && data.settings && data.settings.phone) || '',
  }, lang, data && data.messageTemplates);
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

function publicDebtor(data, c, today, lang) {
  const due = dueOf(data, c.id);
  const paid = paidOf(data, c.id);
  const lastPay = lastPaymentDate(data, c.id);
  const lastRem = lastReminder(data, c.id);
  const lastRemDate = lastRem ? String(lastRem.date || lastRem.at || '').slice(0, 10) : null;
  const school = (data.settings && data.settings.school) || 'Otoqol';
  const usedLang = lang || templates.studentLang(c, data.settings, data.messageTemplates);
  const message = reminderMessage({ schoolName: school, studentName: c.name, amount: due, lang: usedLang, data: data });
  return {
    id: c.id,
    name: c.name,
    phone: c.phone || '',
    email: c.email || '',
    price: Number(c.price) || 0,
    paid,
    due,
    lastPaymentDate: lastPay,
    lastReminderDate: lastRemDate,
    lastReminderChannel: lastRem ? lastRem.channel : null,
    daysSilent: daysSilent(data, c, today),
    highDue: isHighDue(c, due),
    neverReminded: !lastRem,
    remindedThisWeek: inThisWeek(lastRemDate, today),
    message,
    whatsappUrl: waLink(c.phone, message),
  };
}

function listDues(data, opts) {
  const today = (opts && opts.today) || todayCasablanca();
  const filter = (opts && opts.filter) || 'all';
  const forceLang = opts && opts.forceLang;
  let rows = (data.candidates || []).filter(c => c && dueOf(data, c.id) > 0)
    .map(c => publicDebtor(data, c, today, forceLang));
  if (filter === 'never') rows = rows.filter(r => r.neverReminded);
  else if (filter === 'week') rows = rows.filter(r => r.remindedThisWeek);
  else if (filter === 'high') rows = rows.filter(r => r.highDue);
  rows.sort((a, b) => (b.daysSilent - a.daysSilent) || (b.due - a.due) || String(a.name).localeCompare(String(b.name), 'ar'));
  const totalDue = rows.reduce((s, r) => s + r.due, 0);
  return { today, filter, count: rows.length, totalDue, debtors: rows };
}

function install(app, deps) {
  const { store, mail, auth, cachedData, bump } = deps;

  const staff = (req, res, next) => {
    if (req.role === 'manager' || req.role === 'secretary' || req.role === 'owner') return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  const mutate = (schoolId, reason, fn) => {
    for (let i = 0; i < 8; i++) {
      const cur = store.getData(schoolId);
      if (!cur || cur.data == null) return { error: 'no_data', status: 400 };
      let data;
      try { data = JSON.parse(cur.data); } catch (e) { return { error: 'no_data', status: 400 }; }
      if (!Array.isArray(data.reminders)) data.reminders = [];
      const extra = fn(data) || {};
      if (extra.error) return extra;
      const r = store.putData(schoolId, cur.version, JSON.stringify(data), reason);
      if (r.ok) { bump(schoolId); return { ok: true, data, version: r.version, ...extra }; }
    }
    return { error: 'version_conflict', status: 409 };
  };

  const langOf = req => {
    const l = String((req.query && req.query.lang) || (req.body && req.body.lang) || 'ar').toLowerCase();
    return l === 'fr' || l === 'en' ? l : 'ar';
  };

  app.get('/api/dues', auth, staff, (req, res) => {
    const data = cachedData(req.school.id) || { candidates: [], payments: [], reminders: [] };
    const filter = String(req.query.filter || 'all');
    const allowed = { all: 1, week: 1, never: 1, high: 1 };
    const f = allowed[filter] ? filter : 'all';
    res.set('Cache-Control', 'no-store');
    const qLang = req.query && req.query.lang != null && String(req.query.lang) !== '' ? langOf(req) : null;
    res.json(listDues(data, { filter: f, forceLang: qLang }));
  });

  app.post('/api/dues/:cid/remind', auth, staff, async (req, res) => {
    const cid = String(req.params.cid || '');
    const channel = String((req.body && req.body.channel) || 'manual');
    if (!CHANNELS.has(channel)) return res.status(400).json({ error: 'bad_channel' });
    const lang = langOf(req);
    const data0 = cachedData(req.school.id);
    if (!data0) return res.status(400).json({ error: 'no_data' });
    const c = (data0.candidates || []).find(x => x && x.id === cid);
    if (!c) return res.status(404).json({ error: 'candidate_not_found' });
    const due = dueOf(data0, cid);
    if (!(due > 0)) return res.status(400).json({ error: 'no_due' });
    if (channel === 'email') {
      const email = String(c.email || '').trim();
      if (!email) return res.status(400).json({ error: 'no_email' });
    }
    const schoolName = (data0.settings && data0.settings.school) || req.school.name;
    const explicitLang = (req.body && req.body.lang) || (req.query && req.query.lang);
    const usedLang = explicitLang ? lang : templates.studentLang(c, data0.settings, data0.messageTemplates);
    const message = reminderMessage({ schoolName, studentName: c.name, amount: due, lang: usedLang, data: data0 });
    let emailSent = false;
    if (channel === 'email' && mail.isConfigured()) {
      try {
        await mail.sendDebtReminderEmail({ to: c.email.trim(), name: c.name, schoolName, amount: due, lang, text: message });
        emailSent = true;
      } catch (e) {
        console.error('[mail] debt reminder send error:', e && e.message);
      }
    }
    const r = mutate(req.school.id, 'dues-remind', data => {
      const cand = (data.candidates || []).find(x => x && x.id === cid);
      if (!cand) return { error: 'candidate_not_found', status: 404 };
      const amount = dueOf(data, cid);
      if (!(amount > 0)) return { error: 'no_due', status: 400 };
      const rec = {
        id: 'r-' + crypto.randomBytes(6).toString('hex'),
        cid,
        at: new Date().toISOString(),
        date: todayCasablanca(),
        channel,
        amount,
        by: req.appUser && req.appUser.id,
        byName: req.appUser && req.appUser.name,
      };
      data.reminders.unshift(rec);
      if (data.reminders.length > 2000) data.reminders.length = 2000;
      if (!Array.isArray(data.log)) data.log = [];
      data.log.unshift({ id: rec.id, date: rec.at, user: rec.byName || '', text: 'تذكير مستحقات: ' + cand.name + ' (' + amount + ')' });
      return { rec };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    const today = todayCasablanca();
    const cand = (r.data.candidates || []).find(x => x && x.id === cid);
    res.json({
      ok: true,
      emailSent,
      reminder: r.rec,
      debtor: publicDebtor(r.data, cand, today, lang),
    });
  });
}

module.exports = {
  install, listDues, publicDebtor, reminderMessage, dueOf, paidOf,
  lastPaymentDate, lastReminder, daysSilent, silenceAnchor, isHighDue,
  inThisWeek, weekStart, todayCasablanca, daysBetween, waLink, formatAmount,
};
