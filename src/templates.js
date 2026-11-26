'use strict';
/**
 * Editable 3-language WhatsApp/email templates for Otoqol.
 * CommonJS + browser (window.OQTemplates).
 */
const MAX_LEN = 4000;
const LANGS = ['ar', 'fr', 'en'];

function formatAmount(n, lang) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n == null ? '' : n);
  const loc = lang === 'en' ? 'en-US' : 'fr-FR';
  const num = v.toLocaleString(loc);
  if (lang === 'fr') return num + ' DH';
  if (lang === 'en') return num + ' MAD';
  return num + ' د.م';
}

function typeLabel(type, lang) {
  const t = String(type || '');
  if (t === 'code') return lang === 'fr' ? 'code' : lang === 'en' ? 'theory (code)' : 'الكود';
  if (t === 'conduite' || t === 'drive') return lang === 'fr' ? 'conduite' : lang === 'en' ? 'driving' : 'السياقة';
  return t;
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

function sanitize(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (t.length > MAX_LEN) t = t.slice(0, MAX_LEN);
  return t;
}

function normLang(l) {
  const x = String(l || '').toLowerCase();
  return (x === 'fr' || x === 'en' || x === 'ar') ? x : null;
}

function studentLang(c, settings, pack) {
  return normLang(c && c.msgLang)
    || normLang(pack && pack.defaultLang)
    || normLang(settings && (settings.defaultLang || settings.msgLang || settings.lang))
    || 'ar';
}

const TYPES = {
  debt: {
    placeholders: ['school', 'student', 'amount', 'due', 'phone'],
    labelAr: 'تذكير المستحقات',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nتذكير من {school} بأن الباقي من رسوم التكوين هو {due}.\nنرجو تسوية المبلغ في أقرب وقت. شكراً لتعاملكم.\n\n{school}',
      fr: 'Bonjour {student},\n\nRappel de {school} : le reste à payer pour votre formation est de {due}.\nMerci de régulariser dès que possible.\n\n{school}',
      en: 'Hello {student},\n\nA reminder from {school}: the remaining balance for your training is {due}.\nPlease settle it at your earliest convenience. Thank you.\n\n{school}'
    }
  },
  lesson_reminder: {
    placeholders: ['school', 'student', 'date', 'time', 'instructor', 'type', 'phone'],
    labelAr: 'تذكير الحصة',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nتذكير من {school} بحصتك القادمة:\n{date} · {time}\nالمدرب: {instructor}\nالنوع: {type}\n\n{school}',
      fr: 'Bonjour {student},\n\nRappel de {school} pour votre prochain cours :\n{date} · {time}\nMoniteur : {instructor}\nType : {type}\n\n{school}',
      en: 'Hello {student},\n\nA reminder from {school} about your upcoming lesson:\n{date} · {time}\nInstructor: {instructor}\nType: {type}\n\n{school}'
    }
  },
  lesson_confirmed: {
    placeholders: ['school', 'student', 'date', 'time', 'instructor', 'type', 'phone'],
    labelAr: 'تأكيد الحصة',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nتأكدت حصتك لدى {school}:\n{date} · {time}\nالمدرب: {instructor}\nالنوع: {type}\n\n{school}',
      fr: 'Bonjour {student},\n\nVotre cours chez {school} est confirmé :\n{date} · {time}\nMoniteur : {instructor}\nType : {type}\n\n{school}',
      en: 'Hello {student},\n\nYour lesson at {school} is confirmed:\n{date} · {time}\nInstructor: {instructor}\nType: {type}\n\n{school}'
    }
  },
  lesson_changed: {
    placeholders: ['school', 'student', 'date', 'time', 'instructor', 'type', 'phone'],
    labelAr: 'تغيير الحصة',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nتم تغيير موعد حصتك لدى {school}:\n{date} · {time}\nالمدرب: {instructor}\nالنوع: {type}\n\n{school}',
      fr: 'Bonjour {student},\n\nL’horaire de votre cours chez {school} a été modifié :\n{date} · {time}\nMoniteur : {instructor}\nType : {type}\n\n{school}',
      en: 'Hello {student},\n\nYour lesson time at {school} has been changed:\n{date} · {time}\nInstructor: {instructor}\nType: {type}\n\n{school}'
    }
  },
  lesson_cancelled: {
    placeholders: ['school', 'student', 'date', 'time', 'instructor', 'type', 'phone'],
    labelAr: 'إلغاء الحصة',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nأُلغيت حصتك لدى {school}:\n{date} · {time}\n\nلتعيين موعد جديد يرجى التواصل معنا.\n\n{school}',
      fr: 'Bonjour {student},\n\nVotre cours chez {school} est annulé :\n{date} · {time}\n\nMerci de nous contacter pour fixer un nouveau rendez-vous.\n\n{school}',
      en: 'Hello {student},\n\nYour lesson at {school} has been cancelled:\n{date} · {time}\n\nPlease contact us to set a new appointment.\n\n{school}'
    }
  },
  lesson_rejected: {
    placeholders: ['school', 'student', 'date', 'time', 'instructor', 'type', 'phone'],
    labelAr: 'رفض الحجز',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nنعتذر، لم يتم قبول طلب الحجز لدى {school}:\n{date} · {time}\n\nيرجى اختيار موعد آخر من بوابة التلميذ أو التواصل معنا.\n\n{school}',
      fr: 'Bonjour {student},\n\nNous sommes désolés, votre demande de réservation chez {school} n’a pas été acceptée :\n{date} · {time}\n\nMerci de choisir un autre créneau depuis l’espace élève ou de nous contacter.\n\n{school}',
      en: 'Hello {student},\n\nSorry, your booking request at {school} was not accepted:\n{date} · {time}\n\nPlease pick another slot in the student portal or contact us.\n\n{school}'
    }
  },
  exam: {
    placeholders: ['school', 'student', 'date', 'type', 'phone'],
    labelAr: 'استدعاء الامتحان',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nاستدعاء لاجتياز امتحان {type} لدى {school}.\nالتاريخ: {date}\n\nيرجى الحضور في الوقت المحدد.\n\n{school}',
      fr: 'Bonjour {student},\n\nConvocation à l’examen de {type} chez {school}.\nDate : {date}\n\nMerci d’être présent(e) à l’heure.\n\n{school}',
      en: 'Hello {student},\n\nYou are convened for the {type} exam at {school}.\nDate: {date}\n\nPlease arrive on time.\n\n{school}'
    }
  },
  welcome: {
    placeholders: ['school', 'student', 'phone'],
    labelAr: 'ترحيب وتسجيل',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nمرحباً بك في {school}. تم تسجيل طلبك بنجاح. نحن رهن إشارتك لأي استفسار.\n\n{school}',
      fr: 'Bonjour {student},\n\nBienvenue chez {school}. Votre inscription a bien été enregistrée. Nous restons à votre disposition.\n\n{school}',
      en: 'Hello {student},\n\nWelcome to {school}. Your registration has been recorded. We are here if you need anything.\n\n{school}'
    }
  },
  portal_invite: {
    placeholders: ['school', 'student', 'link', 'username', 'phone'],
    labelAr: 'دعوة بوابة التلميذ',
    defaults: {
      ar: 'مرحبا {student}، ادخل إلى بوابة التلميذ لمدرسة {school} وعيّن كلمة السر من هذا الرابط: {link} — اسم المستخدم: {username}',
      fr: 'Bonjour {student}, accédez à l’espace élève de {school} et définissez votre mot de passe via ce lien : {link} — identifiant : {username}',
      en: 'Hello {student}, open the {school} student portal and set your password at this link: {link} — username: {username}'
    }
  },
  receipt: {
    placeholders: ['school', 'student', 'amount', 'due', 'date', 'paid', 'phone'],
    labelAr: 'وصل الأداء',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nتأكيد توصّل {school} بدفع مبلغ {amount} بتاريخ {date}.\nمجموع المؤدى: {paid}\nالباقي: {due}\n\nشكراً لتعاملكم.\n\n{school}',
      fr: 'Bonjour {student},\n\n{school} confirme la réception d’un paiement de {amount} en date du {date}.\nTotal payé : {paid}\nReste : {due}\n\nMerci.\n\n{school}',
      en: 'Hello {student},\n\n{school} confirms receipt of a {amount} payment on {date}.\nTotal paid: {paid}\nRemaining: {due}\n\nThank you.\n\n{school}'
    }
  },
  absence: {
    placeholders: ['school', 'student', 'date', 'type', 'phone'],
    labelAr: 'إشعار الغياب',
    defaults: {
      ar: 'السلام عليكم {student}،\n\nنعلمك بتسجيل غياب عن حصة {type} بتاريخ {date} لدى {school}.\nيرجى التواصل معنا لتعيين موعد جديد.\n\n{school}',
      fr: 'Bonjour {student},\n\nNous vous informons d’une absence au cours de {type} du {date} chez {school}.\nMerci de nous contacter pour fixer un nouveau rendez-vous.\n\n{school}',
      en: 'Hello {student},\n\nThis is to inform you of an absence from the {type} lesson on {date} at {school}.\nPlease contact us to set a new appointment.\n\n{school}'
    }
  }
};

