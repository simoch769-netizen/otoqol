'use strict';
const crypto = require('crypto');

const METHODS = ['cash', 'transfer', 'cheque', 'card'];
const METHOD_SET = new Set(METHODS);
const LABEL_MAX = 200;
const NOTE_MAX = 500;
const AMOUNT_MAX = 1e9;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366 * 3;

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

function daysBetween(from, to) {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function isOffice(role) {
  return role === 'manager' || role === 'secretary' || role === 'owner';
}

function isManager(role) {
  return role === 'manager' || role === 'owner';
}

function uid() { return crypto.randomBytes(6).toString('hex'); }

function validDate(s) { return DATE_RE.test(String(s || '')); }

function parseAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > AMOUNT_MAX) return null;
  return Math.round(n * 100) / 100;
}

function parseCounted(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > AMOUNT_MAX) return null;
  return Math.round(n * 100) / 100;
}

function sanitizeText(s, max) {
  let t = String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (t.length > max) t = t.slice(0, max);
  return t;
}

function normalizeMethod(raw) {
  const m = String(raw == null ? '' : raw).trim().toLowerCase();
  if (METHOD_SET.has(m)) return { method: m, inferred: false };
  return { method: 'cash', inferred: true };
}

function candidateName(data, cid) {
  const c = (data.candidates || []).find(x => x && x.id === cid);
  return c ? (c.name || '') : '';
}

function vehicleLabel(data, vid) {
  if (!vid) return '';
  const v = (data.vehicles || []).find(x => x && x.id === vid);
  return v ? (v.plate || v.model || '') : '';
}

function closeOf(data, date) {
  return (data.caisseCloses || []).find(c => c && c.date === date) || null;
}

function isClosed(data, date) {
  return !!closeOf(data, date);
}

function buildLines(data) {
  const lines = [];
  (data.payments || []).forEach(p => {
    if (!p || !validDate(p.date)) return;
    const amt = Number(p.amount);
    if (!Number.isFinite(amt) || amt === 0) return;
    const nm = normalizeMethod(p.method);
    const name = candidateName(data, p.cid);
    lines.push({
      id: 'p:' + p.id,
      source: 'payment',
      sourceId: p.id,
      date: p.date,
      direction: amt >= 0 ? 'in' : 'out',
      amount: Math.abs(amt),
      signed: amt,
      method: nm.method,
      methodInferred: nm.inferred,
      label: name || ('#' + (p.no || '')),
      studentName: name,
      receiptNo: p.no != null && p.no !== '' ? p.no : null,
      note: p.note || '',
      cid: p.cid || '',
    });
  });
  (data.expenses || []).forEach(e => {
    if (!e || !validDate(e.date)) return;
    const amt = Number(e.amount);
    if (!Number.isFinite(amt) || amt === 0) return;
    const nm = normalizeMethod(e.method);
    const veh = vehicleLabel(data, e.vehicleId);
    lines.push({
      id: 'e:' + e.id,
      source: 'expense',
      sourceId: e.id,
      date: e.date,
      direction: 'out',
      amount: Math.abs(amt),
      signed: -Math.abs(amt),
      method: nm.method,
      methodInferred: nm.inferred,
      label: e.label || e.category || '',
      category: e.category || '',
      vehicle: veh,
      vehicleId: e.vehicleId || '',
      note: e.note || '',
    });
  });
  (data.caisseEntries || []).forEach(en => {
    if (!en || !validDate(en.date)) return;
    const amt = Number(en.amount);
    if (!Number.isFinite(amt) || amt === 0) return;
    const dir = en.direction === 'out' ? 'out' : 'in';
    const signed = dir === 'in' ? Math.abs(amt) : -Math.abs(amt);
    const nm = normalizeMethod(en.method);
    lines.push({
      id: 'm:' + en.id,
      source: 'manual',
      sourceId: en.id,
      date: en.date,
      direction: dir,
      amount: Math.abs(amt),
      signed,
      method: nm.method,
      methodInferred: false,
      label: en.label || '',
      note: en.note || '',
      entryId: en.id,
    });
  });
  const order = { payment: 0, expense: 1, manual: 2 };
  lines.sort((a, b) => a.date.localeCompare(b.date) || (order[a.source] - order[b.source]) || String(a.id).localeCompare(String(b.id)));
  return lines;
}

