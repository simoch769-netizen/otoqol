'use strict';
/**
 * Official school documents: enrolment register (registre des candidats inscrits)
 * and per-candidate training booklet (livret de suivi et d'évaluation).
 *
 * Legal basis (public sources only):
 * Arrêté du ministre de l'équipement et du transport n° 271-13 du 23 janvier 2013,
 * cahier des charges annexé, Bulletin officiel n° 6128 du 21-2-2013
 * (Arabic edition: BO n° 6126 du 14 février 2013).
 * Art. 22 §1: required fields of the registre des candidats inscrits.
 * Art. 23: the candidate dossier includes the livret visé à l'article 31.
 * Art. 29: training starts after the contract and the administration inscription number.
 * Art. 31: a livret de suivi et d'évaluation (livret d'apprentissage) « conformément
 *          au modèle fixé par le ministère » — that ministerial model itself was
 *          not found published; this booklet compiles identity, contract, hours,
 *          session journal, exam results and signature lines, without claiming
 *          to be a numbered official form.
 * Art. 32: minimum hours (20 theory all categories; 20 practical A1/A/B/E(B),
 *          30 for C/D/E(C)/E(D)); sessions at least 30 minutes.
 * Prices are never printed on these documents.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const I18N = {
  ar: {
    registre: 'سجل تسجيل المترشحين',
    livret: 'كناش التتبع والتقييم (كناش التكوين)',
    school: 'المؤسسة',
    address: 'العنوان',
    phone: 'الهاتف',
    city: 'المدينة',
    schoolLicense: 'رقم رخصة المؤسسة',
    nationalReg: 'رقم القيد في السجل الوطني',
    period: 'الفترة',
    allPeriod: 'كل الفترات',
    order: 'ر.ت',
    name: 'الاسم والنسب',
    cin: 'رقم البطاقة الوطنية',
    birthDate: 'تاريخ الازدياد',
    birthPlace: 'مكان الازدياد',
    addressCand: 'العنوان',
    narsaRef: 'رقم التسجيل الممنوح من الإدارة',
    contract: 'مراجع العقد (الرقم والتاريخ)',
    hoursFixed: 'عدد ساعات التكوين المحددة',
    start: 'تاريخ بداية التكوين',
    end: 'تاريخ نهاية التكوين',
    category: 'صنف الرخصة موضوع التكوين',
    permitNo: 'رقم رخصة السياقة (في حالة التمديد)',
    exams: 'الامتحانات',
    enrolment: 'تاريخ التسجيل',
    nationality: 'الجنسية',
    print: 'طباعة',
    sessions: 'سجل الحصص',
    date: 'التاريخ',
    time: 'الساعة',
    type: 'النوع',
    duration: 'المدة (س)',
    monitor: 'المونيتور',
    vehicle: 'لوحة السيارة',
    status: 'الحالة',
    remarks: 'الملاحظات',
    hoursDone: 'الساعات المنجزة',
    hoursCode: 'الكود (نظري)',
    hoursDrive: 'السياقة (تطبيقي)',
    planned: 'المحددة',
    done: 'المنجزة',
    remaining: 'المتبقي',
    sigCand: 'توقيع المرشح',
    sigMon: 'توقيع المونيتور',
    sigDir: 'توقيع وخاتم مدير المؤسسة',
    empty: 'لا يوجد مترشحون في هذه الفترة.',
    noSessions: 'لا توجد حصص مسجلة.',
    noExams: 'لا توجد محاولات امتحان مسجلة.',
    legalRegistre: 'يستند هذا السجل إلى المادة 22 من دفتر التحملات المرفق بقرار وزير التجهيز والنقل رقم 271-13 بتاريخ 23 يناير 2013 (الجريدة الرسمية عدد 6128 بتاريخ 21 فبراير 2013).',
    legalLivret: 'يستند هذا الكناش إلى المادتين 23 و31 من دفتر التحملات المرفق بقرار وزير التجهيز والنقل رقم 271-13 بتاريخ 23 يناير 2013. نموذج الوزارة المشار إليه في المادة 31 غير منشور في المصادر المتاحة؛ تجمع هذه الوثيقة بيانات الهوية والعقد والساعات وسجل الحصص ونتائج الامتحانات للتتبع والطباعة، دون الادعاء بأنها النموذج الرسمي المرقم.',
    footGen: 'وثيقة مستخرجة من نظام Otoqol.',
    code: 'كود',
    drive: 'سياقة',
    present: 'حاضر',
    late: 'متأخر',
    absent: 'غائب',
    plannedSt: 'مبرمجة',
    pending: 'في الانتظار',
    pass: 'نجح',
    fail: 'رسب',
    waiting: 'في الانتظار',
  },
  fr: {
    registre: 'Registre des candidats inscrits',
    livret: 'Livret de suivi et d’évaluation (livret de formation)',
    school: 'Établissement',
    address: 'Adresse',
    phone: 'Téléphone',
    city: 'Ville',
    schoolLicense: 'N° d’agrément de l’établissement',
    nationalReg: 'N° au registre national',
    period: 'Période',
    allPeriod: 'Toutes les périodes',
    order: 'N°',
    name: 'Nom et prénom',
    cin: 'N° de CIN',
    birthDate: 'Date de naissance',
    birthPlace: 'Lieu de naissance',
    addressCand: 'Adresse',
    narsaRef: 'N° d’inscription attribué par l’administration',
    contract: 'Références du contrat (n° et date)',
    hoursFixed: 'Nombre d’heures de formation fixé',
    start: 'Date de début de la formation',
    end: 'Date de fin de la formation',
    category: 'Catégorie de permis objet de la formation',
    permitNo: 'N° du permis (en cas d’extension)',
    exams: 'Examens',
    enrolment: 'Date d’inscription',
    nationality: 'Nationalité',
    print: 'Imprimer',
    sessions: 'Journal des séances',
    date: 'Date',
    time: 'Heure',
    type: 'Type',
    duration: 'Durée (h)',
    monitor: 'Moniteur',
    vehicle: 'Immatriculation',
    status: 'Statut',
    remarks: 'Observations',
    hoursDone: 'Heures réalisées',
    hoursCode: 'Code (théorie)',
    hoursDrive: 'Conduite (pratique)',
    planned: 'Fixées',
    done: 'Réalisées',
    remaining: 'Restantes',
    sigCand: 'Signature du candidat',
    sigMon: 'Signature du moniteur',
    sigDir: 'Signature et cachet du directeur',
    empty: 'Aucun candidat pour cette période.',
    noSessions: 'Aucune séance enregistrée.',
    noExams: 'Aucune tentative d’examen enregistrée.',
    legalRegistre: 'Ce registre s’appuie sur l’article 22 du cahier des charges annexé à l’arrêté n° 271-13 du 23 janvier 2013 du ministre de l’équipement et du transport (B.O. n° 6128 du 21 février 2013).',
    legalLivret: 'Ce livret s’appuie sur les articles 23 et 31 du même arrêté. Le modèle ministériel visé à l’article 31 n’a pas été trouvé dans les sources publiées ; le document rassemble l’identité, le contrat, les heures, le journal des séances et les résultats d’examens, sans prétendre être le formulaire officiel numéroté.',
    footGen: 'Document généré par Otoqol.',
    code: 'Code',
    drive: 'Conduite',
    present: 'Présent',
    late: 'En retard',
    absent: 'Absent',
    plannedSt: 'Planifiée',
    pending: 'En attente',
    pass: 'Réussi',
    fail: 'Ajourné',
    waiting: 'En attente',
  },
  en: {
    registre: 'Enrolment register',
    livret: 'Training follow-up booklet',
    school: 'School',
    address: 'Address',
    phone: 'Phone',
    city: 'City',
    schoolLicense: 'School licence number',
    nationalReg: 'National register number',
    period: 'Period',
    allPeriod: 'All periods',
    order: 'No.',
    name: 'Full name',
    cin: 'National ID (CIN)',
    birthDate: 'Date of birth',
    birthPlace: 'Place of birth',
    addressCand: 'Address',
    narsaRef: 'Administration registration number',
    contract: 'Contract references (number and date)',
    hoursFixed: 'Training hours set in the contract',
    start: 'Training start date',
    end: 'Training end date',
    category: 'Licence category',
    permitNo: 'Current licence number (extension)',
    exams: 'Exams',
    enrolment: 'Enrolment date',
    nationality: 'Nationality',
    print: 'Print',
    sessions: 'Session log',
    date: 'Date',
    time: 'Time',
    type: 'Type',
    duration: 'Duration (h)',
    monitor: 'Instructor',
    vehicle: 'Plate',
    status: 'Status',
    remarks: 'Remarks',
    hoursDone: 'Hours completed',
    hoursCode: 'Theory (code)',
    hoursDrive: 'Practical (driving)',
    planned: 'Set',
    done: 'Completed',
    remaining: 'Remaining',
    sigCand: 'Candidate signature',
    sigMon: 'Instructor signature',
    sigDir: 'Director signature and stamp',
    empty: 'No candidates in this period.',
    noSessions: 'No sessions recorded.',
    noExams: 'No exam attempts recorded.',
    legalRegistre: 'This register follows article 22 of the specifications annexed to order no. 271-13 of 23 January 2013 of the Minister of Equipment and Transport (Official Gazette no. 6128 of 21 February 2013).',
    legalLivret: 'This booklet follows articles 23 and 31 of the same order. The ministerial model referred to in article 31 was not found in published sources; the document compiles identity, contract, hours, session log and exam results, and does not claim to be the numbered official form.',
    footGen: 'Document generated by Otoqol.',
    code: 'Code',
    drive: 'Driving',
    present: 'Present',
    late: 'Late',
    absent: 'Absent',
    plannedSt: 'Planned',
    pending: 'Pending',
    pass: 'Passed',
    fail: 'Failed',
    waiting: 'Pending',
  },
};

function parseLang(v) {
  const s = String(v || '').trim().toLowerCase();
  return (s === 'fr' || s === 'en') ? s : 'ar';
}

function labels(lang) {
  return I18N[parseLang(lang)] || I18N.ar;
}

function parsePeriod(q) {
  const src = q || {};
  let from = String(src.from || '').trim();
  let to = String(src.to || '').trim();
  if (from && !DATE_RE.test(from)) return { error: 'bad_request' };
  if (to && !DATE_RE.test(to)) return { error: 'bad_request' };
  if (from && to && from > to) { const t = from; from = to; to = t; }
  return { from: from || null, to: to || null };
}

function dayOf(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = s.slice(0, 10);
  return DATE_RE.test(d) ? d : '';
}

function fullName(c) {
  if (!c) return '';
  const n = String(c.name || '').trim();
  if (n) return n;
  return [c.firstName, c.lastName].map(x => String(x || '').trim()).filter(Boolean).join(' ');
}

function enrolmentDate(c) {
  if (!c) return '';
  return dayOf(c.contractDate) || dayOf(c.createdAt) || '';
}

function hoursDone(data, cid, type) {
  return (data.sessions || []).reduce((sum, x) => {
    const a = (x.att || []).find(y => y && y.cid === cid);
    const counted = a && (a.status === 'present' || a.status === 'late');
    return sum + ((counted && (!type || x.type === type)) ? Number(x.duration) || 0 : 0);
  }, 0);
}

function lastPassedExamDate(c, type) {
  const exams = (c && c.exams) || [];
  let best = '';
  exams.forEach(e => {
    if (!e || e.result !== 'نجح') return;
    if (type && e.type !== type) return;
    const d = dayOf(e.date);
    if (d && (!best || d > best)) best = d;
  });
  return best;
}

function lastSessionDate(data, cid) {
  let best = '';
  (data.sessions || []).forEach(s => {
    if (!(s.att || []).some(a => a && a.cid === cid)) return;
    const d = dayOf(s.date);
    if (d && (!best || d > best)) best = d;
  });
  return best;
}

function trainingEndDate(c, data) {
  if (!c) return '';
  const explicit = dayOf(c.trainingEnd);
  if (explicit) return explicit;
  if (c.stage !== 'done') return '';
  return lastPassedExamDate(c, 'conduite') || lastSessionDate(data, c.id) || lastPassedExamDate(c, null) || '';
}

function trainingStartDate(c) {
  if (!c) return '';
  return dayOf(c.contractDate) || enrolmentDate(c);
}

function hoursFixed(c) {
  const code = Number(c && c.codeHours) || 0;
  const drive = Number(c && c.driveHours) || 0;
  return { code, drive, total: code + drive };
}

function contractRef(c) {
  const no = String(c && c.contractNo || '').trim();
  const dt = dayOf(c && c.contractDate);
  if (no && dt) return no + ' — ' + dt;
  return no || dt || '';
}

function schoolInfo(data) {
  const s = (data && data.settings) || {};
  return {
    name: String(s.school || '').trim(),
    address: String(s.address || '').trim(),
    phone: String(s.phone || '').trim(),
    city: String(s.city || '').trim(),
    licenseNo: String(s.licenseNo || '').trim(),
    nationalRegNo: String(s.nationalRegNo || '').trim(),
  };
}

function monitorOf(data, id) {
  return (data.monitors || []).find(m => m && m.id === id) || null;
}

function vehicleOf(data, id) {
  return (data.vehicles || []).find(v => v && v.id === id) || null;
}

function typeLabel(L, typ) {
  if (typ === 'code') return L.code;
  if (typ === 'conduite') return L.drive;
  return typ || '';
}

function statusLabel(L, st) {
  const map = {
    present: L.present, late: L.late, absent: L.absent,
    planned: L.plannedSt, pending: L.pending,
  };
  return map[st] || st || '';
}

function examResultLabel(L, r) {
  if (r === 'نجح') return L.pass;
  if (r === 'رسب') return L.fail;
  if (r === 'في الانتظار') return L.waiting;
  return r || '';
}

function formatExams(c, lang) {
  const L = labels(lang);
  return ((c && c.exams) || []).map(e => ({
    id: e && e.id,
    type: e && e.type,
    typeLabel: typeLabel(L, e && e.type),
    date: dayOf(e && e.date),
    result: e && e.result,
    resultLabel: examResultLabel(L, e && e.result),
  })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function formatExamsText(exams) {
  return (exams || []).map(e => [e.typeLabel, e.date, e.resultLabel].filter(Boolean).join(' ')).join('؛ ');
}

function sessionRows(data, cid, lang) {
  const L = labels(lang);
  return (data.sessions || [])
    .filter(s => (s.att || []).some(a => a && a.cid === cid))
    .map(s => {
      const a = (s.att || []).find(x => x && x.cid === cid) || {};
      const mon = monitorOf(data, s.monitorId);
      const veh = vehicleOf(data, s.vehicleId);
      const remarks = [s.notes, a.reason, a.notes].map(x => String(x || '').trim()).filter(Boolean).join(' — ');
      return {
        id: s.id,
        date: dayOf(s.date),
        time: String(s.time || ''),
        type: s.type,
        typeLabel: typeLabel(L, s.type),
        duration: Number(s.duration) || 0,
        monitorId: s.monitorId || '',
        monitorName: mon ? mon.name : '',
        monitorLicenseNo: mon ? String(mon.licenseNo || '') : '',
        vehicleId: s.vehicleId || '',
        vehiclePlate: veh ? String(veh.plate || veh.name || '') : '',
        status: a.status || 'planned',
        statusLabel: statusLabel(L, a.status || 'planned'),
        remarks,
      };
    })
    .sort((a, b) => (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time));
}

function candidatePublic(c, data, lang) {
  const hf = hoursFixed(c);
  const codeDone = hoursDone(data, c.id, 'code');
  const driveDone = hoursDone(data, c.id, 'conduite');
  return {
    id: c.id,
    name: fullName(c),
    firstName: String(c.firstName || ''),
    lastName: String(c.lastName || ''),
    cin: String(c.cin || ''),
    address: String(c.address || ''),
    nationality: String(c.nationality || ''),
    birthDate: dayOf(c.birthDate),
    birthPlace: String(c.birthPlace || ''),
    license: String(c.license || ''),
    narsaRef: String(c.narsaRef || ''),
    contractNo: String(c.contractNo || ''),
    contractDate: dayOf(c.contractDate),
    contractRef: contractRef(c),
    permitNo: String(c.permitNo || ''),
    enrolmentDate: enrolmentDate(c),
    trainingStart: trainingStartDate(c),
    trainingEnd: trainingEndDate(c, data),
    stage: c.stage || '',
    hours: {
      codePlanned: hf.code,
      drivePlanned: hf.drive,
      totalPlanned: hf.total,
      codeDone,
      driveDone,
      totalDone: codeDone + driveDone,
      codeLeft: Math.max(0, hf.code - codeDone),
      driveLeft: Math.max(0, hf.drive - driveDone),
    },
  };
}

function compareEnrolment(a, b) {
  const da = a.enrolment || '';
  const db = b.enrolment || '';
  if (da && db && da !== db) return da.localeCompare(db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  const ca = String(a.createdAt || '');
  const cb = String(b.createdAt || '');
  if (ca !== cb) return ca.localeCompare(cb);
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function buildRegistre(data, period, lang) {
  const p = period && !period.error ? period : parsePeriod(period || {});
  const from = p.from || null;
  const to = p.to || null;
  const all = (data.candidates || []).filter(c => c && c.id).map(c => ({
    id: c.id,
    enrolment: enrolmentDate(c),
    createdAt: c.createdAt || '',
    cand: c,
  })).sort(compareEnrolment).map((row, i) => {
    const pub = candidatePublic(row.cand, data, lang);
    const exams = formatExams(row.cand, lang);
    return Object.assign({ order: i + 1, exams, examsText: formatExamsText(exams) }, pub);
  });
  const rows = all.filter(r => {
    if (!from && !to) return true;
    if (!r.enrolmentDate) return false;
    if (from && r.enrolmentDate < from) return false;
    if (to && r.enrolmentDate > to) return false;
    return true;
  });
  return {
    school: schoolInfo(data),
    from, to,
    total: rows.length, totalAll: all.length,
    rows,
  };
}

function buildLivret(data, cid, lang) {
  const c = (data.candidates || []).find(x => x && x.id === cid);
  if (!c) return { error: 'candidate_not_found' };
  const pub = candidatePublic(c, data, lang);
  const sessions = sessionRows(data, cid, lang);
  const exams = formatExams(c, lang);
  const assigned = c.monitorId ? monitorOf(data, c.monitorId) : null;
  return {
    school: schoolInfo(data),
    candidate: pub,
    instructor: assigned ? { id: assigned.id, name: assigned.name, licenseNo: String(assigned.licenseNo || '') } : null,
    sessions,
    exams,
  };
}

function canReadLivret(user, data, cid) {
  const role = user && user.role;
  if (role === 'manager' || role === 'secretary') return true;
  if (role === 'student') return user.cid === cid;
  if (role === 'monitor') {
    const c = (data.candidates || []).find(x => x && x.id === cid);
    if (!c) return false;
    if (c.monitorId && c.monitorId === user.id) return true;
    return (data.sessions || []).some(s => s && s.monitorId === user.id && (s.att || []).some(a => a && a.cid === cid));
  }
  return false;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cell(v) {
  const s = String(v == null || v === '' ? '' : v).trim();
  return s ? esc(s) : '—';
}

function periodText(reg, L) {
  if (!reg.from && !reg.to) return L.allPeriod;
  return (reg.from || '…') + ' — ' + (reg.to || '…');
}

function schoolHead(school, L) {
  const bits = [];
  bits.push('<div class="school">');
  bits.push('<div class="school-name">' + cell(school.name || '—') + '</div>');
  const meta = [];
  if (school.address) meta.push(L.address + ': ' + esc(school.address));
  if (school.city) meta.push(L.city + ': ' + esc(school.city));
  if (school.phone) meta.push(L.phone + ': ' + esc(school.phone));
  if (school.licenseNo) meta.push(L.schoolLicense + ': ' + esc(school.licenseNo));
  if (school.nationalRegNo) meta.push(L.nationalReg + ': ' + esc(school.nationalRegNo));
  if (meta.length) bits.push('<div class="school-meta">' + meta.join(' · ') + '</div>');
  bits.push('</div>');
  return bits.join('');
}

function printShell(opts) {
  const lang = parseLang(opts.lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const L = labels(lang);
  const landscape = !!opts.landscape;
  return [
    '<!DOCTYPE html><html lang="' + lang + '" dir="' + dir + '"><head>',
    '<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '<title>' + esc(opts.title) + '</title>',
    '<style>',
    'body{font-family:"Noto Naskh Arabic","Amiri","Tahoma","DejaVu Sans",sans-serif;font-size:12px;color:#111;margin:16px;background:#fff;}',
    'h1{font-size:18px;margin:0 0 6px;}',
    'h2{font-size:14px;margin:16px 0 8px;}',
    '.school-name{font-size:16px;font-weight:700;}',
    '.school-meta,.muted{color:#444;font-size:11px;margin-top:4px;}',
    'table{border-collapse:collapse;width:100%;margin:8px 0 12px;}',
    'th,td{border:1px solid #333;padding:4px 6px;vertical-align:top;text-align:start;}',
    'th{background:#f3f3f3;font-weight:700;}',
    '.kv{width:auto;max-width:100%;}',
    '.kv th{width:32%;background:#f7f7f7;font-weight:600;}',
    '.toolbar{margin:0 0 14px;}',
    '.toolbar button{font:inherit;padding:6px 14px;cursor:pointer;}',
    '.sigs{display:flex;justify-content:space-between;gap:16px;margin-top:28px;}',
    '.sig{flex:1;text-align:center;}',
    '.sig .line{margin-top:36px;border-top:1px solid #111;padding-top:6px;font-size:11px;}',
    '.legal{margin-top:22px;font-size:10px;color:#333;line-height:1.45;}',
    '.empty{padding:12px;text-align:center;}',
    '@page{size:A4 ' + (landscape ? 'landscape' : 'portrait') + ';margin:10mm;}',
    '@media print{.toolbar{display:none;}body{margin:0;}}',
    '</style></head><body>',
    '<div class="toolbar no-print"><button type="button" onclick="window.print()">' + esc(L.print) + '</button></div>',
    opts.body,
    '</body></html>',
  ].join('');
}

function renderRegistreHtml(reg, lang) {
  const L = labels(lang);
  const rows = (reg.rows || []).map(r => [
    '<tr>',
    '<td>' + cell(r.order) + '</td>',
    '<td>' + cell(r.name) + '</td>',
    '<td>' + cell(r.birthDate) + '</td>',
    '<td>' + cell(r.birthPlace) + '</td>',
    '<td>' + cell(r.cin) + '</td>',
    '<td>' + cell(r.address) + '</td>',
    '<td>' + cell(r.narsaRef) + '</td>',
    '<td>' + cell(r.contractRef) + '</td>',
    '<td>' + cell(hoursFixedText(r.hours, L)) + '</td>',
    '<td>' + cell(r.trainingStart) + '</td>',
    '<td>' + cell(r.trainingEnd) + '</td>',
    '<td>' + cell(r.license) + '</td>',
    '<td>' + cell(r.permitNo) + '</td>',
    '<td>' + cell(r.examsText) + '</td>',
    '</tr>',
  ].join('')).join('');
  const body = [
    schoolHead(reg.school, L),
    '<h1>' + esc(L.registre) + '</h1>',
    '<div class="muted">' + esc(L.period) + ': ' + esc(periodText(reg, L)) + '</div>',
    '<table><thead><tr>',
    ['order', 'name', 'birthDate', 'birthPlace', 'cin', 'addressCand', 'narsaRef', 'contract', 'hoursFixed', 'start', 'end', 'category', 'permitNo', 'exams']
      .map(k => '<th>' + esc(L[k]) + '</th>').join(''),
    '</tr></thead><tbody>',
    rows || '<tr><td class="empty" colspan="14">' + esc(L.empty) + '</td></tr>',
    '</tbody></table>',
    '<div class="legal">' + esc(L.legalRegistre) + ' ' + esc(L.footGen) + '</div>',
  ].join('');
  return printShell({ lang, title: L.registre, landscape: true, body });
}

function hoursFixedText(h, L) {
  if (!h) return '';
  const bits = [];
  if (h.totalPlanned) bits.push(String(h.totalPlanned));
  const split = [];
  if (h.codePlanned) split.push(h.codePlanned + ' ' + L.hoursCode);
  if (h.drivePlanned) split.push(h.drivePlanned + ' ' + L.hoursDrive);
  if (split.length) bits.push('(' + split.join(' + ') + ')');
  return bits.join(' ');
}

function renderLivretHtml(liv, lang) {
  const L = labels(lang);
  const c = liv.candidate;
  const h = c.hours || {};
  const kv = (label, val) => '<tr><th>' + esc(label) + '</th><td>' + cell(val) + '</td></tr>';
  const sess = (liv.sessions || []).map(s => [
    '<tr>',
    '<td>' + cell(s.date) + '</td>',
    '<td>' + cell(s.time) + '</td>',
    '<td>' + cell(s.typeLabel) + '</td>',
    '<td>' + cell(s.duration) + '</td>',
    '<td>' + cell(s.monitorName) + '</td>',
    '<td>' + cell(s.vehiclePlate) + '</td>',
    '<td>' + cell(s.statusLabel) + '</td>',
    '<td>' + cell(s.remarks) + '</td>',
    '</tr>',
  ].join('')).join('');
  const exams = (liv.exams || []).map(e => [
    '<tr>',
    '<td>' + cell(e.typeLabel) + '</td>',
    '<td>' + cell(e.date) + '</td>',
    '<td>' + cell(e.resultLabel) + '</td>',
    '</tr>',
  ].join('')).join('');
  const body = [
    schoolHead(liv.school, L),
    '<h1>' + esc(L.livret) + '</h1>',
    '<h2>' + esc(L.name) + '</h2>',
    '<table class="kv"><tbody>',
    kv(L.name, c.name),
    kv(L.cin, c.cin),
    kv(L.birthDate, c.birthDate),
    kv(L.birthPlace, c.birthPlace),
    kv(L.addressCand, c.address),
    kv(L.nationality, c.nationality),
    kv(L.category, c.license),
    kv(L.enrolment, c.enrolmentDate),
    kv(L.narsaRef, c.narsaRef),
    kv(L.contract, c.contractRef),
    kv(L.start, c.trainingStart),
    kv(L.end, c.trainingEnd),
    kv(L.permitNo, c.permitNo),
    liv.instructor ? kv(L.monitor, liv.instructor.name) : '',
    '</tbody></table>',
    '<h2>' + esc(L.hoursDone) + '</h2>',
    '<table><thead><tr><th></th><th>' + esc(L.planned) + '</th><th>' + esc(L.done) + '</th><th>' + esc(L.remaining) + '</th></tr></thead><tbody>',
    '<tr><th>' + esc(L.hoursCode) + '</th><td>' + cell(h.codePlanned) + '</td><td>' + cell(h.codeDone) + '</td><td>' + cell(h.codeLeft) + '</td></tr>',
    '<tr><th>' + esc(L.hoursDrive) + '</th><td>' + cell(h.drivePlanned) + '</td><td>' + cell(h.driveDone) + '</td><td>' + cell(h.driveLeft) + '</td></tr>',
    '</tbody></table>',
    '<h2>' + esc(L.sessions) + '</h2>',
    '<table><thead><tr>',
    [L.date, L.time, L.type, L.duration, L.monitor, L.vehicle, L.status, L.remarks].map(x => '<th>' + esc(x) + '</th>').join(''),
    '</tr></thead><tbody>',
    sess || '<tr><td class="empty" colspan="8">' + esc(L.noSessions) + '</td></tr>',
    '</tbody></table>',
    '<h2>' + esc(L.exams) + '</h2>',
    '<table><thead><tr><th>' + esc(L.type) + '</th><th>' + esc(L.date) + '</th><th>' + esc(L.status) + '</th></tr></thead><tbody>',
    exams || '<tr><td class="empty" colspan="3">' + esc(L.noExams) + '</td></tr>',
    '</tbody></table>',
    '<div class="sigs">',
    '<div class="sig"><div class="line">' + esc(L.sigCand) + '</div></div>',
    '<div class="sig"><div class="line">' + esc(L.sigMon) + '</div></div>',
    '<div class="sig"><div class="line">' + esc(L.sigDir) + '</div></div>',
    '</div>',
    '<div class="legal">' + esc(L.legalLivret) + ' ' + esc(L.footGen) + '</div>',
  ].join('');
  return printShell({ lang, title: L.livret + ' — ' + (c.name || ''), landscape: false, body });
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function registreTable(reg, lang) {
  const L = labels(lang);
  const headers = [
    L.order, L.name, L.birthDate, L.birthPlace, L.cin, L.addressCand, L.narsaRef,
    L.contract, L.hoursFixed, L.start, L.end, L.category, L.permitNo, L.exams, L.enrolment,
  ];
  const rows = (reg.rows || []).map(r => [
    r.order, r.name, r.birthDate, r.birthPlace, r.cin, r.address, r.narsaRef,
    r.contractRef, hoursFixedText(r.hours, L), r.trainingStart, r.trainingEnd,
    r.license, r.permitNo, r.examsText, r.enrolmentDate,
  ]);
  return { headers, rows };
}

function buildRegistreCsv(reg, lang) {
  const { headers, rows } = registreTable(reg, lang);
  const lines = [headers.map(csvEscape).join(',')].concat(rows.map(r => r.map(csvEscape).join(',')));
  const body = '\uFEFF' + lines.join('\r\n');
  const range = (reg.from || 'all') + '-' + (reg.to || 'all');
  return {
    filename: 'otoqol-registre-' + range + '.csv',
    mime: 'text/csv; charset=utf-8',
    buffer: Buffer.from(body, 'utf8'),
  };
}

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

function buildRegistreXlsx(reg, lang) {
  const L = labels(lang);
  const { headers, rows } = registreTable(reg, lang);
  const sheetName = String(L.registre || 'Registre').replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31) || 'Registre';
  const sheet = sheetXml([headers].concat(rows));
  const types = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '</Types>',
  ].join('');
  const rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEsc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const buffer = zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
  const range = (reg.from || 'all') + '-' + (reg.to || 'all');
  return {
    filename: 'otoqol-registre-' + range + '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}

function sendFile(res, file) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', file.mime);
  res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');
  res.send(file.buffer);
}

function office(req, res, next) {
  const role = req.role;
  if (role === 'manager' || role === 'secretary' || role === 'owner') return next();
  return res.status(403).json({ error: 'forbidden' });
}

function actorOf(req, data) {
  const role = req.role;
  const id = req.appUser && req.appUser.id;
  let cid = req.cid;
  if (role === 'student' && !cid && data && req.appUser) {
    const u = (data.portalUsers || []).find(x => x && x.id === id);
    cid = u && u.cid;
  }
  return { id, role, cid };
}

function portalStudent(req, data) {
  if (req.role !== 'student') return { error: 'forbidden', status: 403 };
  if (data && data.settings && data.settings.studentPortal === false) return { error: 'portal_disabled', status: 403 };
  const u = (data.portalUsers || []).find(x => x && x.id === (req.appUser && req.appUser.id));
  if (!u || u.active === false) return { error: 'user_changed', status: 401 };
  if (!u.cid) return { error: 'candidate_not_found', status: 403 };
  return { cid: u.cid };
}

function install(app, deps) {
  const auth = deps.auth;
  const cachedData = deps.cachedData;

  function schoolData(req) {
    return cachedData(req.school.id) || {};
  }

  function periodOr400(req, res) {
    const p = parsePeriod(req.query || {});
    if (p.error) { res.status(400).json({ error: 'bad_request' }); return null; }
    return p;
  }

  app.get('/api/docs/registre', auth, office, (req, res) => {
    const p = periodOr400(req, res); if (!p) return;
    const lang = parseLang(req.query.lang);
    const reg = buildRegistre(schoolData(req), p, lang);
    res.set('Cache-Control', 'no-store');
    res.json(reg);
  });

  app.get('/api/docs/registre/print', auth, office, (req, res) => {
    const p = periodOr400(req, res); if (!p) return;
    const lang = parseLang(req.query.lang);
    const html = renderRegistreHtml(buildRegistre(schoolData(req), p, lang), lang);
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  });

  app.get('/api/docs/registre/export', auth, office, (req, res) => {
    const p = periodOr400(req, res); if (!p) return;
    const lang = parseLang(req.query.lang);
    const fmt = String(req.query.format || 'csv').toLowerCase();
    const reg = buildRegistre(schoolData(req), p, lang);
    if (fmt === 'xlsx') return sendFile(res, buildRegistreXlsx(reg, lang));
    if (fmt === 'csv') return sendFile(res, buildRegistreCsv(reg, lang));
    return res.status(400).json({ error: 'bad_request' });
  });

  function livretFor(req, res) {
    const cid = String(req.params.cid || '');
    const data = schoolData(req);
    if (!canReadLivret(actorOf(req, data), data, cid)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const lang = parseLang(req.query.lang);
    const liv = buildLivret(data, cid, lang);
    if (liv.error) return res.status(404).json({ error: liv.error });
    return { liv, lang };
  }

  app.get('/api/docs/livret/:cid', auth, (req, res) => {
    const out = livretFor(req, res); if (!out || res.headersSent) return;
    res.set('Cache-Control', 'no-store');
    res.json(out.liv);
  });

  app.get('/api/docs/livret/:cid/print', auth, (req, res) => {
    const out = livretFor(req, res); if (!out || res.headersSent) return;
    res.set('Cache-Control', 'no-store');
    res.type('html').send(renderLivretHtml(out.liv, out.lang));
  });

  app.get('/api/portal/livret', auth, (req, res) => {
    const data = schoolData(req);
    const st = portalStudent(req, data);
    if (st.error) return res.status(st.status).json({ error: st.error });
    const lang = parseLang(req.query.lang);
    const liv = buildLivret(data, st.cid, lang);
    if (liv.error) return res.status(404).json({ error: liv.error });
    res.set('Cache-Control', 'no-store');
    res.json(liv);
  });

  app.get('/api/portal/livret/print', auth, (req, res) => {
    const data = schoolData(req);
    const st = portalStudent(req, data);
    if (st.error) return res.status(st.status).json({ error: st.error });
    const lang = parseLang(req.query.lang);
    const liv = buildLivret(data, st.cid, lang);
    if (liv.error) return res.status(404).json({ error: liv.error });
    res.set('Cache-Control', 'no-store');
    res.type('html').send(renderLivretHtml(liv, lang));
  });
}

module.exports = {
  parseLang, parsePeriod, enrolmentDate, trainingEndDate, hoursDone, hoursFixed,
  buildRegistre, buildLivret, renderRegistreHtml, renderLivretHtml,
  buildRegistreCsv, buildRegistreXlsx, canReadLivret, install, labels,
};
