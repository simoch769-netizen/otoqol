'use strict';
const crypto = require('crypto');
const dues = require('./dues');
const templates = require('./templates');

const TITLE_MAX = 200;
const DUE_SILENCE_DAYS = 7;
const EXAM_WINDOW_DAYS = 14;
const DOC_WINDOW_DAYS = 30;

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

function todayCasablanca() { return casablancaParts().date; }

function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(from, to) { return dues.daysBetween(from, to); }

function sanitizeTitle(s) {
  let t = String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX);
  return t;
}

function taskStateOf(data) {
  const raw = data && data.taskState && typeof data.taskState === 'object' && !Array.isArray(data.taskState)
    ? data.taskState : {};
  return {
    dismissed: raw.dismissed && typeof raw.dismissed === 'object' && !Array.isArray(raw.dismissed) ? Object.assign({}, raw.dismissed) : {},
    sessionReminded: raw.sessionReminded && typeof raw.sessionReminded === 'object' && !Array.isArray(raw.sessionReminded) ? Object.assign({}, raw.sessionReminded) : {},
    examConvoked: raw.examConvoked && typeof raw.examConvoked === 'object' && !Array.isArray(raw.examConvoked) ? Object.assign({}, raw.examConvoked) : {},
  };
}

function isDismissed(state, key, today) {
  return !!(state.dismissed && state.dismissed[key] === today);
}

function isStaff(role) {
  return role === 'manager' || role === 'secretary' || role === 'owner';
}

function isPastSession(s, today, nowTime) {
  const date = String(s.date || '').slice(0, 10);
  if (!date) return false;
  if (date < today) return true;
  if (date > today) return false;
  const tm = String(s.time || '00:00').slice(0, 5);
  return tm <= nowTime;
}

function candOf(data, cid) {
  return (data.candidates || []).find(c => c && c.id === cid) || null;
}

function monOf(data, mid) {
  return (data.monitors || []).find(m => m && m.id === mid) || null;
}

function userName(data, id) {
  if (!id) return '';
  const u = (data.users || []).find(x => x && x.id === id);
  if (u) return u.name || '';
  const m = monOf(data, id);
  return m ? m.name : '';
}

function waFor(type, data, c, extra, lang) {
  if (!c || !c.phone) return '';
  const l = lang || templates.studentLang(c, data.settings, data.messageTemplates);
  const vars = Object.assign({
    school: (data.settings && data.settings.school) || 'Otoqol',
    student: c.name || '',
    phone: (data.settings && data.settings.phone) || '',
  }, extra || {});
  if (vars.type === 'code' || vars.type === 'conduite' || vars.type === 'drive') {
    vars.type = templates.typeLabel(vars.type, l);
  }
  const text = templates.render(type, vars, l, data.messageTemplates);
  return templates.waLink(c.phone, text);
}