function matchesMethod(line, method) {
  if (!method || method === 'all') return true;
  return line.method === method;
}

function sumSigned(lines, pred) {
  let s = 0;
  for (const l of lines) if (pred(l)) s += l.signed;
  return Math.round(s * 100) / 100;
}

function cashExpected(lines, date) {
  return sumSigned(lines, l => l.date === date && l.method === 'cash');
}

function journal(data, opts) {
  const today = (opts && opts.today) || todayCasablanca();
  let from = validDate(opts && opts.from) ? opts.from : today;
  let to = validDate(opts && opts.to) ? opts.to : from;
  if (from > to) { const t = from; from = to; to = t; }
  const method = (opts && opts.method && opts.method !== 'all' && METHOD_SET.has(opts.method)) ? opts.method : 'all';
  const all = buildLines(data);
  const filtered = all.filter(l => matchesMethod(l, method));
  const opening = sumSigned(filtered, l => l.date < from);
  const inRange = filtered.filter(l => l.date >= from && l.date <= to);
  const days = [];
  let run = opening;
  let d = from;
  const closeMap = {};
  (data.caisseCloses || []).forEach(c => { if (c && c.date) closeMap[c.date] = c; });
  while (d <= to) {
    const dayOpen = run;
    const dayLines = [];
    for (const l of inRange) {
      if (l.date !== d) continue;
      run = Math.round((run + l.signed) * 100) / 100;
      dayLines.push(Object.assign({}, l, { balance: run }));
    }
    const inn = sumSigned(dayLines, l => l.direction === 'in');
    const out = Math.round((sumSigned(dayLines, l => l.direction === 'out') * -1) * 100) / 100;
    const expectedCash = cashExpected(all, d);
    days.push({
      date: d,
      opening: dayOpen,
      closing: run,
      in: inn,
      out,
      net: Math.round((inn - out) * 100) / 100,
      expectedCash,
      close: closeMap[d] || null,
      lines: dayLines,
    });
    d = addDays(d, 1);
  }
  const totalsIn = sumSigned(inRange, l => l.direction === 'in');
  const totalsOut = Math.round((sumSigned(inRange, l => l.direction === 'out') * -1) * 100) / 100;
  const byMethod = {};
  METHODS.forEach(m => {
    const ls = inRange.filter(l => l.method === m);
    const inn = sumSigned(ls, l => l.direction === 'in');
    const out = Math.round((sumSigned(ls, l => l.direction === 'out') * -1) * 100) / 100;
    byMethod[m] = { in: inn, out, net: Math.round((inn - out) * 100) / 100 };
  });
  const cashIn = sumSigned(all.filter(l => l.date >= from && l.date <= to && l.method === 'cash'), l => l.direction === 'in');
  const cashOut = Math.round((sumSigned(all.filter(l => l.date >= from && l.date <= to && l.method === 'cash'), l => l.direction === 'out') * -1) * 100) / 100;
  return {
    from, to, method, today,
    opening,
    closing: run,
    totals: {
      in: totalsIn,
      out: totalsOut,
      net: Math.round((totalsIn - totalsOut) * 100) / 100,
      cashIn, cashOut,
      cashNet: Math.round((cashIn - cashOut) * 100) / 100,
      byMethod,
    },
    days,
    lines: inRange,
  };
}

function payFingerprint(p) {
  if (!p) return '';
  return [p.date || '', p.cid || '', Number(p.amount), p.no == null ? '' : p.no, p.note || '', p.method || ''].join('\u0001');
}

function expFingerprint(e) {
  if (!e) return '';
  return [e.date || '', e.label || '', e.category || '', Number(e.amount), e.vehicleId || '', e.method || '', e.note || ''].join('\u0001');
}

function indexById(arr) {
  const m = new Map();
  (arr || []).forEach(x => { if (x && x.id) m.set(x.id, x); });
  return m;
}

function closedDatesOf(stored) {
  const s = new Set();
  ((stored && stored.caisseCloses) || []).forEach(c => { if (c && validDate(c.date)) s.add(c.date); });
  return s;
}