const TYPE_IDS = Object.keys(TYPES);

function defaultPack() {
  const templates = {};
  TYPE_IDS.forEach(id => { templates[id] = Object.assign({}, TYPES[id].defaults); });
  return { defaultLang: 'ar', templates };
}

function packOf(raw) {
  const out = { defaultLang: 'ar', templates: {} };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    out.defaultLang = normLang(raw.defaultLang) || 'ar';
    const src = raw.templates && typeof raw.templates === 'object' && !Array.isArray(raw.templates) ? raw.templates : raw;
    TYPE_IDS.forEach(id => {
      const t = src[id];
      if (!t || typeof t !== 'object') return;
      const rec = {};
      LANGS.forEach(l => {
        if (t[l] != null && String(t[l]).trim() !== '') rec[l] = sanitize(t[l]);
      });
      if (Object.keys(rec).length) out.templates[id] = rec;
    });
  }
  return out;
}

function textOf(type, lang, pack) {
  const def = TYPES[type] && TYPES[type].defaults;
  if (!def) return '';
  const custom = pack && pack.templates && pack.templates[type];
  const l = normLang(lang) || 'ar';
  if (custom && custom[l] && String(custom[l]).trim()) return custom[l];
  if (def[l]) return def[l];
  if (custom && custom.ar && String(custom.ar).trim()) return custom.ar;
  return def.ar || '';
}

