/* Otoqol NARSA document engine — works in Node and in the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OtoqolNarsa = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = [
    { id: 'contrat', ar: 'عقد التكوين (3 نظائر أصلية)', fr: 'Contrat de formation (3 originaux)', en: 'Training contract (3 originals)' },
    { id: 'demande', ar: 'طلب اجتياز امتحان رخصة السياقة', fr: "Demande de passage d'examen du permis de conduire", en: 'Application to sit the driving-licence exam' },
    { id: 'attestation', ar: 'شهادة نهاية التكوين', fr: 'Attestation de fin de formation', en: 'End-of-training certificate' }
  ];

  const FIELD_LABELS = {
    school_name: { ar: 'اسم المؤسسة / العلامة التجارية', fr: "Nom / enseigne de l'établissement", en: 'School trade name' },
    school_address: { ar: 'عنوان المؤسسة', fr: "Adresse de l'établissement", en: 'School address' },
    school_phone: { ar: 'هاتف المؤسسة', fr: "Téléphone de l'établissement", en: 'School phone' },
    school_email: { ar: 'البريد الإلكتروني للمؤسسة', fr: "E-mail de l'établissement", en: 'School email' },
    school_city: { ar: 'المدينة', fr: 'Ville', en: 'City' },
    school_license_no: { ar: 'رقم رخصة المؤسسة', fr: "N° d'agrément de l'établissement", en: 'School licence number' },
    school_national_reg: { ar: 'رقم القيد في السجل الوطني الخاص بمؤسسات تعليم السياقة', fr: 'N° au registre national des établissements', en: 'National driving-school registry number' },
    school_patente: { ar: 'رقم القيد في سجل الضريبة المهنية', fr: "N° d'inscription à la taxe professionnelle", en: 'Professional tax (patente) number' },
    school_rc: { ar: 'رقم القيد في السجل التجاري', fr: 'N° au registre de commerce', en: 'Trade register (RC) number' },
    school_rc_city: { ar: 'مدينة السجل التجاري', fr: 'Ville du registre de commerce', en: 'Trade-register city' },
    legal_first: { ar: 'الاسم الشخصي للممثل القانوني', fr: 'Prénom du représentant légal', en: 'Legal representative first name' },
    legal_last: { ar: 'الاسم العائلي للممثل القانوني', fr: 'Nom du représentant légal', en: 'Legal representative last name' },
    legal_address: { ar: 'عنوان الممثل القانوني', fr: 'Adresse du représentant légal', en: 'Legal representative address' },
    legal_phone: { ar: 'هاتف الممثل القانوني', fr: 'Téléphone du représentant légal', en: 'Legal representative phone' },
    cand_first: { ar: 'الاسم الشخصي للمرشح', fr: 'Prénom du candidat', en: "Candidate's first name" },
    cand_last: { ar: 'الاسم العائلي للمرشح', fr: 'Nom du candidat', en: "Candidate's last name" },
    cand_cin: { ar: 'رقم البطاقة الوطنية للمرشح', fr: "N° de la carte d'identité nationale", en: 'Candidate national ID (CIN)' },
    cand_nationality: { ar: 'الجنسية', fr: 'Nationalité', en: 'Nationality' },
    cand_birth_date: { ar: 'تاريخ الازدياد', fr: 'Date de naissance', en: 'Date of birth' },
    cand_birth_place: { ar: 'مكان الازدياد', fr: 'Lieu de naissance', en: 'Place of birth' },
    cand_address: { ar: 'عنوان المرشح', fr: 'Adresse du candidat', en: "Candidate's address" },
    cand_license: { ar: 'صنف رخصة السياقة المطلوب', fr: 'Catégorie de permis demandée', en: 'Licence category applied for' },
    cand_narsa_ref: { ar: 'رقم تسجيل المرشح الممنوح من طرف الإدارة (Référence web)', fr: "N° d'enregistrement attribué par l'administration (Référence web)", en: 'Administration registration number (Référence web)' },
    code_hours: { ar: 'عدد ساعات التكوين النظري', fr: "Nombre d'heures de formation théorique", en: 'Theory training hours' },
    drive_hours: { ar: 'عدد ساعات التكوين التطبيقي', fr: "Nombre d'heures de formation pratique", en: 'Practical training hours' },
    contract_date: { ar: 'تاريخ العقد', fr: 'Date du contrat', en: 'Contract date' },
    theory_instructor: { ar: 'اسم مدرب التكوين النظري', fr: 'Nom du moniteur théorique', en: 'Theory instructor name' },
    theory_license: { ar: 'رقم رخصة مدرب التكوين النظري', fr: 'N° de licence du moniteur théorique', en: 'Theory instructor licence number' },
    practical_instructor: { ar: 'اسم مدرب التكوين التطبيقي', fr: 'Nom du moniteur pratique', en: 'Practical instructor name' },
    practical_license: { ar: 'رقم رخصة مدرب التكوين التطبيقي', fr: 'N° de licence du moniteur pratique', en: 'Practical instructor licence number' },
    vehicle_plate: { ar: 'رقم تسجيل مركبة التكوين', fr: "N° d'immatriculation du véhicule de formation", en: 'Training vehicle plate' },
    permit_no: { ar: 'رقم رخصة السياقة (للتمديد)', fr: 'N° du permis de conduire (extension)', en: 'Existing driving-licence number (extension)' }
  };

  const REQUIRED = {
    contrat: [
      'school_name', 'school_address', 'school_phone', 'school_email', 'school_city',
      'school_national_reg', 'school_patente', 'school_rc', 'school_rc_city',
      'cand_first', 'cand_last', 'cand_cin', 'cand_birth_date', 'cand_birth_place',
      'cand_address', 'cand_license', 'code_hours', 'drive_hours', 'contract_date'
    ],
    demande: [
      'cand_first', 'cand_last', 'cand_cin', 'cand_nationality', 'cand_birth_date',
      'cand_birth_place', 'cand_address', 'cand_license'
    ],
    attestation: [
      'school_name', 'school_license_no', 'school_national_reg', 'school_patente', 'school_rc',
      'school_rc_city', 'school_address', 'school_phone', 'school_email',
      'legal_first', 'legal_last', 'legal_address', 'legal_phone',
      'cand_first', 'cand_last', 'cand_cin', 'cand_narsa_ref',
      'cand_license', 'code_hours', 'drive_hours', 'contract_date',
      'theory_instructor', 'theory_license', 'practical_instructor', 'practical_license',
      'vehicle_plate', 'school_city'
    ]
  };

  const CAT_ROWS = ['AM', 'A1', 'A', 'B', 'C', 'D', 'E(B)', 'E(C)', 'E(D)'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function filled(s) { return trim(s) !== ''; }

  function splitName(full, first, last) {
    const f = trim(first), l = trim(last);
    if (f || l) return { first: f, last: l };
    const n = trim(full).replace(/\s+/g, ' ');
    if (!n) return { first: '', last: '' };
    const parts = n.split(' ');
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  function fmtDate(iso) {
    const s = trim(iso);
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s;
  }

  function normCat(lic) {
    const x = trim(lic).toUpperCase().replace(/\s+/g, '');
    if (x === 'EB' || x === 'E(B)' || x === 'E-B') return 'E(B)';
    if (x === 'EC' || x === 'E(C)' || x === 'E-C') return 'E(C)';
    if (x === 'ED' || x === 'E(D)' || x === 'E-D') return 'E(D)';
    return x;
  }

  function mostUsedId(sessions, pred, key) {
    const counts = Object.create(null);
    (sessions || []).forEach(s => {
      if (!pred(s)) return;
      const id = s[key];
      if (!id) return;
      counts[id] = (counts[id] || 0) + (Number(s.duration) || 1);
    });
    let best = '', n = 0;
    Object.keys(counts).forEach(k => { if (counts[k] > n) { n = counts[k]; best = k; } });
    return best;
  }

  function hoursDone(db, cid, type) {
    let t = 0;
    (db.sessions || []).forEach(s => {
      if (type && s.type !== type) return;
      const a = (s.att || []).find(x => x.cid === cid);
      if (a && (a.status === 'present' || a.status === 'late')) t += Number(s.duration) || 0;
    });
    return t;
  }

  function pickHours(planned, done) {
    const p = Number(planned);
    const d = Number(done);
    if (p > 0) return String(p);
    if (d > 0) return String(d);
    return '';
  }

  function context(db, candidateId, opts) {
    opts = opts || {};
    const o = opts.overrides || {};
    const settings = Object.assign({}, (db && db.settings) || {}, o.settings || {});
    const candidates = (db && db.candidates) || [];
    const c0 = candidates.find(x => x && x.id === candidateId) || null;
    if (!c0) return { error: 'candidate_not_found' };
    const c = Object.assign({}, c0, o.candidate || {});
    const names = splitName(c.name, c.firstName, c.lastName);
    const legal = splitName(settings.legalName, settings.legalFirst, settings.legalLast);
    const sess = ((db && db.sessions) || []).filter(s => (s.att || []).some(a => a.cid === c.id));
    const monitors = (db && db.monitors) || [];
    const vehicles = (db && db.vehicles) || [];
    const thId = mostUsedId(sess, s => s.type === 'code', 'monitorId');
    const prId = mostUsedId(sess, s => s.type === 'conduite', 'monitorId');
    const vhId = mostUsedId(sess, s => s.type === 'conduite', 'vehicleId');
    const th = monitors.find(m => m.id === thId) || null;
    const pr = monitors.find(m => m.id === prId) || null;
    const vh = vehicles.find(v => v.id === vhId) || null;
    const city = trim(o.city) || trim(settings.city) || trim(settings.rcCity);
    const contractDate = trim(o.contractDate) || trim(c.contractDate) || trim(c.createdAt) || '';
    const issueDate = trim(o.issueDate) || new Date().toISOString().slice(0, 10);
    const ctx = {
      schoolName: trim(settings.school),
      schoolAddress: trim(settings.address),
      schoolPhone: trim(settings.phone),
      schoolFax: trim(settings.fax),
      schoolEmail: trim(settings.email),
      schoolCity: city,
      schoolLicenseNo: trim(settings.licenseNo),
      schoolNationalReg: trim(settings.nationalRegNo),
      schoolPatente: trim(settings.patente),
      schoolRc: trim(settings.rc),
      schoolRcCity: trim(settings.rcCity) || city,
      legalFirst: legal.first,
      legalLast: legal.last,
      legalAddress: trim(settings.legalAddress),
      legalPhone: trim(settings.legalPhone),
      candName: trim(c.name),
      candFirst: names.first,
      candLast: names.last,
      candCin: trim(c.cin),
      candNationality: trim(c.nationality) || 'مغربية',
      candBirthDate: trim(c.birthDate),
      candBirthPlace: trim(c.birthPlace),
      candAddress: trim(c.address),
      candPhone: trim(c.phone),
      candLicense: normCat(c.license),
      candNarsaRef: trim(c.narsaRef),
      codeHours: pickHours(o.codeHours || c.codeHours, hoursDone(db, c.id, 'code')),
      driveHours: pickHours(o.driveHours || c.driveHours, hoursDone(db, c.id, 'conduite')),
      contractNo: trim(o.contractNo) || trim(c.contractNo) || ('CT-' + (contractDate || issueDate).slice(0, 4) + '-' + String(c.id || '').replace(/^c/i, '')),
      contractDate: contractDate,
      issueDate: issueDate,
      issueCity: city,
      examKind: (o.examKind || c.examKind || 'first') === 'extension' ? 'extension' : 'first',
      permitNo: trim(o.permitNo) || trim(c.permitNo),
      permitIssuePlace: trim(o.permitIssuePlace) || trim(c.permitIssuePlace),
      permitIssueDate: trim(o.permitIssueDate) || trim(c.permitIssueDate),
      theoryInstructor: trim(o.theoryInstructor) || (th && th.name) || '',
      theoryLicense: trim(o.theoryLicense) || (th && th.licenseNo) || '',
      practicalInstructor: trim(o.practicalInstructor) || (pr && pr.name) || '',
      practicalLicense: trim(o.practicalLicense) || (pr && pr.licenseNo) || '',
      vehiclePlate: trim(o.vehiclePlate) || (vh && vh.plate) || '',
      candidateId: c.id
    };
    return { ctx, candidate: c, settings };
  }

  function valueOf(ctx, key) {
    const map = {
      school_name: ctx.schoolName,
      school_address: ctx.schoolAddress,
      school_phone: ctx.schoolPhone,
      school_email: ctx.schoolEmail,
      school_city: ctx.schoolCity,
      school_license_no: ctx.schoolLicenseNo,
      school_national_reg: ctx.schoolNationalReg,
      school_patente: ctx.schoolPatente,
      school_rc: ctx.schoolRc,
      school_rc_city: ctx.schoolRcCity,
      legal_first: ctx.legalFirst,
      legal_last: ctx.legalLast,
      legal_address: ctx.legalAddress,
      legal_phone: ctx.legalPhone,
      cand_first: ctx.candFirst,
      cand_last: ctx.candLast,
      cand_cin: ctx.candCin,
      cand_nationality: ctx.candNationality,
      cand_birth_date: ctx.candBirthDate,
      cand_birth_place: ctx.candBirthPlace,
      cand_address: ctx.candAddress,
      cand_license: ctx.candLicense,
      cand_narsa_ref: ctx.candNarsaRef,
      code_hours: ctx.codeHours,
      drive_hours: ctx.driveHours,
      contract_date: ctx.contractDate,
      theory_instructor: ctx.theoryInstructor,
      theory_license: ctx.theoryLicense,
      practical_instructor: ctx.practicalInstructor,
      practical_license: ctx.practicalLicense,
      vehicle_plate: ctx.vehiclePlate,
      permit_no: ctx.permitNo
    };
    return map[key];
  }

  function validate(type, ctx, opts) {
    opts = opts || {};
    const keys = (REQUIRED[type] || []).slice();
    if (type === 'demande' && (opts.examKind || ctx.examKind) === 'extension') keys.push('permit_no');
    const missing = [];
    keys.forEach(k => {
      if (!filled(valueOf(ctx, k))) missing.push(Object.assign({ key: k }, FIELD_LABELS[k] || { ar: k, fr: k, en: k }));
    });
    return missing;
  }

  function dots(val, attr) {
    const v = trim(val);
    const inner = v ? '<span class="fill" data-narsa-field="' + esc(attr || '') + '">' + esc(v) + '</span>' : '<span class="blank" data-narsa-field="' + esc(attr || '') + '"></span>';
    return inner;
  }
  function line(val, attr) {
    return '<span class="line">' + dots(val, attr) + '</span>';
  }

  const CSS = [
    '@page{size:A4;margin:10mm}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#e5e7eb;color:#111;font-family:"Noto Naskh Arabic","Amiri",Tahoma,"Times New Roman",serif;font-size:12px;line-height:1.55}',
    '.toolbar{position:sticky;top:0;z-index:20;background:#0f766e;color:#fff;padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-family:Tahoma,Arial,sans-serif}',
    '.toolbar button{font-family:inherit;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;background:#fff;color:#0f766e}',
    '.toolbar .hint{font-size:12px;opacity:.95;margin-inline-start:8px}',
    '.sheet{width:190mm;min-height:277mm;margin:8mm auto;background:#fff;padding:10mm 12mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}',
    '.sheet + .sheet{page-break-before:always}',
    'h1,h2,h3{margin:0;font-weight:700}',
    '.bo{display:none}',
    '.title{text-align:center;font-size:18px;margin:0 0 4px}',
    '.subtitle{text-align:center;font-size:15px;margin:0 0 14px}',
    '.ar{direction:rtl;text-align:right}',
    '.fr{direction:ltr;text-align:left;font-family:Arial,"Times New Roman",serif}',
    '.kv{margin:3px 0}',
    '.line{display:inline-block;min-width:2.2cm;border-bottom:1px dotted #111;padding:0 4px;min-height:1.1em}',
    '.line .fill{font-weight:700}',
    '.line .blank{display:inline-block;min-width:2cm}',
    '.block{margin:8px 0}',
    '.art{margin:8px 0 6px;text-align:justify}',
    '.art b.hd{display:block;text-align:right;margin-bottom:2px}',
    '.sigs{display:flex;justify-content:space-between;gap:16px;margin-top:22px}',
    '.sigs .sg{width:46%;text-align:center}',
    '.copy-tag{text-align:center;font-size:12px;margin:0 0 8px;font-weight:700}',
    '.foot{font-size:9px;margin-top:16px;color:#222}',
    'table.grid{width:100%;border-collapse:collapse}',
    'table.grid th,table.grid td{border:1px solid #111;padding:3px 5px;font-size:11px}',
    '.box{border:1.6px solid #111;padding:6px 8px;margin:6px 0}',
    '.chk{display:inline-block;width:11px;height:11px;border:1.4px solid #111;margin:0 4px;vertical-align:middle;position:relative}',
    '.chk.on::after{content:"✓";position:absolute;top:-5px;right:-1px;font-size:13px;font-weight:700;line-height:1}',
    '@media print{body{background:#fff}.toolbar{display:none!important}.sheet{margin:0 auto;box-shadow:none;page-break-after:always}}'
  ].join('');

  function toolbar(title, lang) {
    const t = {
      ar: { print: 'طباعة', pdf: 'تحميل PDF', hint: 'في نافذة الطباعة، اختر «حفظ كملف PDF».' },
      fr: { print: 'Imprimer', pdf: 'Télécharger le PDF', hint: 'Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».' },
      en: { print: 'Print', pdf: 'Download PDF', hint: 'In the print dialog, choose “Save as PDF”.' }
    }[lang] || { print: 'طباعة', pdf: 'تحميل PDF', hint: 'في نافذة الطباعة، اختر «حفظ كملف PDF».' };
    return '<div class="toolbar no-print"><button type="button" onclick="window.print()">' + esc(t.print) + '</button>' +
      '<button type="button" onclick="window.print()">' + esc(t.pdf) + '</button>' +
      '<span class="hint">' + esc(t.hint) + '</span></div>';
  }

  function contratPages(ctx, copyIndex, copies) {
    const cat = ctx.candLicense;
    const tag = copies > 1 ? '<div class="copy-tag" data-narsa-copy="' + copyIndex + '">النظير الأصلي رقم ' + copyIndex + ' من ' + copies + '</div>' : '';
    const p1 = [
      '<section class="sheet ar" data-narsa-type="contrat" data-narsa-copy="' + copyIndex + '" data-narsa-page="1">',
      tag,
      '<h1 class="title">نموذج عقد التكوين بين المرشح ومؤسسة تعليم السياقة</h1>',
      '<h2 class="subtitle">رخصة السياقة من صنف «' + dots(cat, 'license') + '»</h2>',
      '<div class="kv" style="display:flex;justify-content:space-between;gap:12px"><span>رقم : ' + line(ctx.contractNo, 'contractNo') + '</span><span>بتاريخ : ' + line(fmtDate(ctx.contractDate), 'contractDate') + '</span></div>',
      '<h3 class="block">طرفي العقد</h3>',
      '<p>هذا العقد مبرم بين :</p>',
      '<p>مؤسسة تعليم السياقة<sup>1</sup> : ' + line(ctx.schoolName, 'schoolName') + '</p>',
      '<p>رقم القيد في السجل الوطني الخاص بمؤسسات تعليم السياقة : ' + line(ctx.schoolNationalReg, 'schoolNationalReg') + '</p>',
      '<p>العنوان : ' + line(ctx.schoolAddress, 'schoolAddress') + '</p>',
      '<p>رقم القيد في سجل الضريبة المهنية : ' + line(ctx.schoolPatente, 'schoolPatente') + '</p>',
      '<p>رقم القيد في السجل التجاري : ' + line(ctx.schoolRc, 'schoolRc') + ' &nbsp; المدينة : ' + line(ctx.schoolRcCity, 'schoolRcCity') + '</p>',
      '<p>الهاتف : ' + line(ctx.schoolPhone, 'schoolPhone') + ' &nbsp; الفاكس : ' + line(ctx.schoolFax, 'schoolFax') + '</p>',
      '<p>البريد الإلكتروني : ' + line(ctx.schoolEmail, 'schoolEmail') + '</p>',
      '<p>المسماة «المؤسسة»</p>',
      '<p>والسيد(ة) : ' + line((ctx.candFirst + ' ' + ctx.candLast).trim(), 'candName') + '</p>',
      '<p>رقم ب.و.ت.إ : ' + line(ctx.candCin, 'cin') + ' &nbsp; المزداد(ة) ب : ' + line(ctx.candBirthPlace, 'birthPlace') + ' &nbsp; بتاريخ : ' + line(fmtDate(ctx.candBirthDate), 'birthDate') + '</p>',
      '<p>القاطن(ة) ب : ' + line(ctx.candAddress, 'address') + '</p>',
      '<p>رقم تسجيل المرشح الممنوح من طرف الإدارة : ' + line(ctx.candNarsaRef, 'narsaRef') + '</p>',
      '<p>المسمى(ة) «المرشح(ة)»</p>',
      '<p style="text-align:center;font-weight:700;margin:12px 0 8px">اتفق الطرفان على ما يلي</p>',
      '<div class="art"><b class="hd">المادة الأولى : موضوع العقد</b>',
      'يهدف هذا العقد إلى تكوين المرشح وتمكينه من اكتساب المعارف والمهارات الضرورية اللازمة التي تمكنه من سياقة مركبة تتطلب قيادتها رخصة السياقة من صنف «' + dots(cat, 'license') + '»، طبقا للبرامج المحددة من طرف الإدارة. كما يحدد حقوق وواجبات كلا الطرفين مع مراعاة القوانين والأنظمة الجاري بها العمل في هذا الشأن.</div>',
      '<div class="art"><b class="hd">المادة 2 : مدة العقد</b>',
      'يمتد هذا العقد لمدة ستة أشهر ابتداء من تاريخ توقيعه. ويمكن تمديده، في حالة الاتفاق بين الطرفين، لمدة لا تتعدى ثلاثة أشهر.</div>',
      '<div class="art"><b class="hd">المادة 3 : التزامات المؤسسة</b>',
      'تلتزم المؤسسة بتكوين المرشح طبقا للبرنامج الوطني لتعليم السياقة. تلقن الدروس النظرية والتطبيقية، تحت إشراف مدير المؤسسة، من طرف مدرب أو مدربي تعليم السياقة مرخص لهم، تشغلهم المؤسسة لهذا الغرض وبواسطة مركبات لتعليم السياقة في ملكيتها. تلتزم المؤسسة بتوفير المركبة التي يتم بواسطتها إجراء الاختبار التطبيقي. لا يمكن الشروع في التكوين النظري إلا بعد حصول المرشح على رقم التسجيل الممنوح له من طرف الإدارة.</div>',
      '<p class="foot">¹ الاسم التجاري للمؤسسة، ممثلة من طرف صاحب رخصة المؤسسة أو الممثل القانوني إذا كان المستفيد شخصا معنويا.</p>',
      '</section>'
    ].join('');
    const p2 = [
      '<section class="sheet ar" data-narsa-type="contrat" data-narsa-copy="' + copyIndex + '" data-narsa-page="2">',
      tag,
      '<div class="art">تلتزم المؤسسة بإخبار المرشح فورا بحصوله على هذا الرقم، كما تلتزم بتسليم المرشح شهادة نهاية التكوين فور إنهائه له. تحتفظ المؤسسة بحق إرجاء دروس التكوين إلى تاريخ لاحق في حالة قوة قاهرة وفي كل الحالات التي تكون فيها السلامة غير متوفرة. بعد استفادة المرشح من عدد ساعات التكوين النظري والتطبيقي المتفق عليها، تلتزم المؤسسة بتقديمه لاجتياز الامتحانات لنيل رخصة السياقة في حدود المقاعد الممنوحة من طرف الإدارة.</div>',
      '<div class="art"><b class="hd">المادة 4 : التزامات المرشح</b>',
      'إذا توقف المرشح عن التكوين، سواء بصفة مؤقتة أو نهائية، وكيفما كانت الأسباب، يلتزم بإخبار المؤسسة كتابيا. في حالة التوقف لأكثر من ثلاثة (3) أشهر متتالية، يحق للمؤسسة مطالبة المرشح بأداء مبالغ الخدمات المتبقية، وغير المؤداة. إذا انقطع المرشح عن التكوين لمدة تفوق ستة (6) أشهر، يعتبر متخليا عن التكوين ولا يحق له أن يسترجع ما دفعه من أجله. إذا تخلى المرشح عن التكوين لسبب يعود له، يؤدي التعريفة كاملة. في حالة عدم النجاح في الامتحان، يلتزم المرشح بأداء مصاريف إعادة تكوينه وفقا لنفس التعريفة.</div>',
      '<div class="art"><b class="hd">المادة 5 : مدة التكوين</b>',
      'اتفق الطرفان على تحديد عدد ساعات التكوين في ' + line(ctx.codeHours, 'codeHours') + ' ساعة بالنسبة للتكوين النظري و ' + line(ctx.driveHours, 'driveHours') + ' ساعة بالنسبة للتكوين التطبيقي. لا يقل هذا العدد عن العدد الأدنى المحدد بالمادة 32 من دفتر التحملات الخاص بفتح واستغلال مؤسسات تعليم السياقة.</div>',
      '<div class="art"><b class="hd">المادة 6 : تعريفة التكوين</b>',
      'تحتسب التعريفة الإجمالية للتكوين على أساس تعريفة ساعة التكوين النظري والتطبيقي المحددة في المادة 1 من القرار الذي يحدد تعريفة ساعة التكوين النظري والتطبيقي.</div>',
      '<div class="art"><b class="hd">المادة 7 : كيفيات الأداء</b>',
      'تسلم للمرشح فاتورة تحدد المبالغ المدفوعة للمؤسسة. تكون هذه الفاتورة مؤرخة وموقعة من طرف صاحب المؤسسة وتحمل اسم وطابع المؤسسة، وفقا للتشريعات الجاري بها العمل. في حالة الاتفاق بين الطرفين، يمكن أداء مبلغ التكوين على أقساط.</div>',
      '<p style="margin-top:18px">عقد محرر في ثلاثة نظائر أصلية،</p>',
      '<p>في ' + line(ctx.issueCity || ctx.schoolCity, 'city') + ' بتاريخ ' + line(fmtDate(ctx.contractDate), 'contractDate') + '.</p>',
      '<div class="sigs"><div class="sg">توقيع صاحب المؤسسة أو ممثله القانوني<br><br><br>........................</div>',
      '<div class="sg">توقيع المرشح أو ولي أمره مصادق عليه<br><br><br>........................</div></div>',
      '</section>'
    ].join('');
    return p1 + p2;
  }

  function chk(on) { return '<span class="chk' + (on ? ' on' : '') + '" aria-checked="' + (on ? 'true' : 'false') + '"></span>'; }

  function demandePage(ctx) {
    const first = ctx.examKind !== 'extension';
    const cat = ctx.candLicense;
    const rows = CAT_ROWS.map(r => {
      const on = r === cat;
      const place = on && ctx.examKind === 'extension' ? ctx.permitIssuePlace : '';
      const date = on && ctx.examKind === 'extension' ? fmtDate(ctx.permitIssueDate) : '';
      return '<tr><td style="width:18%">' + chk(on) + ' ' + esc(r) + '</td><td style="width:41%">' + (place ? esc(place) : '&nbsp;') + '</td><td>' + (date ? esc(date) : '&nbsp;') + '</td></tr>';
    }).join('');
    return [
      '<section class="sheet" data-narsa-type="demande" dir="rtl">',
      '<div style="display:flex;justify-content:space-between;align-items:stretch;gap:8px;margin-bottom:8px">',
      '<div class="box fr" style="flex:1;font-size:10px;line-height:1.35"><b>ROYAUME DU MAROC</b><br>Ministère de l’Équipement, du Transport, de la Logistique et de l’Eau<br><b>Agence Nationale de la Sécurité Routière</b></div>',
      '<div class="box ar" style="flex:1;text-align:center"><div style="font-size:13px;font-weight:700">الملحق 1</div><div style="font-size:11px;margin-top:4px"><b>المملكة المغربية</b><br>وزارة التجهيز والنقل واللوجستيك والماء<br>الوكالة الوطنية للسلامة الطرقية</div></div>',
      '<div class="box" style="width:38mm;min-height:48mm;text-align:center;font-size:9px;padding:4px">صورتان فوتوغرافيتان للتعريف متشابهتان بالألوان وأماميتان وذات خلفية زرقاء من حجم 3,5 سنتمتر × 4,5 سنتمتر بوجه وأذنين مكشوفة<br><span class="fr" style="display:block;margin-top:4px;font-size:8px">Deux photographies d’identité récentes de face, en couleur, de format 3,5 cm × 4,5 cm, sur fond bleu, le visage et les oreilles découverts</span></div>',
      '</div>',
      '<div class="box" style="text-align:center">',
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">',
      '<div class="fr" style="font-weight:700;font-size:12px">Demande de passage d’examen du permis de conduire :</div>',
      '<div class="ar" style="font-weight:700;font-size:13px">طلب اجتياز امتحان رخصة السياقة :</div>',
      '</div>',
      '<div style="display:flex;justify-content:space-between;margin-top:6px;gap:8px">',
      '<div class="fr">' + chk(first) + ' pour la première fois &nbsp; ' + chk(!first) + ' pour l’extension du permis de conduire</div>',
      '<div class="ar">' + chk(first) + ' لأول مرة &nbsp; ' + chk(!first) + ' لتمديد رخصة السياقة</div>',
      '</div></div>',
      '<div class="box">',
      '<div style="display:flex;justify-content:space-between"><b class="fr">Informations sur le demandeur</b><b class="ar">معلومات حول صاحب الطلب</b></div>',
      '<div class="kv" style="display:flex;justify-content:space-between;margin-top:6px"><span class="fr">Prénom : ' + line(ctx.candFirst, 'firstName') + '</span><span class="ar">الاسم الشخصي : ' + line(ctx.candFirst, 'firstName') + '</span></div>',
      '<div class="kv" style="display:flex;justify-content:space-between"><span class="fr">Nom : ' + line(ctx.candLast, 'lastName') + '</span><span class="ar">الاسم العائلي : ' + line(ctx.candLast, 'lastName') + '</span></div>',
      '<div class="kv" style="display:flex;justify-content:space-between"><span class="fr">Carte d’identité N° : ' + line(ctx.candCin, 'cin') + '</span><span class="ar">بطاقة التعريف رقم : ' + line(ctx.candCin, 'cin') + '</span></div>',
      '<div class="kv" style="display:flex;justify-content:space-between"><span class="fr">Nationalité : ' + line(ctx.candNationality, 'nationality') + '</span><span class="ar">الجنسية : ' + line(ctx.candNationality, 'nationality') + '</span></div>',
      '<div class="kv" style="display:flex;justify-content:space-between"><span class="fr">Né(e) le ' + line(fmtDate(ctx.candBirthDate), 'birthDate') + ' à ' + line(ctx.candBirthPlace, 'birthPlace') + '</span><span class="ar">المزداد(ة) بتاريخ : ' + line(fmtDate(ctx.candBirthDate), 'birthDate') + ' في : ' + line(ctx.candBirthPlace, 'birthPlace') + '</span></div>',
      '<div class="kv" style="display:flex;justify-content:space-between"><span class="fr">Résidant à : ' + line(ctx.candAddress, 'address') + '</span><span class="ar">القاطن ب : ' + line(ctx.candAddress, 'address') + '</span></div>',
      '<div class="kv" style="display:flex;justify-content:space-between;align-items:center"><span class="fr">Catégorie demandée : <b data-narsa-field="license">' + esc(cat) + '</b></span><span class="ar">الصنف المطلوب : <b data-narsa-field="license">' + esc(cat) + '</b></span></div>',
      '</div>',
      '<div class="box">',
      '<div style="display:flex;justify-content:space-between"><b class="fr">Informations sur le permis de conduire</b><b class="ar">معلومات حول رخصة السياقة</b></div>',
      '<div class="kv" style="display:flex;justify-content:space-between;margin:6px 0"><span class="fr">Permis de conduire N° : ' + line(ctx.examKind === 'extension' ? ctx.permitNo : '', 'permitNo') + '</span><span class="ar">رخصة السياقة عدد : ' + line(ctx.examKind === 'extension' ? ctx.permitNo : '', 'permitNo') + '</span></div>',
      '<table class="grid"><thead><tr><th>الصنف / Catégorie</th><th>مكان التسليم / Lieu de délivrance</th><th>تاريخ التسليم / Date de délivrance</th></tr></thead><tbody>',
      rows,
      '</tbody></table></div>',
      '<div class="box" style="display:flex;justify-content:space-between;align-items:center">',
      '<div class="fr">Signature du demandeur (*)</div><div style="width:45mm;height:16mm;border:1px solid #111"></div>',
      '<div class="ar">توقيع صاحب الطلب (*)</div>',
      '</div>',
      '<div class="box" style="min-height:28mm"><div style="display:flex;justify-content:space-between"><span class="fr">Cadre réservé au paiement des droits de timbres et taxes</span><span class="ar">إطار خاص بأداء واجبات التنبر والرسوم</span></div></div>',
      '<p class="foot fr" style="text-align:left">(*) Par le biais de ce formulaire, l’Agence Nationale de la Sécurité Routière collecte vos données personnelles pour la gestion du permis de conduire. Ce traitement a fait l’objet d’une demande d’autorisation auprès de la CNDP. Vous pouvez vous adresser à l’Agence pour exercer vos droits d’accès, de rectification et d’opposition conformément aux dispositions de la loi n° 09-08.</p>',
      '</section>'
    ].join('');
  }

  function attestationPage(ctx) {
    const cat = ctx.candLicense;
    const full = (ctx.candFirst + ' ' + ctx.candLast).trim();
    return [
      '<section class="sheet ar" data-narsa-type="attestation">',
      '<h1 class="title">الملحق</h1>',
      '<h1 class="title" style="margin-bottom:14px">نموذج شهادة نهاية التكوين في تعليم السياقة</h1>',
      '<p>العلامة التجارية للمؤسسة أو الاسم التجاري للمؤسسة : ' + line(ctx.schoolName, 'schoolName') + '</p>',
      '<p>رقم الرخصة : ' + line(ctx.schoolLicenseNo, 'schoolLicenseNo') + '</p>',
      '<p>رقم القيد في السجل الوطني الخاص بمؤسسات تعليم السياقة : ' + line(ctx.schoolNationalReg, 'schoolNationalReg') + '</p>',
      '<p>رقم القيد في سجل الضريبة المهنية : ' + line(ctx.schoolPatente, 'schoolPatente') + ' &nbsp; رقم القيد في السجل التجاري : ' + line(ctx.schoolRc, 'schoolRc') + ' &nbsp; المدينة : ' + line(ctx.schoolRcCity, 'schoolRcCity') + '</p>',
      '<p>العنوان : ' + line(ctx.schoolAddress, 'schoolAddress') + '</p>',
      '<p>الهاتف : ' + line(ctx.schoolPhone, 'schoolPhone') + ' &nbsp; الفاكس : ' + line(ctx.schoolFax, 'schoolFax') + '</p>',
      '<p>البريد الإلكتروني : ' + line(ctx.schoolEmail, 'schoolEmail') + '</p>',
      '<h3 style="margin:12px 0 6px">الممثل القانوني للمؤسسة</h3>',
      '<div class="box">',
      '<p>الاسم الشخصي : ' + line(ctx.legalFirst, 'legalFirst') + '</p>',
      '<p>الاسم العائلي : ' + line(ctx.legalLast, 'legalLast') + '</p>',
      '<p>العنوان : ' + line(ctx.legalAddress, 'legalAddress') + '</p>',
      '<p>رقم الهاتف : ' + line(ctx.legalPhone, 'legalPhone') + '</p>',
      '</div>',
      '<p>أشهد أن السيد(ة) : ' + line(full, 'candName') + '</p>',
      '<p>الحامل(ة) للبطاقة الوطنية للتعريف رقم : ' + line(ctx.candCin, 'cin') + '</p>',
      '<p>الرقم الممنوح من طرف الإدارة (Référence web) : ' + line(ctx.candNarsaRef, 'narsaRef') + '</p>',
      '<p>بناء على عقد التكوين الموقع بين الطرفين بتاريخ : ' + line(fmtDate(ctx.contractDate), 'contractDate') + '</p>',
      '<p>تلقى (تلقت) بهذه المؤسسة دروسا نظرية وتطبيقية في تعليم سياقة المركبات من صنف «' + dots(cat, 'license') + '»، بما مجموعه : ' + line(ctx.codeHours, 'codeHours') + ' ساعة بالنسبة للتكوين النظري و ' + line(ctx.driveHours, 'driveHours') + ' ساعة بالنسبة للتكوين التطبيقي، طبقا للبرنامج الوطني لتعليم السياقة.</p>',
      '<p>وقد أشرف على التكوين النظري المدرب الوارد اسمه بعده :</p>',
      '<p>اسم المدرب : ' + line(ctx.theoryInstructor, 'theoryInstructor') + ' &nbsp; رقم رخصته : ' + line(ctx.theoryLicense, 'theoryLicense') + '</p>',
      '<p>وأشرف على التكوين التطبيقي المدرب الوارد اسمه بعده :</p>',
      '<p>اسم المدرب : ' + line(ctx.practicalInstructor, 'practicalInstructor') + ' &nbsp; رقم رخصته : ' + line(ctx.practicalLicense, 'practicalLicense') + '</p>',
      '<p>كما تلقى (تلقت) تكوينه(ها) بواسطة المركبة من صنف «' + dots(cat, 'license') + '» المسجلة تحت رقم : ' + line(ctx.vehiclePlate, 'vehiclePlate') + ' في اسم المؤسسة.</p>',
      '<div class="sigs" style="margin-top:28px"><div class="sg">طابع المؤسسة واسم وتوقيع الممثل القانوني للمؤسسة<br><br><br>........................</div>',
      '<div class="sg">اسم وتوقيع المرشح<br><br><br>........................</div></div>',
      '<p style="margin-top:24px">حرر بـ ' + line(ctx.issueCity || ctx.schoolCity, 'city') + ' بتاريخ ' + line(fmtDate(ctx.issueDate), 'issueDate') + '.</p>',
      '</section>'
    ].join('');
  }

  function wrap(title, lang, body) {
    return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">' +
      '<style>' + CSS + '</style></head><body>' + toolbar(title, lang) + body + '</body></html>';
  }

  function render(type, ctx, opts) {
    opts = opts || {};
    const lang = opts.lang === 'fr' || opts.lang === 'en' ? opts.lang : 'ar';
    let copies = Number(opts.copies);
    if (type === 'contrat') {
      if (!Number.isFinite(copies) || copies < 1) copies = 3;
      if (copies > 3) copies = 3;
    } else copies = 1;
    let body = '', title = '';
    if (type === 'contrat') {
      title = 'عقد تكوين — ' + (ctx.candFirst + ' ' + ctx.candLast).trim();
      for (let i = 1; i <= copies; i++) body += contratPages(ctx, i, copies);
    } else if (type === 'demande') {
      title = 'طلب اجتياز امتحان — ' + (ctx.candFirst + ' ' + ctx.candLast).trim();
      body = demandePage(ctx);
    } else if (type === 'attestation') {
      title = 'شهادة نهاية التكوين — ' + (ctx.candFirst + ' ' + ctx.candLast).trim();
      body = attestationPage(ctx);
    } else {
      return { error: 'bad_type' };
    }
    const filename = (type + '-' + trim(ctx.candLast || ctx.candName || 'candidat') + '-' + (ctx.issueDate || '')).replace(/\s+/g, '_');
    return { html: wrap(title, lang, body), title: title, filename: filename, copies: copies };
  }

  function build(db, candidateId, opts) {
    opts = opts || {};
    const type = String(opts.type || '').toLowerCase();
    if (!TYPES.some(t => t.id === type)) return { ok: false, error: 'bad_type', missing: [] };
    const got = context(db, candidateId, opts);
    if (got.error) return { ok: false, error: got.error, missing: [] };
    const missing = validate(type, got.ctx, opts);
    if (missing.length) return { ok: false, error: 'missing_fields', type: type, missing: missing, ctx: got.ctx };
    const out = render(type, got.ctx, opts);
    if (out.error) return { ok: false, error: out.error, missing: [] };
    return { ok: true, type: type, missing: [], html: out.html, title: out.title, filename: out.filename, copies: out.copies, ctx: got.ctx };
  }

  return {
    TYPES: TYPES,
    FIELD_LABELS: FIELD_LABELS,
    REQUIRED: REQUIRED,
    esc: esc,
    splitName: splitName,
    fmtDate: fmtDate,
    normCat: normCat,
    context: context,
    validate: validate,
    render: render,
    build: build
  };
});