function guardClosedDays(stored, incoming, opts) {
  const role = opts && opts.role;
  if (isManager(role)) return { ok: true };
  if (!stored) return { ok: true };
  if (opts && opts.reason === 'import') return { ok: true };
  const closed = closedDatesOf(stored);
  if (!closed.size) return { ok: true };

  const touches = (oldRow, newRow, kind) => {
    const oldDate = oldRow && validDate(oldRow.date) ? oldRow.date : '';
    const newDate = newRow && validDate(newRow.date) ? newRow.date : '';
    if (oldDate && closed.has(oldDate)) return oldDate;
    if (newDate && closed.has(newDate)) return newDate;
    return null;
  };

  const check = (oldArr, newArr, fp, kind) => {
    const om = indexById(oldArr);
    const nm = indexById(newArr);
    for (const [id, row] of nm) {
      const prev = om.get(id);
      if (!prev) {
        const d = touches(null, row, kind);
        if (d) return d;
      } else if (fp(prev) !== fp(row)) {
        const d = touches(prev, row, kind);
        if (d) return d;
      }
    }
    for (const [id, row] of om) {
      if (!nm.has(id)) {
        const d = touches(row, null, kind);
        if (d) return d;
      }
    }
    return null;
  };

  const date = check(stored.payments, incoming && incoming.payments, payFingerprint, 'payment')
    || check(stored.expenses, incoming && incoming.expenses, expFingerprint, 'expense');
  if (date) return { ok: false, error: 'caisse_day_closed', status: 403, date };
  return { ok: true };
}

function appendLog(data, userName, text) {
  if (!Array.isArray(data.log)) data.log = [];
  data.log.unshift({
    id: 'l-caisse-' + uid(),
    date: new Date().toISOString(),
    user: userName || '',
    text: String(text || ''),
  });
}

function ensureArrays(data) {
  if (!Array.isArray(data.caisseEntries)) data.caisseEntries = [];
  if (!Array.isArray(data.caisseCloses)) data.caisseCloses = [];
  if (!Array.isArray(data.log)) data.log = [];
}

function addEntry(data, body, actor) {
  ensureArrays(data);
  const date = String((body && body.date) || '');
  if (!validDate(date)) return { error: 'invalid_date', status: 400 };
  if (isClosed(data, date) && !isManager(actor && actor.role)) {
    return { error: 'caisse_day_closed', status: 403, date };
  }
  const direction = (body && body.direction) === 'out' ? 'out' : ((body && body.direction) === 'in' ? 'in' : '');
  if (!direction) return { error: 'invalid_direction', status: 400 };
  const amount = parseAmount(body && body.amount);
  if (amount == null) return { error: 'invalid_amount', status: 400 };
  const label = sanitizeText(body && body.label, LABEL_MAX);
  if (!label) return { error: 'invalid_label', status: 400 };
  const methodRaw = String((body && body.method) || '');
  if (!METHOD_SET.has(methodRaw)) return { error: 'invalid_method', status: 400 };
  const note = sanitizeText(body && body.note, NOTE_MAX);
  const entry = {
    id: 'ce-' + uid(),
    date, direction, amount, label, method: methodRaw, note,
    createdAt: new Date().toISOString(),
    createdBy: (actor && actor.id) || '',
    createdByName: (actor && actor.name) || '',
  };
  data.caisseEntries.push(entry);
  appendLog(data, entry.createdByName, (direction === 'in' ? 'قيد صندوق (دخول): ' : 'قيد صندوق (خروج): ') + amount + ' — ' + label + ' — ' + date);
  return { ok: true, entry };
}

function deleteEntry(data, id, actor) {
  ensureArrays(data);
  const i = data.caisseEntries.findIndex(e => e && e.id === id);
  if (i < 0) return { error: 'not_found', status: 404 };
  const entry = data.caisseEntries[i];
  if (isClosed(data, entry.date) && !isManager(actor && actor.role)) {
    return { error: 'caisse_day_closed', status: 403, date: entry.date };
  }
  data.caisseEntries.splice(i, 1);
  appendLog(data, (actor && actor.name) || '', 'حذف قيد صندوق: ' + (entry.label || '') + ' — ' + entry.date);
  return { ok: true, entry };
}