function formatVars(vars, lang) {
  const out = {};
  const money = { amount: 1, due: 1, paid: 1, remaining: 1 };
  Object.keys(vars || {}).forEach(k => {
    const v = vars[k];
    if (v == null) { out[k] = ''; return; }
    if (money[k] && (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) && !/د\.م|DH|MAD/.test(String(v))))) {
      out[k] = formatAmount(v, lang);
    } else out[k] = String(v);
  });
  if (out.due && !out.remaining) out.remaining = out.due;
  if (out.remaining && !out.due) out.due = out.remaining;
  return out;
}

function render(type, vars, lang, packOrRaw) {
  const pack = packOf(packOrRaw);
  const l = normLang(lang) || pack.defaultLang || 'ar';
  const tpl = textOf(type, l, pack);
  const vals = formatVars(vars, l);
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (_, k) => (vals[k] != null ? vals[k] : '{' + k + '}'));
}

function sampleVars(data, lang) {
  const school = (data && data.settings && data.settings.school) || 'Otoqol';
  const phone = (data && data.settings && data.settings.phone) || '+212 716-396333';
  const c = ((data && data.candidates) || []).find(x => x && x.name) || {
    name: 'يوسف العلمي', phone: '0600000001', email: 'youssef@example.com', price: 3500, msgLang: 'ar'
  };
  const mon = ((data && data.monitors) || [])[0];
  return {
    school, student: c.name, phone,
    amount: 1500, due: 2000, paid: 1500, date: '2026-12-01', time: '09:00',
    instructor: mon ? mon.name : (lang === 'fr' ? 'Karim' : lang === 'en' ? 'Karim' : 'كريم'),
    link: 'https://otoqol.com/portal/invite?token=example', username: 'youssef',
    type: typeLabel('code', lang || 'ar')
  };
}