function buildInbox(data, opts) {
  const today = (opts && opts.today) || todayCasablanca();
  const nowTime = (opts && opts.nowTime) || casablancaParts().time;
  const role = (opts && opts.role) || 'manager';
  const userId = (opts && opts.userId) || '';
  const staff = isStaff(role);
  const monOnly = role === 'monitor';
  const state = taskStateOf(data);
  const items = [];
  const push = it => { if (it && !isDismissed(state, it.key, today)) items.push(it); };

  // Portal booking / cancel requests
  if (staff) {
    (data.bookings || []).forEach(b => {
      if (!b || b.status !== 'pending') return;
      const c = candOf(data, b.cid);
      const kind = b.kind === 'cancel' ? 'booking_cancel' : 'booking_pending';
      push({
        key: kind + ':' + b.id,
        type: kind,
        priority: kind === 'booking_cancel' ? 1 : 2,
        bookingId: b.id,
        bookingKind: b.kind || 'book',
        cid: b.cid,
        studentName: c ? c.name : '',
        phone: c ? (c.phone || '') : '',
        date: b.date || '',
        time: b.time || '',
        sessionType: b.type || '',
        instructor: monOf(data, b.monitorId) ? monOf(data, b.monitorId).name : '',
      });
    });
  }

  // Overdue dues not reminded in the last 7 days
  if (staff) {
    (data.candidates || []).forEach(c => {
      if (!c) return;
      const due = dues.dueOf(data, c.id);
      if (!(due > 0)) return;
      const last = dues.lastReminder(data, c.id);
      const lastDate = last ? String(last.date || last.at || '').slice(0, 10) : null;
      const silent = lastDate ? daysBetween(lastDate, today) : dues.daysSilent(data, c, today);
      if (lastDate && silent < DUE_SILENCE_DAYS) return;
      if (!lastDate && !(silent >= 1)) return;
      const lang = templates.studentLang(c, data.settings, data.messageTemplates);
      push({
        key: 'due:' + c.id,
        type: 'due_remind',
        priority: 3,
        cid: c.id,
        studentName: c.name,
        phone: c.phone || '',
        due,
        daysSilent: silent == null ? 0 : silent,
        lastReminderDate: lastDate,
        whatsappUrl: waFor('debt', data, c, { amount: due, due: due }, lang),
      });
    });
  }

  const tomorrow = addDays(today, 1);
  (data.sessions || []).forEach(s => {
    if (!s) return;
    if (monOnly && s.monitorId !== userId) return;
    const mon = monOf(data, s.monitorId);
    const date = String(s.date || '').slice(0, 10);

    if (date === tomorrow && !state.sessionReminded[s.id]) {
      (s.att || []).forEach(a => {
        if (!a || a.status === 'absent') return;
        if (state.sessionReminded[s.id + ':' + a.cid]) return;
        const c = candOf(data, a.cid);
        if (!c) return;
        const lang = templates.studentLang(c, data.settings, data.messageTemplates);
        push({
          key: 'lesson_tomorrow:' + s.id + ':' + a.cid,
          type: 'lesson_tomorrow',
          priority: 4,
          sessionId: s.id,
          cid: a.cid,
          studentName: c.name,
          phone: c.phone || '',
          date, time: s.time || '',
          sessionType: s.type || '',
          instructor: mon ? mon.name : '',
          whatsappUrl: waFor('lesson_reminder', data, c, {
            date, time: s.time || '', instructor: mon ? mon.name : '', type: s.type || ''
          }, lang),
        });
      });
    }

    if (isPastSession(s, today, nowTime)) {
      (s.att || []).forEach(a => {
        if (!a || (a.status && a.status !== 'planned' && a.status !== 'pending')) return;
        const c = candOf(data, a.cid);
        push({
          key: 'attendance:' + s.id + ':' + (a.cid || ''),
          type: 'attendance_open',
          priority: 2,
          sessionId: s.id,
          cid: a.cid,
          studentName: c ? c.name : '',
          phone: c ? (c.phone || '') : '',
          date, time: s.time || '',
          sessionType: s.type || '',
          instructor: mon ? mon.name : '',
        });
      });
    }
  });

  (data.candidates || []).forEach(c => {
    if (!c) return;
    if (monOnly && c.monitorId !== userId) return;
    (c.exams || []).forEach(e => {
      if (!e) return;
      const ed = String(e.date || '').slice(0, 10);
      if (!ed || ed < today || ed > addDays(today, EXAM_WINDOW_DAYS)) return;
      const res = e.result || 'في الانتظار';
      if (res !== 'في الانتظار') return;
      const ek = c.id + ':' + e.id;
      if (state.examConvoked[ek]) return;
      const lang = templates.studentLang(c, data.settings, data.messageTemplates);
      push({
        key: 'exam:' + ek,
        type: 'exam_upcoming',
        priority: 5,
        cid: c.id,
        examId: e.id,
        studentName: c.name,
        phone: c.phone || '',
        date: ed,
        sessionType: e.type || '',
        whatsappUrl: waFor('exam', data, c, { date: ed, type: e.type || '' }, lang),
      });
    });
  });

  if (staff) {
    (data.candidates || []).forEach(c => {
      if (!c || c.stage === 'done') return;
      if (c.medical === true) return;
      push({
        key: 'doc:medical:' + c.id,
        type: 'doc_medical',
        priority: 6,
        cid: c.id,
        studentName: c.name,
        phone: c.phone || '',
      });
    });
    (data.vehicles || []).forEach(v => {
      if (!v) return;
      [['insurance', 'doc_insurance'], ['visit', 'doc_visit'], ['tax', 'doc_tax']].forEach(([field, type]) => {
        const d = v[field] ? String(v[field]).slice(0, 10) : '';
        if (!d) return;
        const left = daysBetween(today, d);
        if (left == null || left > DOC_WINDOW_DAYS) return;
        push({
          key: 'doc:' + field + ':' + v.id,
          type,
          priority: left < 0 ? 3 : 6,
          vehicleId: v.id,
          plate: v.plate || '',
          date: d,
          daysLeft: left,
        });
      });
    });
  }

  (data.tasks || []).forEach(tk => {
    if (!tk || tk.doneAt) return;
    if (monOnly && tk.assigneeId && tk.assigneeId !== userId) return;
    if (monOnly && !tk.assigneeId && tk.createdBy && tk.createdBy !== userId) return;
    const due = tk.due ? String(tk.due).slice(0, 10) : today;
    if (due > addDays(today, 1)) return; // only today, overdue, and tomorrow
    const c = tk.cid ? candOf(data, tk.cid) : null;
    const overdue = due < today;
    push({
      key: 'manual:' + tk.id,
      type: 'manual',
      priority: overdue ? 2 : 7,
      taskId: tk.id,
      title: tk.title || '',
      cid: tk.cid || '',
      studentName: c ? c.name : '',
      phone: c ? (c.phone || '') : '',
      date: due,
      overdue,
      assigneeId: tk.assigneeId || '',
      assigneeName: userName(data, tk.assigneeId),
      createdBy: tk.createdBy || '',
    });
  });

  items.sort((a, b) => (a.priority - b.priority)
    || String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.studentName || a.title || '').localeCompare(String(b.studentName || b.title || ''), 'ar'));

  return { today, count: items.length, items };
}