function closeDay(data, body, actor) {
  ensureArrays(data);
  const date = String((body && body.date) || '');
  if (!validDate(date)) return { error: 'invalid_date', status: 400 };
  const countedCash = parseCounted(body && body.countedCash);
  if (countedCash == null) return { error: 'invalid_amount', status: 400 };
  const note = sanitizeText(body && body.note, NOTE_MAX);
  const lines = buildLines(data);
  const expectedCash = cashExpected(lines, date);
  const difference = Math.round((countedCash - expectedCash) * 100) / 100;
  const existing = data.caisseCloses.findIndex(c => c && c.date === date);
  if (existing >= 0 && !isManager(actor && actor.role)) {
    return { error: 'caisse_day_closed', status: 403, date };
  }
  const rec = {
    id: existing >= 0 ? data.caisseCloses[existing].id : ('cc-' + uid()),
    date, countedCash, expectedCash, difference, note,
    by: (actor && actor.id) || '',
    byName: (actor && actor.name) || '',
    at: new Date().toISOString(),
  };
  if (existing >= 0) data.caisseCloses[existing] = rec;
  else data.caisseCloses.push(rec);
  appendLog(data, rec.byName, 'إقفال الصندوق ليوم ' + date + ' — المتوقع ' + expectedCash + ' — المحصي ' + countedCash + ' — الفرق ' + difference);
  return { ok: true, close: rec };
}

function parsePeriod(query, today) {
  const t = today || todayCasablanca();
  let from = validDate(query && query.from) ? query.from : t;
  let to = validDate(query && query.to) ? query.to : from;
  if (from > to) { const x = from; from = to; to = x; }
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return { error: 'range_too_long', status: 400 };
  const method = (query && query.method && query.method !== 'all' && METHOD_SET.has(String(query.method))) ? String(query.method) : 'all';
  const lang = (query && query.lang === 'fr') ? 'fr' : ((query && query.lang === 'en') ? 'en' : 'ar');
  return { from, to, method, lang };
}

const I18N = {
  ar: {
    payments: 'المدفوعات', expenses: 'المصاريف', manual: 'القيود اليدوية', summary: 'الملخص',
    date: 'التاريخ', receipt: 'رقم الوصل', student: 'المترشح', method: 'طريقة الأداء',
    amount: 'المبلغ', category: 'الصنف', vehicle: 'السيارة', label: 'الوصف',
    direction: 'النوع', note: 'ملاحظة', in: 'دخول', out: 'خروج',
    opening: 'رصيد الافتتاح', closing: 'رصيد الإقفال', totalIn: 'مجموع الدخول',
    totalOut: 'مجموع الخروج', net: 'الصافي', cashExpected: 'النقد المتوقع',
    cashIn: 'دخول نقدي', cashOut: 'خروج نقدي', cashNet: 'صافي النقد',
    methods: { cash: 'نقدا', transfer: 'تحويل بنكي', cheque: 'شيك', card: 'بطاقة' },
  },
  fr: {
    payments: 'Encaissements', expenses: 'Dépenses', manual: 'Écritures manuelles', summary: 'Récapitulatif',
    date: 'Date', receipt: 'N° reçu', student: 'Élève', method: 'Mode de paiement',
    amount: 'Montant', category: 'Catégorie', vehicle: 'Véhicule', label: 'Libellé',
    direction: 'Type', note: 'Note', in: 'Entrée', out: 'Sortie',
    opening: 'Solde d’ouverture', closing: 'Solde de clôture', totalIn: 'Total entrées',
    totalOut: 'Total sorties', net: 'Solde net', cashExpected: 'Espèces attendues',
    cashIn: 'Entrées espèces', cashOut: 'Sorties espèces', cashNet: 'Net espèces',
    methods: { cash: 'Espèces', transfer: 'Virement', cheque: 'Chèque', card: 'Carte' },
  },
  en: {
    payments: 'Payments', expenses: 'Expenses', manual: 'Manual entries', summary: 'Summary',
    date: 'Date', receipt: 'Receipt no.', student: 'Student', method: 'Payment method',
    amount: 'Amount', category: 'Category', vehicle: 'Vehicle', label: 'Label',
    direction: 'Type', note: 'Note', in: 'In', out: 'Out',
    opening: 'Opening balance', closing: 'Closing balance', totalIn: 'Total in',
    totalOut: 'Total out', net: 'Net', cashExpected: 'Expected cash',
    cashIn: 'Cash in', cashOut: 'Cash out', cashNet: 'Net cash',
    methods: { cash: 'Cash', transfer: 'Transfer', cheque: 'Cheque', card: 'Card' },
  },
};

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvTable(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
  return lines.join('\r\n');
}