function publicTypes(pack, data) {
  const p = packOf(pack);
  return TYPE_IDS.map(id => {
    const values = {};
    const isCustom = {};
    LANGS.forEach(l => {
      values[l] = textOf(id, l, p);
      isCustom[l] = !!(p.templates[id] && p.templates[id][l]);
    });
    return {
      id, labelAr: TYPES[id].labelAr, placeholders: TYPES[id].placeholders.slice(),
      values, isCustom
    };
  });
}

function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_data' };
  if (body.defaultLang != null && !normLang(body.defaultLang)) return { error: 'bad_lang' };
  if (body.templates != null) {
    if (typeof body.templates !== 'object' || Array.isArray(body.templates)) return { error: 'invalid_templates' };
    for (const id of Object.keys(body.templates)) {
      if (!TYPES[id]) return { error: 'unknown_type', type: id };
      const rec = body.templates[id];
      if (rec == null) continue;
      if (typeof rec !== 'object' || Array.isArray(rec)) return { error: 'invalid_templates' };
      for (const l of Object.keys(rec)) {
        if (l !== 'ar' && l !== 'fr' && l !== 'en') return { error: 'bad_lang' };
        if (rec[l] != null && typeof rec[l] !== 'string') return { error: 'invalid_text' };
        if (typeof rec[l] === 'string' && rec[l].length > MAX_LEN) return { error: 'too_long', type: id, lang: l, max: MAX_LEN };
      }
    }
  }
  return { ok: true };
}

function applyUpdate(current, body) {
  const pack = packOf(current);
  if (body.defaultLang != null) pack.defaultLang = normLang(body.defaultLang) || pack.defaultLang;
  if (body.templates) {
    Object.keys(body.templates).forEach(id => {
      if (!TYPES[id]) return;
      const rec = body.templates[id];
      if (rec == null) { delete pack.templates[id]; return; }
      if (!pack.templates[id]) pack.templates[id] = {};
      LANGS.forEach(l => {
        if (!(l in rec)) return;
        if (rec[l] == null || String(rec[l]).trim() === '') delete pack.templates[id][l];
        else pack.templates[id][l] = sanitize(rec[l]);
      });
      if (!Object.keys(pack.templates[id]).length) delete pack.templates[id];
    });
  }
  return pack;
}

function bookingTemplate(kind, status) {
  if (kind === 'cancel') return status === 'approved' ? 'lesson_cancelled' : status === 'rejected' ? 'lesson_confirmed' : null;
  return status === 'approved' ? 'lesson_confirmed' : status === 'rejected' ? 'lesson_rejected' : null;
}

function sessionTypeForMode(mode) {
  if (mode === 'cancel') return 'lesson_cancelled';
  if (mode === 'update') return 'lesson_changed';
  if (mode === 'remind') return 'lesson_reminder';
  return 'lesson_confirmed';
}

function varsForStudent(data, c, extra) {
  const school = (data && data.settings && data.settings.school) || 'Otoqol';
  return Object.assign({
    school,
    student: (c && c.name) || '',
    phone: (data && data.settings && data.settings.phone) || '',
  }, extra || {});
}