function install(app, deps) {
  const { store, auth, cachedData, bump } = deps;

  const staff = (req, res, next) => {
    if (isStaff(req.role) || req.role === 'monitor') return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  const mutate = (schoolId, reason, fn) => {
    for (let i = 0; i < 8; i++) {
      const cur = store.getData(schoolId);
      if (!cur || cur.data == null) return { error: 'no_data', status: 400 };
      let data;
      try { data = JSON.parse(cur.data); } catch (e) { return { error: 'no_data', status: 400 }; }
      if (!Array.isArray(data.tasks)) data.tasks = [];
      if (!data.taskState || typeof data.taskState !== 'object' || Array.isArray(data.taskState)) data.taskState = {};
      const extra = fn(data) || {};
      if (extra.error) return extra;
      const r = store.putData(schoolId, cur.version, JSON.stringify(data), reason);
      if (r.ok) { bump(schoolId); return { ok: true, data, version: r.version, ...extra }; }
    }
    return { error: 'version_conflict', status: 409 };
  };

  const ctxOf = req => ({
    role: req.role,
    userId: req.appUser && req.appUser.id,
    today: todayCasablanca(),
  });

  const inboxOf = (req, data) => buildInbox(data || cachedData(req.school.id) || {}, ctxOf(req));

  app.get('/api/tasks', auth, staff, (req, res) => {
    const data = cachedData(req.school.id) || {};
    res.set('Cache-Control', 'no-store');
    res.json(inboxOf(req, data));
  });

  app.post('/api/tasks', auth, staff, (req, res) => {
    const title = sanitizeTitle(req.body && req.body.title);
    if (!title) return res.status(400).json({ error: 'title_required' });
    const due = String((req.body && req.body.due) || todayCasablanca()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: 'bad_date' });
    let cid = String((req.body && req.body.cid) || '');
    let assigneeId = String((req.body && req.body.assigneeId) || '');
    const me = req.appUser && req.appUser.id;
    if (req.role === 'monitor') assigneeId = me || assigneeId;
    const r = mutate(req.school.id, 'task-create', data => {
      if (cid && !candOf(data, cid)) return { error: 'candidate_not_found', status: 404 };
      if (assigneeId) {
        const ok = (data.users || []).some(u => u && u.id === assigneeId) || (data.monitors || []).some(m => m && m.id === assigneeId);
        if (!ok) return { error: 'assignee_not_found', status: 400 };
      }
      if (req.role === 'monitor' && assigneeId && assigneeId !== me) return { error: 'forbidden', status: 403 };
      const rec = {
        id: 't-' + crypto.randomBytes(6).toString('hex'),
        title, due, cid: cid || '',
        assigneeId: assigneeId || '',
        createdAt: new Date().toISOString(),
        createdBy: me || '',
        createdByName: req.appUser && req.appUser.name,
      };
      data.tasks.unshift(rec);
      if (data.tasks.length > 2000) data.tasks.length = 2000;
      return { rec };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.status(201).json({ ok: true, task: r.rec, ...inboxOf(req, r.data) });
  });

  app.post('/api/tasks/:id/done', auth, staff, (req, res) => {
    const id = String(req.params.id || '');
    const me = req.appUser && req.appUser.id;
    const r = mutate(req.school.id, 'task-done', data => {
      const tk = (data.tasks || []).find(x => x && x.id === id);
      if (!tk) return { error: 'task_not_found', status: 404 };
      if (tk.doneAt) return { rec: tk };
      if (req.role === 'monitor' && tk.assigneeId && tk.assigneeId !== me && tk.createdBy !== me) {
        return { error: 'forbidden', status: 403 };
      }
      tk.doneAt = new Date().toISOString();
      tk.doneBy = me || '';
      return { rec: tk };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, task: r.rec, ...inboxOf(req, r.data) });
  });

  app.delete('/api/tasks/:id', auth, staff, (req, res) => {
    const id = String(req.params.id || '');
    const me = req.appUser && req.appUser.id;
    const r = mutate(req.school.id, 'task-delete', data => {
      const tk = (data.tasks || []).find(x => x && x.id === id);
      if (!tk) return { error: 'task_not_found', status: 404 };
      if (req.role === 'monitor' && tk.createdBy !== me && tk.assigneeId !== me) {
        return { error: 'forbidden', status: 403 };
      }
      data.tasks = data.tasks.filter(x => x && x.id !== id);
      return { rec: { id } };
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, ...inboxOf(req, r.data) });
  });

  app.post('/api/tasks/dismiss', auth, staff, (req, res) => {
    const key = String((req.body && req.body.key) || '');
    if (!key || key.length > 120) return res.status(400).json({ error: 'bad_key' });
    const today = todayCasablanca();
    const preview = inboxOf(req, cachedData(req.school.id) || {});
    if (req.role === 'monitor' && !preview.items.some(i => i.key === key) && !isDismissed(taskStateOf(cachedData(req.school.id) || {}), key, today)) {
      // allow dismissing only visible keys; if already dismissed, ok
      if (!preview.items.some(i => i.key === key)) return res.status(403).json({ error: 'forbidden' });
    }
    const r = mutate(req.school.id, 'task-dismiss', data => {
      const st = taskStateOf(data);
      st.dismissed[key] = today;
      data.taskState = st;
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, ...inboxOf(req, r.data) });
  });

  app.post('/api/tasks/session/:sid/reminded', auth, staff, (req, res) => {
    const sid = String(req.params.sid || '');
    if (!sid) return res.status(400).json({ error: 'bad_request' });
    const r = mutate(req.school.id, 'task-session-reminded', data => {
      const s = (data.sessions || []).find(x => x && x.id === sid);
      if (!s) return { error: 'session_not_found', status: 404 };
      if (req.role === 'monitor' && s.monitorId !== (req.appUser && req.appUser.id)) return { error: 'forbidden', status: 403 };
      const cid = String((req.body && req.body.cid) || '');
      const st = taskStateOf(data);
      st.sessionReminded[cid ? sid + ':' + cid : sid] = todayCasablanca();
      data.taskState = st;
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, ...inboxOf(req, r.data) });
  });

  app.post('/api/tasks/exam/:cid/:eid/convoked', auth, staff, (req, res) => {
    const cid = String(req.params.cid || ''), eid = String(req.params.eid || '');
    const r = mutate(req.school.id, 'task-exam-convoked', data => {
      const c = candOf(data, cid);
      if (!c) return { error: 'candidate_not_found', status: 404 };
      if (req.role === 'monitor' && c.monitorId !== (req.appUser && req.appUser.id)) return { error: 'forbidden', status: 403 };
      const e = (c.exams || []).find(x => x && x.id === eid);
      if (!e) return { error: 'exam_not_found', status: 404 };
      const st = taskStateOf(data);
      st.examConvoked[cid + ':' + eid] = todayCasablanca();
      data.taskState = st;
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, ...inboxOf(req, r.data) });
  });
}

module.exports = {
  install, buildInbox, taskStateOf, isDismissed, isPastSession, addDays,
  todayCasablanca, casablancaParts, sanitizeTitle, DUE_SILENCE_DAYS,
};