function exportRows(data, period) {
  const j = journal(data, period);
  const L = I18N[period.lang] || I18N.ar;
  const methodLbl = m => (L.methods && L.methods[m]) || m;
  const payments = (data.payments || []).filter(p => p && validDate(p.date) && p.date >= j.from && p.date <= j.to)
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.no) - Number(b.no))
    .map(p => {
      const nm = normalizeMethod(p.method);
      return [p.date, p.no == null ? '' : p.no, candidateName(data, p.cid), methodLbl(nm.method), Number(p.amount) || 0];
    });
  const expenses = (data.expenses || []).filter(e => e && validDate(e.date) && e.date >= j.from && e.date <= j.to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => [e.date, e.category || '', vehicleLabel(data, e.vehicleId), e.label || '', Number(e.amount) || 0]);
  const manual = (data.caisseEntries || []).filter(e => e && validDate(e.date) && e.date >= j.from && e.date <= j.to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))
    .map(e => [e.date, e.direction === 'out' ? L.out : L.in, e.label || '', methodLbl(normalizeMethod(e.method).method), Number(e.amount) || 0, e.note || '']);
  const summary = [
    [L.opening, j.opening],
    [L.totalIn, j.totals.in],
    [L.totalOut, j.totals.out],
    [L.net, j.totals.net],
    [L.closing, j.closing],
    [L.cashIn, j.totals.cashIn],
    [L.cashOut, j.totals.cashOut],
    [L.cashNet, j.totals.cashNet],
    [L.cashExpected, j.totals.cashNet],
  ];
  METHODS.forEach(m => {
    const b = j.totals.byMethod[m];
    summary.push([methodLbl(m) + ' — ' + L.totalIn, b.in]);
    summary.push([methodLbl(m) + ' — ' + L.totalOut, b.out]);
    summary.push([methodLbl(m) + ' — ' + L.net, b.net]);
  });
  return { j, L, payments, expenses, manual, summary };
}

function buildCsv(data, period) {
  const { j, L, payments, expenses, manual, summary } = exportRows(data, period);
  const parts = [];
  parts.push(L.payments);
  parts.push(csvTable([L.date, L.receipt, L.student, L.method, L.amount], payments));
  parts.push('');
  parts.push(L.expenses);
  parts.push(csvTable([L.date, L.category, L.vehicle, L.label, L.amount], expenses));
  parts.push('');
  parts.push(L.manual);
  parts.push(csvTable([L.date, L.direction, L.label, L.method, L.amount, L.note], manual));
  parts.push('');
  parts.push(L.summary);
  parts.push(csvTable([L.label, L.amount], summary));
  const body = parts.join('\r\n');
  const filename = 'otoqol-caisse-' + j.from + '-' + j.to + '.csv';
  return { filename, mime: 'text/csv; charset=utf-8', buffer: Buffer.from('\uFEFF' + body, 'utf8') };
}