function install(app, deps) {
  const { store, auth, cachedData, bump } = deps;
  const pathMod = require('path');
  app.get('/templates.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/javascript');
    res.sendFile(pathMod.join(__dirname, 'templates.js'));
  });

  const staff = (req, res, next) => {
    if (req.role === 'manager' || req.role === 'secretary' || req.role === 'owner') return next();
    return res.status(403).json({ error: 'forbidden' });
  };
  const managerOnly = (req, res, next) => {
    if (req.role === 'manager' || req.role === 'owner') return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  const mutate = (schoolId, reason, fn) => {
    for (let i = 0; i < 8; i++) {
      const cur = store.getData(schoolId);
      if (!cur || cur.data == null) return { error: 'no_data', status: 400 };
      let data;
      try { data = JSON.parse(cur.data); } catch (e) { return { error: 'no_data', status: 400 }; }
      const extra = fn(data) || {};
      if (extra.error) return extra;
      const r = store.putData(schoolId, cur.version, JSON.stringify(data), reason);
      if (r.ok) { bump(schoolId); return { ok: true, data, version: r.version, ...extra }; }
    }
    return { error: 'version_conflict', status: 409 };
  };

  const payload = data => {
    const pack = packOf(data && data.messageTemplates);
    return {
      defaultLang: pack.defaultLang,
      maxLen: MAX_LEN,
      types: publicTypes(pack, data),
    };
  };

  app.get('/api/templates', auth, staff, (req, res) => {
    const data = cachedData(req.school.id) || { settings: {}, candidates: [] };
    res.set('Cache-Control', 'no-store');
    const p = payload(data);
    const lang = studentLang(null, data.settings, packOf(data.messageTemplates));
    p.preview = {};
    TYPE_IDS.forEach(id => {
      p.preview[id] = render(id, sampleVars(data, lang), lang, data.messageTemplates);
    });
    res.json(p);
  });

  app.put('/api/templates', auth, managerOnly, (req, res) => {
    const v = validatePayload(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error, type: v.type, lang: v.lang, max: v.max });
    const r = mutate(req.school.id, 'templates-save', data => {
      data.messageTemplates = applyUpdate(data.messageTemplates, req.body || {});
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, version: r.version, ...payload(r.data) });
  });

  app.post('/api/templates/:type/reset', auth, managerOnly, (req, res) => {
    const type = String(req.params.type || '');
    if (!TYPES[type]) return res.status(400).json({ error: 'unknown_type' });
    const r = mutate(req.school.id, 'templates-reset', data => {
      data.messageTemplates = applyUpdate(data.messageTemplates, { templates: { [type]: null } });
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, version: r.version, ...payload(r.data) });
  });

  app.get('/api/templates/render/:type', auth, staff, (req, res) => {
    const type = String(req.params.type || '');
    if (!TYPES[type]) return res.status(400).json({ error: 'unknown_type' });
    const data = cachedData(req.school.id) || { settings: {}, candidates: [] };
    const cid = String(req.query.cid || '');
    const c = cid ? (data.candidates || []).find(x => x && x.id === cid) : null;
    if (cid && !c) return res.status(404).json({ error: 'candidate_not_found' });
    const pack = packOf(data.messageTemplates);
    const lang = normLang(req.query.lang) || studentLang(c, data.settings, pack);
    let vars = c ? varsForStudent(data, c, {}) : sampleVars(data, lang);
    if (req.query && typeof req.query === 'object') {
      ['date', 'time', 'instructor', 'link', 'username', 'type', 'amount', 'due', 'paid'].forEach(k => {
        if (req.query[k] != null && req.query[k] !== '') vars[k] = req.query[k];
      });
    }
    if (vars.type && (vars.type === 'code' || vars.type === 'conduite' || vars.type === 'drive')) {
      vars.type = typeLabel(vars.type, lang);
    }
    const text = render(type, vars, lang, pack);
    res.json({
      ok: true, type, lang, text,
      whatsappUrl: c && c.phone ? waLink(c.phone, text) : '',
    });
  });
}

const api = {
  install, TYPES, TYPE_IDS, LANGS, MAX_LEN,
  formatAmount, typeLabel, waDigits, waLink, sanitize, normLang, studentLang,
  defaultPack, packOf, textOf, render, sampleVars, publicTypes,
  validatePayload, applyUpdate, bookingTemplate, sessionTypeForMode, varsForStudent,
};

if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.OQTemplates = api;
