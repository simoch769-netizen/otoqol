'use strict';
/* browser-safe: Node requires only when window is absent */
var nodePath = null, nodeCrypto = null;
if (typeof window === 'undefined' && typeof require === 'function') {
  nodePath = require('path');
  nodeCrypto = require('crypto');
}

const WARN_HOURS = 2;
const USED_STATUSES = { present: 1, late: 1, absent: 1, planned: 1, pending: 1 };

function casablancaParts(d) {
  const dt = d || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(dt);
  const g = t => (parts.find(p => p.type === t) || {}).value || '';
  return { date: g('year') + '-' + g('month') + '-' + g('day'), time: g('hour') + ':' + g('minute') };
}

function packageHours(c) {
  if (!c) return 0;
  return Math.max(0, (Number(c.codeHours) || 0) + (Number(c.driveHours) || 0));
}

function paidOf(data, cid) {
  return (data && data.payments || []).filter(p => p && p.cid === cid).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function sessionDuration(s) {
  const n = Number(s && s.duration);
  return n > 0 ? n : 0;
}

function attUsed(a) {
  return !!(a && a.cid && USED_STATUSES[a.status || 'planned']);
}

/** Paid hours the student has earned: (paid / package price) × (code + driving hours).
 *  If the package price or total hours is missing or zero, the rule cannot be applied. */
function entitledHours(data, c) {
  if (!c) return { applicable: false, entitled: null, paid: 0, price: 0, packageHours: 0 };
  const price = Number(c.price) || 0;
  const pack = packageHours(c);
  const paid = paidOf(data, c.id);
  if (!(price > 0) || !(pack > 0)) {
    return { applicable: false, entitled: null, paid, price, packageHours: pack };
  }
  return { applicable: true, entitled: paid * pack / price, paid, price, packageHours: pack };
}

function hoursUsed(data, cid, opts) {
  const skip = (opts && opts.skip) || {}; // { sessionId, extra? }
  let sum = 0;
  (data && data.sessions || []).forEach(s => {
    if (!s) return;
    if (skip.sessionId && s.id === skip.sessionId) return;
    const a = (s.att || []).find(x => x && x.cid === cid);
    if (!attUsed(a)) return;
    sum += sessionDuration(s);
  });
  return sum;
}

function snapshot(data, cid, opts) {
  const c = (data && data.candidates || []).find(x => x && x.id === cid) || (opts && opts.candidate) || null;
  const base = entitledHours(data, c);
  const used = c ? hoursUsed(data, c.id, opts) : 0;
  const left = base.applicable ? Math.max(0, base.entitled - used) : null;
  const warning = !!(base.applicable && left <= WARN_HOURS);
  const blockedFor = (dur) => {
    const need = Number(dur);
    const n = need > 0 ? need : 1;
    return !!(base.applicable && left < n - 1e-9);
  };
  return Object.assign({}, base, {
    cid: c ? c.id : cid,
    name: c ? c.name : '',
    used,
    left,
    warning,
    blocked: blockedFor(1),
    blockedFor,
  });
}

function formatHours(n) {
  const v = Math.max(0, Number(n) || 0);
  const r = Math.round(v * 10) / 10;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(1);
}

function isFutureSession(s, now) {
  const n = now || casablancaParts();
  const date = String((s && s.date) || '').slice(0, 10);
  const time = String((s && s.time) || '00:00').slice(0, 5);
  if (!date) return false;
  if (date > n.date) return true;
  if (date < n.date) return false;
  return time > n.time;
}

function sessionById(data, id) {
  return (data && data.sessions || []).find(x => x && x.id === id) || null;
}

function attOn(s, cid) {
  return (s && s.att || []).find(x => x && x.cid === cid) || null;
}

/**
 * Compare stored vs incoming data and list new/extended FUTURE attendances
 * that would exceed paid hours. Historical sessions are never blocked.
 */
function bookingDiff(stored, incoming, opts) {
  const now = (opts && opts.now) || casablancaParts();
  const addedByCid = Object.create(null);
  const items = [];
  (incoming && incoming.sessions || []).forEach(s => {
    if (!s || !isFutureSession(s, now)) return;
    const dur = sessionDuration(s);
    if (!(dur > 0)) return;
    const prev = stored ? sessionById(stored, s.id) : null;
    const prevDur = prev ? sessionDuration(prev) : 0;
    (s.att || []).forEach(a => {
      if (!attUsed(a)) return;
      const was = prev ? attOn(prev, a.cid) : null;
      const wasUsed = was && attUsed(was);
      const added = wasUsed ? Math.max(0, dur - prevDur) : dur;
      if (!(added > 0)) return;
      if (!addedByCid[a.cid]) addedByCid[a.cid] = 0;
      addedByCid[a.cid] += added;
      items.push({
        cid: a.cid,
        sessionId: s.id,
        date: s.date,
        time: s.time,
        added,
        duration: dur,
        override: !!(a.hoursOverride),
      });
    });
  });
  const blocked = [];
  const allowed = [];
  Object.keys(addedByCid).forEach(cid => {
    const base = stored
      ? snapshot(stored, cid)
      : snapshot({ candidates: incoming.candidates, payments: incoming.payments, sessions: [] }, cid);
    if (!base.applicable) return;
    const need = addedByCid[cid];
    if (!(base.left < need - 1e-9)) return;
    const rows = items.filter(x => x.cid === cid);
    const allOverridden = rows.every(x => x.override);
    const rec = {
      cid,
      name: base.name,
      left: base.left,
      need,
      entitled: base.entitled,
      used: base.used,
      sessions: rows,
    };
    if (allOverridden) allowed.push(rec);
    else blocked.push(rec);
  });
  return { blocked, allowed, items };
}

function canOverride(role) {
  return role === 'manager';
}

function stampOverride(att, actor, at) {
  const prev = att && typeof att.hoursOverride === 'object' ? att.hoursOverride : {};
  return {
    by: (actor && actor.id) || '',
    byName: (actor && actor.name) || '',
    at: at || new Date().toISOString(),
    reason: typeof prev.reason === 'string' ? prev.reason.slice(0, 200) : '',
  };
}

function guardBookings(stored, incoming, opts) {
  const reason = (opts && opts.reason) || '';
  if (!stored) return { ok: true, skipped: 'no_stored' };
  if (reason === 'import') return { ok: true, skipped: 'import' };
  const role = (opts && opts.role) || '';
  const actor = (opts && opts.user) || null;
  const diff = bookingDiff(stored, incoming, opts);
  if (!diff.blocked.length && !diff.allowed.length) return { ok: true, blocked: [], overrides: [] };

  if (diff.blocked.length) {
    const wantsOverride = diff.blocked.every(b => b.sessions.every(s => s.override));
    if (!(wantsOverride && canOverride(role))) {
      return { ok: false, error: 'paid_hours_blocked', status: 403, blocked: diff.blocked.map(b => ({
        cid: b.cid, name: b.name, left: b.left, need: b.need,
        entitled: b.entitled, used: b.used,
      })) };
    }
    // manager marked override on the blocked ones — treat as allowed
    diff.allowed = diff.allowed.concat(diff.blocked);
    diff.blocked = [];
  }

  if (diff.allowed.length && !canOverride(role)) {
    return { ok: false, error: 'paid_hours_blocked', status: 403, blocked: diff.allowed.map(b => ({
      cid: b.cid, name: b.name, left: b.left, need: b.need, entitled: b.entitled, used: b.used,
    })) };
  }

  const at = new Date().toISOString();
  const overrides = [];
  if (canOverride(role)) {
    (incoming.sessions || []).forEach(s => {
      if (!s || !isFutureSession(s, opts && opts.now)) return;
      (s.att || []).forEach(a => {
        if (!a || !a.hoursOverride) {
          if (a) delete a.hoursOverride;
          return;
        }
        const row = (diff.allowed || []).some(b => b.cid === a.cid && b.sessions.some(x => x.sessionId === s.id));
        if (!row) { delete a.hoursOverride; return; }
        a.hoursOverride = stampOverride(a, actor, at);
        overrides.push({
          id: 'ho-' + nodeCrypto.randomBytes(5).toString('hex'),
          cid: a.cid,
          sessionId: s.id,
          date: s.date,
          time: s.time,
          duration: sessionDuration(s),
          at,
          by: a.hoursOverride.by,
          byName: a.hoursOverride.byName,
          reason: a.hoursOverride.reason || '',
        });
      });
    });
  } else {
    (incoming.sessions || []).forEach(s => {
      (s.att || []).forEach(a => { if (a) delete a.hoursOverride; });
    });
  }
  return { ok: true, blocked: [], overrides };
}

function applyOverrides(data, overrides, actor) {
  if (!overrides || !overrides.length) return data;
  if (!Array.isArray(data.hoursOverrides)) data.hoursOverrides = [];
  overrides.forEach(o => data.hoursOverrides.unshift(o));
  if (data.hoursOverrides.length > 2000) data.hoursOverrides.length = 2000;
  if (!Array.isArray(data.log)) data.log = [];
  overrides.forEach(o => {
    data.log.unshift({
      id: 'l-' + (o.id || nodeCrypto.randomBytes(4).toString('hex')),
      date: o.at,
      user: (actor && (actor.username || actor.name)) || o.byName || '',
      text: 'تجاوز حظر الساعات المدفوعة: ' + (o.cid || '') + ' — ' + (o.date || '') + ' ' + (o.time || ''),
    });
  });
  return data;
}

function lowHoursStudents(data, opts) {
  const role = (opts && opts.role) || 'manager';
  if (role === 'monitor') return [];
  const out = [];
  (data && data.candidates || []).forEach(c => {
    if (!c || c.stage === 'done') return;
    const snap = snapshot(data, c.id);
    if (!snap.applicable || !snap.warning) return;
    out.push(snap);
  });
  out.sort((a, b) => a.left - b.left);
  return out;
}

function publicSnapshot(data, cid) {
  const s = snapshot(data, cid);
  return {
    applicable: s.applicable,
    entitled: s.entitled,
    used: s.used,
    left: s.left,
    warning: s.warning,
    blocked: s.blocked,
    packageHours: s.packageHours,
    paid: s.paid,
    price: s.price,
  };
}

function install(app) {
  app.get('/hours.js', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript');
    res.sendFile(nodePath.join(__dirname, 'hours.js'));
  });
}

const hoursApi = {
  install, packageHours, paidOf, entitledHours, hoursUsed, snapshot, publicSnapshot,
  formatHours, isFutureSession, bookingDiff, guardBookings, applyOverrides,
  canOverride, lowHoursStudents, casablancaParts, WARN_HOURS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = hoursApi;
if (typeof window !== 'undefined') window.OQHours = hoursApi;