/* Minimal ZIP (store) + XLSX writer — no extra dependency. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      name, data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const center = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(center.length), u32(offset), u16(0),
  ]);
  return Buffer.concat(locals.concat([center, end]));
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(i) {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetXml(rows) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
  rows.forEach((row, ri) => {
    const r = ri + 1;
    let cells = '';
    row.forEach((val, ci) => {
      const ref = colName(ci) + r;
      if (typeof val === 'number' && Number.isFinite(val)) {
        cells += '<c r="' + ref + '"><v>' + val + '</v></c>';
      } else {
        cells += '<c r="' + ref + '" t="inlineStr"><is><t>' + xmlEsc(val) + '</t></is></c>';
      }
    });
    out.push('<row r="' + r + '">' + cells + '</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

function buildXlsx(data, period) {
  const { j, L, payments, expenses, manual, summary } = exportRows(data, period);
  const payRows = [[L.date, L.receipt, L.student, L.method, L.amount]].concat(payments);
  const expRows = [[L.date, L.category, L.vehicle, L.label, L.amount]].concat(expenses);
  const manRows = [[L.date, L.direction, L.label, L.method, L.amount, L.note]].concat(manual);
  const sumRows = [[L.label, L.amount]].concat(summary);
  const names = [L.payments, L.expenses, L.manual, L.summary].map((n, i) => {
    let s = String(n || ('Sheet' + (i + 1))).replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31);
    return s || ('Sheet' + (i + 1));
  });
  const sheets = [payRows, expRows, manRows, sumRows].map(sheetXml);
  const types = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '<Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '</Types>',
  ].join('');
  const rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + [1, 2, 3, 4].map(i => '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>').join('')
    + '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + names.map((n, i) => '<sheet name="' + xmlEsc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
    + '</sheets></workbook>';
  const buffer = zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheets[0] },
    { name: 'xl/worksheets/sheet2.xml', data: sheets[1] },
    { name: 'xl/worksheets/sheet3.xml', data: sheets[2] },
    { name: 'xl/worksheets/sheet4.xml', data: sheets[3] },
  ]);
  const filename = 'otoqol-caisse-' + j.from + '-' + j.to + '.xlsx';
  return { filename, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
}

function exportFile(data, period) {
  if (period && period.format === 'xlsx') return buildXlsx(data, period);
  return buildCsv(data, period);
}

function actorOf(req) {
  const u = req.appUser || {};
  return { id: u.id || '', name: u.name || '', role: req.role };
}

function install(app, deps) {
  const { store, auth, cachedData, bump } = deps;

  const office = (req, res, next) => {
    if (isOffice(req.role)) return next();
    return res.status(403).json({ error: 'forbidden' });
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

  const sendErr = (res, r) => res.status(r.status || 400).json({ error: r.error, date: r.date });

  app.get('/api/caisse', auth, office, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const data = cachedData(req.school.id);
    if (!data) return res.status(400).json({ error: 'no_data' });
    const period = parsePeriod(req.query || {}, todayCasablanca());
    if (period.error) return sendErr(res, period);
    const j = journal(data, period);
    res.json(Object.assign({ ok: true }, j));
  });

  app.post('/api/caisse/entries', auth, office, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = mutate(req.school.id, 'caisse-entry', data => addEntry(data, req.body || {}, actorOf(req)));
    if (r.error) return sendErr(res, r);
    res.status(201).json({ ok: true, entry: r.entry, version: r.version });
  });

  app.delete('/api/caisse/entries/:id', auth, office, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = mutate(req.school.id, 'caisse-entry-delete', data => deleteEntry(data, String(req.params.id || ''), actorOf(req)));
    if (r.error) return sendErr(res, r);
    res.json({ ok: true, version: r.version });
  });

  app.post('/api/caisse/close', auth, office, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = mutate(req.school.id, 'caisse-close', data => closeDay(data, req.body || {}, actorOf(req)));
    if (r.error) return sendErr(res, r);
    res.json({ ok: true, close: r.close, version: r.version });
  });

  app.get('/api/caisse/export', auth, office, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const data = cachedData(req.school.id);
    if (!data) return res.status(400).json({ error: 'no_data' });
    const period = parsePeriod(req.query || {}, todayCasablanca());
    if (period.error) return sendErr(res, period);
    period.format = String((req.query && req.query.format) || 'csv') === 'xlsx' ? 'xlsx' : 'csv';
    const file = exportFile(data, period);
    res.set('Content-Type', file.mime);
    res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');
    res.send(file.buffer);
  });
}

module.exports = {
  install, journal, buildLines, normalizeMethod, METHODS,
  guardClosedDays, addEntry, deleteEntry, closeDay,
  exportFile, buildCsv, buildXlsx, parsePeriod,
  todayCasablanca, casablancaParts, addDays, cashExpected,
  isOffice, isManager, validDate,
};
