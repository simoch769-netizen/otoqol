// Staff to-do inbox: unit + API roles + Playwright (desktop + phone).
// node scripts/tasks-inbox-test.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const tasks = require('../src/tasks');

let pw;
try { pw = require('playwright-core'); } catch (e1) {
  try { pw = require('/tmp/pw/node_modules/playwright-core'); } catch (e2) {
    pw = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
  }
}

let fails = 0;
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };

function startServer(dir, extraEnv) {
  const env = Object.assign({}, process.env, {
    DATA_DIR: dir, DB_FILE: path.join(dir, 'otoqol.sqlite'),
    JWT_SECRET: 'tasks-test-secret-32chars-xxxxxx', NODE_ENV: 'test',
    SEED_SCHOOL_CODE: 'demo', SEED_SCHOOL_NAME: 'Demo',
    SEED_SCHOOL_PASSWORD: 'SchoolPw2026!', DEFAULT_SCHOOL_CODE: 'demo',
    LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', PUBLIC_URL: 'http://127.0.0.1:' + (extraEnv && extraEnv.PORT || 4390)
  }, extraEnv || {});
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '';
  srv.stdout.on('data', d => { out += d; });
  srv.stderr.on('data', d => { out += d; });
  srv.logs = () => out.slice(-2000);
  return srv;
}
function kill(srv) { try { srv.kill('SIGTERM'); } catch (e) {} }
function waitUp(base, ms) {
  const until = Date.now() + (ms || 20000);
  return (async function poll() {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return true; } catch (e) {}
    if (Date.now() > until) return false;
    await new Promise(r => setTimeout(r, 200));
    return poll();
  }());
}
const H = { 'Content-Type': 'application/json', 'X-Otoqol': '1' };
const cookieOf = res => ((res.headers.get('set-cookie') || '').split(';')[0] || '');
async function req(base, method, url, body, cookie) {
  const r = await fetch(base + url, { method, headers: { ...H, Cookie: cookie || '' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, cookie: cookieOf(r) || cookie };
}

function typesOf(box) { return (box.items || []).map(i => i.type); }
function hasType(box, type) { return (box.items || []).some(i => i.type === type); }
function byType(box, type) { return (box.items || []).filter(i => i.type === type); }

function sample(today) {
  const tomorrow = tasks.addDays(today, 1);
  const yesterday = tasks.addDays(today, -1);
  const inFive = tasks.addDays(today, 5);
  const inTen = tasks.addDays(today, 10);
  const expired = tasks.addDays(today, -5);
  return {
    settings: { school: 'مدرسة النور', phone: '0522000000', studentPortal: true },
    users: [
      { id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: 'MgrPass1' },
      { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: 'SecPass1' }
    ],
    monitors: [
      { id: 'm1', name: 'Karim Monitor', phone: '0611111111', username: 'karim', password: 'MonPass1' },
      { id: 'm2', name: 'Nadia Monitor', phone: '0622222222', username: 'nadia', password: 'MonPass2' }
    ],
    vehicles: [
      { id: 'v1', plate: 'A-12345', insurance: inTen, visit: tasks.addDays(today, 60), tax: expired }
    ],
    candidates: [
      { id: 'c1', name: 'Youssef Alami', cin: 'AB12345', phone: '0600000001', email: 'youssef@example.com', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-09-01', monitorId: 'm1', exams: [{ id: 'e1', type: 'code', date: inFive, result: 'في الانتظار' }] },
      { id: 'c2', name: 'Salma Bennani', cin: 'CD67890', phone: '0600000002', email: '', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'code', medical: false, notes: '', createdAt: '2026-09-02', monitorId: 'm2', exams: [] },
      { id: 'c3', name: 'Amina Alawi', cin: 'EF11111', phone: '0600000003', email: 'amina@example.com', license: 'B', price: 4000, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: '2026-10-01', monitorId: 'm1', exams: [{ id: 'e2', type: 'conduite', date: inFive, result: 'نجح' }] },
      { id: 'c4', name: 'Kamal Wafi', cin: 'GH22222', phone: '0600000004', email: '', license: 'B', price: 2000, codeHours: 10, driveHours: 20, stage: 'exam', medical: true, notes: '', createdAt: '2026-08-01', monitorId: 'm2', exams: [] }
    ],
    sessions: [
      { id: 's-past-m1', date: yesterday, time: '10:00', type: 'conduite', monitorId: 'm1', att: [{ cid: 'c1', status: 'planned' }] },
      { id: 's-past-m2', date: yesterday, time: '11:00', type: 'conduite', monitorId: 'm2', att: [{ cid: 'c4', status: 'present' }] },
      { id: 's-tom-m1', date: tomorrow, time: '09:00', type: 'code', monitorId: 'm1', att: [{ cid: 'c1', status: 'planned' }] },
      { id: 's-tom-m2', date: tomorrow, time: '14:00', type: 'conduite', monitorId: 'm2', att: [{ cid: 'c2', status: 'planned' }] }
    ],
    payments: [
      { id: 'p1', no: 1, cid: 'c1', amount: 1500, date: '2026-09-10', note: 'cash' },
      { id: 'p3', no: 3, cid: 'c4', amount: 2000, date: '2026-11-20', note: 'cash' }
    ],
    expenses: [], notifs: [], requests: [], notes: [], log: [],
    bookings: [
      { id: 'b1', kind: 'book', status: 'pending', cid: 'c1', date: tomorrow, time: '16:00', type: 'conduite', monitorId: 'm1' },
      { id: 'b2', kind: 'cancel', status: 'pending', cid: 'c2', date: tomorrow, time: '14:00', type: 'conduite', monitorId: 'm2' },
      { id: 'b3', kind: 'book', status: 'approved', cid: 'c3', date: tomorrow, time: '08:00', type: 'code', monitorId: 'm1' }
    ],
    reminders: [],
    tasks: [
      { id: 't-open', title: 'Call the guardian', due: today, cid: 'c1', assigneeId: 'm1', createdAt: today + 'T08:00:00.000Z', createdBy: 'u1' },
      { id: 't-future', title: 'Later task', due: tasks.addDays(today, 10), assigneeId: 'u2', createdAt: today + 'T08:00:00.000Z', createdBy: 'u1' },
      { id: 't-done', title: 'Already done', due: today, doneAt: today + 'T09:00:00.000Z', createdBy: 'u1' },
      { id: 't-m2', title: 'Nadia only', due: today, assigneeId: 'm2', createdAt: today + 'T08:00:00.000Z', createdBy: 'u1' }
    ],
    taskState: { dismissed: {}, sessionReminded: {}, examConvoked: {} }
  };
}

function patchData(dbFile, fn) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  const row = db.prepare('SELECT school_id, version, data FROM school_data').get();
  const data = JSON.parse(row.data);
  fn(data);
  db.prepare('UPDATE school_data SET version = ?, data = ?, updated_at = datetime(\'now\') WHERE school_id = ?')
    .run(row.version + 1, JSON.stringify(data), row.school_id);
  db.close();
}

(async () => {
  const TODAY = tasks.todayCasablanca();
  const tomorrow = tasks.addDays(TODAY, 1);
  const yesterday = tasks.addDays(TODAY, -1);
  const data = sample(TODAY);

  // ---------- unit ----------
  t('addDays tomorrow', tomorrow === tasks.addDays(TODAY, 1));
  t('isPast yesterday', tasks.isPastSession({ date: yesterday, time: '10:00' }, TODAY, '12:00') === true);
  t('isPast tomorrow false', tasks.isPastSession({ date: tomorrow, time: '10:00' }, TODAY, '12:00') === false);
  t('isPast today earlier', tasks.isPastSession({ date: TODAY, time: '08:00' }, TODAY, '12:00') === true);
  t('isPast today later false', tasks.isPastSession({ date: TODAY, time: '18:00' }, TODAY, '12:00') === false);
  t('sanitize title trims and caps', tasks.sanitizeTitle('  hello  ') === 'hello' && tasks.sanitizeTitle('x'.repeat(250)).length === 200);

  const mgr = tasks.buildInbox(data, { role: 'manager', userId: 'u1', today: TODAY, nowTime: '12:00' });
  const types = typesOf(mgr);
  t('manager sees pending booking', mgr.items.some(i => i.type === 'booking_pending' && i.bookingId === 'b1'));
  t('manager sees cancel request', mgr.items.some(i => i.type === 'booking_cancel' && i.bookingId === 'b2'));
  t('approved booking excluded', !mgr.items.some(i => i.bookingId === 'b3'));
  t('manager sees due reminders for unpaid', mgr.items.some(i => i.type === 'due_remind' && i.cid === 'c1') && mgr.items.some(i => i.type === 'due_remind' && i.cid === 'c2'));
  t('paid-in-full not a due task', !mgr.items.some(i => i.type === 'due_remind' && i.cid === 'c4'));
  t('due item has whatsapp url', (byType(mgr, 'due_remind').find(i => i.cid === 'c1') || {}).whatsappUrl && /wa\.me/.test(byType(mgr, 'due_remind').find(i => i.cid === 'c1').whatsappUrl));
  t('tomorrow lessons for both monitors', mgr.items.some(i => i.type === 'lesson_tomorrow' && i.sessionId === 's-tom-m1') && mgr.items.some(i => i.type === 'lesson_tomorrow' && i.sessionId === 's-tom-m2'));
  t('past unattended for m1 student', mgr.items.some(i => i.type === 'attendance_open' && i.sessionId === 's-past-m1' && i.cid === 'c1'));
  t('present attendance excluded', !mgr.items.some(i => i.sessionId === 's-past-m2' && i.type === 'attendance_open'));
  t('upcoming pending exam only', mgr.items.some(i => i.type === 'exam_upcoming' && i.examId === 'e1') && !mgr.items.some(i => i.examId === 'e2'));
  t('missing medical', mgr.items.some(i => i.type === 'doc_medical' && i.cid === 'c2'));
  t('medical already true excluded', !mgr.items.some(i => i.type === 'doc_medical' && i.cid === 'c1'));
  t('insurance expiring and tax expired', mgr.items.some(i => i.type === 'doc_insurance' && i.vehicleId === 'v1') && mgr.items.some(i => i.type === 'doc_tax' && i.vehicleId === 'v1'));
  t('visit far away excluded', !mgr.items.some(i => i.type === 'doc_visit'));
  t('open manual today included', mgr.items.some(i => i.type === 'manual' && i.taskId === 't-open'));
  t('future and done manuals excluded', !mgr.items.some(i => i.taskId === 't-future') && !mgr.items.some(i => i.taskId === 't-done'));
  t('count matches items', mgr.count === mgr.items.length && mgr.count > 8);

  const recent = JSON.parse(JSON.stringify(data));
  recent.reminders = [{ id: 'r1', cid: 'c1', date: TODAY, at: TODAY + 'T10:00:00.000Z', channel: 'manual' }];
  const afterRem = tasks.buildInbox(recent, { role: 'manager', today: TODAY, nowTime: '12:00' });
  t('recently reminded due disappears', !afterRem.items.some(i => i.type === 'due_remind' && i.cid === 'c1') && afterRem.items.some(i => i.type === 'due_remind' && i.cid === 'c2'));

  const oldRem = JSON.parse(JSON.stringify(data));
  oldRem.reminders = [{ id: 'r1', cid: 'c1', date: tasks.addDays(TODAY, -8), channel: 'manual' }];
  const oldBox = tasks.buildInbox(oldRem, { role: 'manager', today: TODAY, nowTime: '12:00' });
  t('due reminded 8 days ago returns', oldBox.items.some(i => i.type === 'due_remind' && i.cid === 'c1'));

  const dismissed = JSON.parse(JSON.stringify(data));
  dismissed.taskState.dismissed['due:c2'] = TODAY;
  const hid = tasks.buildInbox(dismissed, { role: 'manager', today: TODAY, nowTime: '12:00' });
  t('dismissed today hidden', !hid.items.some(i => i.key === 'due:c2') && hid.count === mgr.count - 1);
  dismissed.taskState.dismissed['due:c2'] = yesterday;
  const shown = tasks.buildInbox(dismissed, { role: 'manager', today: TODAY, nowTime: '12:00' });
  t('dismissed yesterday returns today', shown.items.some(i => i.key === 'due:c2'));

  const reminded = JSON.parse(JSON.stringify(data));
  reminded.taskState.sessionReminded['s-tom-m1:c1'] = TODAY;
  t('session reminded hides tomorrow item', !tasks.buildInbox(reminded, { role: 'manager', today: TODAY, nowTime: '12:00' }).items.some(i => i.key === 'lesson_tomorrow:s-tom-m1:c1'));
  const conv = JSON.parse(JSON.stringify(data));
  conv.taskState.examConvoked['c1:e1'] = TODAY;
  t('exam convoked hides item', !tasks.buildInbox(conv, { role: 'manager', today: TODAY, nowTime: '12:00' }).items.some(i => i.type === 'exam_upcoming' && i.examId === 'e1'));

  const mon1 = tasks.buildInbox(data, { role: 'monitor', userId: 'm1', today: TODAY, nowTime: '12:00' });
  t('monitor has no dues, docs, bookings', !hasType(mon1, 'due_remind') && !hasType(mon1, 'doc_insurance') && !hasType(mon1, 'doc_tax') && !hasType(mon1, 'doc_medical') && !hasType(mon1, 'booking_pending') && !hasType(mon1, 'booking_cancel'));
  t('monitor sees own tomorrow and attendance', mon1.items.some(i => i.sessionId === 's-tom-m1') && mon1.items.some(i => i.sessionId === 's-past-m1'));
  t('monitor does not see other monitor lessons', !mon1.items.some(i => i.sessionId === 's-tom-m2' || i.sessionId === 's-past-m2'));
  t('monitor sees assigned student exam', mon1.items.some(i => i.type === 'exam_upcoming' && i.cid === 'c1'));
  t('monitor sees only own manual', mon1.items.some(i => i.taskId === 't-open') && !mon1.items.some(i => i.taskId === 't-m2'));

  const mon2 = tasks.buildInbox(data, { role: 'monitor', userId: 'm2', today: TODAY, nowTime: '12:00' });
  t('m2 sees own manual and lesson only', mon2.items.some(i => i.taskId === 't-m2') && !mon2.items.some(i => i.taskId === 't-open') && mon2.items.some(i => i.sessionId === 's-tom-m2') && !mon2.items.some(i => i.sessionId === 's-tom-m1'));

  const ranked = mgr.items.map(i => i.priority);
  t('items sorted by priority', ranked.slice().sort((a, b) => a - b).join(',') === ranked.join(','));

  // ---------- API ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-tasks-'));
  const PORT = Number(process.env.TASKS_PORT || 4390);
  const B = 'http://127.0.0.1:' + PORT;
  const dbFile = path.join(dir, 'otoqol.sqlite');
  const srv = startServer(dir, { PORT: String(PORT) });
  t('server starts', await waitUp(B), srv.logs());

  const login = await req(B, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const schoolCk = login.cookie;
  const cur = await req(B, 'GET', '/api/db', undefined, schoolCk);
  const seed = sample(TODAY);
  // bookings/tasks/taskState are SERVER_OWNED — strip them from the PUT payload
  const putSeed = Object.assign({}, seed);
  delete putSeed.bookings; delete putSeed.tasks; delete putSeed.taskState; delete putSeed.reminders;
  const put = await req(B, 'PUT', '/api/db', { version: cur.j.version, data: putSeed }, schoolCk);
  t('seed data', put.s === 200, JSON.stringify(put.j));
  patchData(dbFile, d => {
    d.bookings = seed.bookings;
    d.tasks = seed.tasks;
    d.taskState = seed.taskState;
  });

  const unauth = await req(B, 'GET', '/api/tasks');
  t('unauth tasks -> 401', unauth.s === 401);

  const noCsrf = await fetch(B + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: schoolCk }, body: JSON.stringify({ title: 'x' }) });
  t('POST without X-Otoqol -> 403', noCsrf.status === 403);

  const mgrL = await req(B, 'POST', '/api/signin', { username: 'admin', password: 'MgrPass1' });
  t('manager signin', mgrL.s === 200 && mgrL.j.user.role === 'manager');
  const mck = mgrL.cookie;

  const list = await req(B, 'GET', '/api/tasks', undefined, mck);
  t('manager list 200 with items', list.s === 200 && list.j.count === list.j.items.length && list.j.count > 8, JSON.stringify(list.j.items && list.j.items.map(i => i.type + ':' + (i.key || ''))));
  t('API has bookings, dues, lessons, attendance, exam, docs, manual',
    hasType(list.j, 'booking_pending') && hasType(list.j, 'booking_cancel') && hasType(list.j, 'due_remind') &&
    hasType(list.j, 'lesson_tomorrow') && hasType(list.j, 'attendance_open') && hasType(list.j, 'exam_upcoming') &&
    hasType(list.j, 'doc_medical') && hasType(list.j, 'doc_insurance') && hasType(list.j, 'doc_tax') && hasType(list.j, 'manual'));

  const mon = await req(B, 'POST', '/api/signin', { username: 'karim', password: 'MonPass1' });
  t('monitor signin', mon.s === 200);
  const monList = await req(B, 'GET', '/api/tasks', undefined, mon.cookie);
  t('monitor list omits finance and bookings', monList.s === 200 && !hasType(monList.j, 'due_remind') && !hasType(monList.j, 'booking_pending') && !hasType(monList.j, 'doc_tax') && !hasType(monList.j, 'doc_insurance') && !hasType(monList.j, 'doc_medical'));
  t('monitor sees only own lessons/manual', monList.j.items.every(i => i.sessionId !== 's-tom-m2' && i.sessionId !== 's-past-m2' && i.taskId !== 't-m2') && monList.j.items.some(i => i.sessionId === 's-tom-m1' || i.taskId === 't-open'));

  const steal = await req(B, 'POST', '/api/tasks', { title: 'Steal', assigneeId: 'u1' }, mon.cookie);
  t('monitor assign-to-other is forced onto themselves', steal.s === 201 && steal.j.task && steal.j.task.assigneeId === 'm1', JSON.stringify(steal.j.task));

  const monCreate = await req(B, 'POST', '/api/tasks', { title: 'My note', due: TODAY }, mon.cookie);
  t('monitor can create own task', monCreate.s === 201 && monCreate.j.task && monCreate.j.task.assigneeId === 'm1', JSON.stringify(monCreate.j.task));

  const monDelOther = await req(B, 'DELETE', '/api/tasks/t-m2', undefined, mon.cookie);
  t('monitor cannot delete someone else task', monDelOther.s === 403);

  const hidDue = 'due:c2';
  const monDismiss = await req(B, 'POST', '/api/tasks/dismiss', { key: hidDue }, mon.cookie);
  t('monitor cannot dismiss a due they cannot see', monDismiss.s === 403);

  const monRemOther = await req(B, 'POST', '/api/tasks/session/s-tom-m2/reminded', { cid: 'c2' }, mon.cookie);
  t('monitor cannot ack other session', monRemOther.s === 403);

  const emptyTitle = await req(B, 'POST', '/api/tasks', { title: '  ' }, mck);
  t('empty title -> 400', emptyTitle.s === 400 && emptyTitle.j.error === 'title_required');

  const created = await req(B, 'POST', '/api/tasks', { title: 'Print NARSA pack', due: TODAY, cid: 'c1', assigneeId: 'u2' }, mck);
  t('manager creates manual task', created.s === 201 && created.j.task && created.j.task.title === 'Print NARSA pack' && created.j.items.some(i => i.taskId === created.j.task.id));
  const tid = created.j.task.id;

  const sec = await req(B, 'POST', '/api/signin', { username: 'secretary', password: 'SecPass1' });
  t('secretary signin', sec.s === 200);
  const secList = await req(B, 'GET', '/api/tasks', undefined, sec.cookie);
  t('secretary sees finance items', secList.s === 200 && hasType(secList.j, 'due_remind') && hasType(secList.j, 'booking_pending'));

  const done = await req(B, 'POST', '/api/tasks/' + tid + '/done', {}, mck);
  t('mark done removes from inbox', done.s === 200 && done.j.ok && !done.j.items.some(i => i.taskId === tid));

  const delMine = await req(B, 'DELETE', '/api/tasks/' + monCreate.j.task.id, undefined, mon.cookie);
  t('monitor can delete own created task', delMine.s === 200 && !delMine.j.items.some(i => i.taskId === monCreate.j.task.id));

  const before = (await req(B, 'GET', '/api/tasks', undefined, mck)).j.count;
  const dis = await req(B, 'POST', '/api/tasks/dismiss', { key: 'doc_medical:c2'.replace('doc_medical', 'doc:medical') }, mck);
  // key format is doc:medical:c2
  t('dismiss today hides item', dis.s === 200 && !dis.j.items.some(i => i.key === 'doc:medical:c2') && dis.j.count === before - 1, JSON.stringify(dis.j.items && dis.j.items.filter(i => i.type === 'doc_medical')));

  const ackLes = await req(B, 'POST', '/api/tasks/session/s-tom-m1/reminded', { cid: 'c1' }, mck);
  t('session reminded drops tomorrow item', ackLes.s === 200 && !ackLes.j.items.some(i => i.key === 'lesson_tomorrow:s-tom-m1:c1'));

  const ackEx = await req(B, 'POST', '/api/tasks/exam/c1/e1/convoked', {}, mck);
  t('exam convoked drops item', ackEx.s === 200 && !ackEx.j.items.some(i => i.type === 'exam_upcoming' && i.examId === 'e1'));

  // SERVER_OWNED: client PUT must not wipe tasks / taskState
  const cur2 = await req(B, 'GET', '/api/db', undefined, mck);
  const data2 = cur2.j.data;
  data2.tasks = [];
  data2.taskState = { dismissed: {}, sessionReminded: {}, examConvoked: {} };
  const wipe = await req(B, 'PUT', '/api/db', { version: cur2.j.version, data: data2 }, mck);
  t('PUT accepted while stripping tasks', wipe.s === 200);
  const kept = await req(B, 'GET', '/api/tasks', undefined, mck);
  t('manual done task and dismiss survive client PUT', kept.s === 200 && !kept.j.items.some(i => i.key === 'doc:medical:c2') && !kept.j.items.some(i => i.taskId === tid), JSON.stringify(kept.j.items && kept.j.items.map(i => i.key)));

  // ---------- Playwright ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-tasks-ui-'));
  const PORT2 = PORT + 2;
  const B2 = 'http://127.0.0.1:' + PORT2;
  const db2 = path.join(dir2, 'otoqol.sqlite');
  const srv2 = startServer(dir2, { PORT: String(PORT2), PUBLIC_URL: B2 });
  t('ui server starts', await waitUp(B2), srv2.logs());
  const login2 = await req(B2, 'POST', '/api/login', { school: 'demo', password: 'SchoolPw2026!' });
  const curU = await req(B2, 'GET', '/api/db', undefined, login2.cookie);
  const seed2 = sample(TODAY);
  const put2data = Object.assign({}, seed2);
  delete put2data.bookings; delete put2data.tasks; delete put2data.taskState; delete put2data.reminders;
  await req(B2, 'PUT', '/api/db', { version: curU.j.version, data: put2data }, login2.cookie);
  patchData(db2, d => {
    d.bookings = seed2.bookings;
    d.tasks = seed2.tasks.filter(x => !x.doneAt);
    d.taskState = { dismissed: {}, sessionReminded: {}, examConvoked: {} };
  });

  const OUT = process.env.TASKS_SHOT_DIR || path.join(__dirname, '..', 'test-shots', 'tasks-inbox');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
    const page = await ctx.newPage();
    await page.goto(B2 + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-oq-signin]', { timeout: 20000 });
    // login footer still only forgot-password + signup
    const footer = await page.evaluate(() => {
      const links = [...document.querySelectorAll('[data-oq-signin] a, [data-oq-signin] button.fp-link')].map(el => el.getAttribute('data-oq-forgot-link') != null ? 'forgot' : (el.getAttribute('data-oq-signup-link') != null ? 'signup' : (el.getAttribute('href') || el.textContent)));
      return { forgot: !!document.querySelector('[data-oq-forgot-link]'), signup: !!document.querySelector('[data-oq-signup-link]'), portal: !!document.querySelector('[data-oq-signin] a[href*="portal"]'), texts: links };
    });
    t('UI: login footer is only forgot + signup', footer.forgot && footer.signup && !footer.portal, JSON.stringify(footer));
    await page.fill('[data-oq-signin] input[name=username]', 'admin');
    await page.fill('[data-oq-signin] input[name=password]', 'MgrPass1');
    await page.click('[data-oq-signin] button.b.pri');
    await page.waitForSelector('.nav', { timeout: 20000 });
    await page.waitForSelector('[data-oq-nav-item="tasks"]', { timeout: 15000 });
    await page.waitForSelector('[data-oq-task-count]', { timeout: 15000 });
    const badge = Number(await page.locator('[data-oq-task-count]').innerText());
    t('UI: nav badge shows a count', badge > 0, String(badge));
    await page.locator('[data-oq-nav-item="tasks"]').click();
    await page.waitForSelector('[data-oq-tasks]', { timeout: 15000 });
    await page.waitForSelector('[data-oq-task-item]', { timeout: 15000 });
    const itemCount = await page.locator('[data-oq-task-item]').count();
    t('UI: inbox lists auto items', itemCount > 5, String(itemCount));
    t('UI: booking, due, tomorrow, attendance present',
      await page.locator('[data-oq-task-type="booking_pending"]').count() > 0 &&
      await page.locator('[data-oq-task-type="due_remind"]').count() > 0 &&
      await page.locator('[data-oq-task-type="lesson_tomorrow"]').count() > 0 &&
      await page.locator('[data-oq-task-type="attendance_open"]').count() > 0);
    await page.screenshot({ path: path.join(OUT, 'tasks-inbox.png'), fullPage: true });

    await page.fill('[data-oq-task-title]', 'Call the parent');
    await page.fill('[data-oq-task-due]', TODAY);
    await page.click('[data-oq-task-save]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-oq-task-item]')].some(el => el.textContent.includes('Call the parent')), { timeout: 15000 });
    t('UI: manual task appears', await page.locator('[data-oq-task-item]').filter({ hasText: 'Call the parent' }).count() === 1);
    await page.locator('[data-oq-task-item]').filter({ hasText: 'Call the parent' }).locator('[data-oq-task-done]').click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-oq-task-item]')].some(el => el.textContent.includes('Call the parent')), { timeout: 15000 });
    t('UI: mark done removes manual task', await page.locator('[data-oq-task-item]').filter({ hasText: 'Call the parent' }).count() === 0);

    const medical = page.locator('[data-oq-task-type="doc_medical"]').first();
    t('UI: medical doc item visible', await medical.count() === 1);
    await medical.locator('[data-oq-task-dismiss]').click();
    await page.waitForFunction(() => !document.querySelector('[data-oq-task-type="doc_medical"]'), { timeout: 15000 });
    t('UI: dismiss hides medical for today', await page.locator('[data-oq-task-type="doc_medical"]').count() === 0);
    await page.screenshot({ path: path.join(OUT, 'tasks-after-actions.png'), fullPage: true });

    // phone viewport + drawer
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.click('[data-oq-nav-toggle]');
    await page.waitForSelector('.nav.open', { timeout: 8000 });
    const drawer = await page.evaluate(() => {
      const nav = document.querySelector('[data-oq-nav]');
      const r = nav.getBoundingClientRect();
      return { w: Math.round(r.width), open: nav.classList.contains('open') };
    });
    t('UI: phone drawer about 270px', drawer.open && drawer.w <= 280 && drawer.w >= 200, JSON.stringify(drawer));
    await page.locator('[data-oq-nav-item="tasks"]').click();
    await page.waitForSelector('[data-oq-tasks]', { timeout: 10000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('UI: mobile no serious horizontal overflow', overflow <= 8, String(overflow));
    t('UI: phone inbox still lists items', await page.locator('[data-oq-task-item]').count() > 0);
    await page.screenshot({ path: path.join(OUT, 'tasks-mobile.png'), fullPage: true });
    console.log('SHOTS ' + OUT);
  } finally {
    await browser.close();
    kill(srv2);
    kill(srv);
  }

  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
