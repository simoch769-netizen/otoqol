'use strict';
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const DEFAULT_FROM = 'Otoqol <contact.otoqol@gmail.com>';
const DEFAULT_USER = 'contact.otoqol@gmail.com';
const DEFAULT_HOST = 'smtp.gmail.com';
const DEFAULT_PORT = 465;
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function isCapture() {
  return (process.env.SMTP_HOST || '') === 'capture';
}

function hasBrevo() {
  return !!(process.env.BREVO_API_KEY && String(process.env.BREVO_API_KEY).trim());
}

function isConfigured() {
  if (hasBrevo()) return true;
  if (isCapture()) return true;
  return !!process.env.SMTP_PASS;
}

function fromAddr() {
  return process.env.MAIL_FROM || DEFAULT_FROM;
}

function mailTimeoutMs() {
  const n = Number(process.env.MAIL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

/** Parse MAIL_FROM into Brevo's { name, email }. Defaults: Otoqol / contact.otoqol@gmail.com. */
function senderFrom() {
  const raw = String(fromAddr() || '').trim();
  const m = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/) || raw.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = String(m[1] || '').trim().replace(/^"|"$/g, '') || 'Otoqol';
    const email = String(m[2] || '').trim();
    if (email) return { name, email };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { name: 'Otoqol', email: raw };
  return { name: 'Otoqol', email: DEFAULT_USER };
}

function makeTransport() {
  if (isCapture()) return nodemailer.createTransport({ jsonTransport: true });
  const host = process.env.SMTP_HOST || DEFAULT_HOST;
  const port = Number(process.env.SMTP_PORT || DEFAULT_PORT);
  const user = process.env.SMTP_USER || DEFAULT_USER;
  const pass = process.env.SMTP_PASS || '';
  const ms = mailTimeoutMs();
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: ms,
    greetingTimeout: ms,
    socketTimeout: ms,
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function buildEmail(code) {
  const c = String(code);
  const subject = 'رمز إعادة تعيين كلمة السر — Code de réinitialisation | Otoqol';
  const text = [
    'Otoqol',
    'إدارة مدارس السياقة · Gestion d’auto-écoles',
    '',
    'إعادة تعيين كلمة السر',
    'Réinitialisation du mot de passe',
    '',
    'رمز التحقق الخاص بك هو:',
    'Votre code de vérification est :',
    '',
    c,
    '',
    'هذا الرمز صالح لمدة 15 دقيقة.',
    'Ce code est valable 15 minutes.',
    '',
    'إذا لم تطلب إعادة تعيين كلمة السر، يمكنك تجاهل هذه الرسالة.',
    'Si vous n’avez pas demandé cette réinitialisation, ignorez ce message.',
    '',
    'فريق Otoqol',
    '',
    'واتساب / WhatsApp : +212 716-396333',
    'إنستغرام / Instagram : @otoqol_officiel',
    'البريد / E-mail : contact.otoqol@gmail.com',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ar">
<body style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0f766e;color:#ffffff;padding:20px 24px;text-align:center;border-bottom:4px solid #2DD4BF;">
      <div style="font-size:24px;font-weight:700;letter-spacing:0.5px;">Otoqol</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;">إدارة مدارس السياقة · Gestion d’auto-écoles</div>
    </div>
    <div style="padding:24px;">
      <h1 style="font-size:18px;margin:0 0 4px;text-align:right;direction:rtl;">إعادة تعيين كلمة السر</h1>
      <p style="margin:0 0 16px;color:#64748b;text-align:left;direction:ltr;">Réinitialisation du mot de passe</p>
      <p style="margin:0 0 6px;text-align:right;direction:rtl;">رمز التحقق الخاص بك هو:</p>
      <p style="margin:0 0 12px;color:#64748b;text-align:left;direction:ltr;">Votre code de vérification est :</p>
      <div style="text-align:center;margin:16px 0;padding:16px;background:#f0fdfa;border-radius:10px;font-size:28px;font-weight:700;letter-spacing:8px;color:#0f766e;font-family:Consolas,Menlo,monospace;direction:ltr;">${escapeHtml(c)}</div>
      <p style="margin:0 0 4px;text-align:right;direction:rtl;">هذا الرمز صالح لمدة 15 دقيقة.</p>
      <p style="margin:0 0 16px;color:#64748b;text-align:left;direction:ltr;">Ce code est valable 15 minutes.</p>
      <p style="margin:0 0 4px;text-align:right;direction:rtl;font-size:13px;color:#64748b;">إذا لم تطلب إعادة تعيين كلمة السر، يمكنك تجاهل هذه الرسالة.</p>
      <p style="margin:0 0 20px;font-size:13px;color:#64748b;text-align:left;direction:ltr;">Si vous n’avez pas demandé cette réinitialisation, ignorez ce message.</p>
      <p style="margin:0;font-weight:700;">فريق Otoqol</p>
    </div>
    <div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;line-height:1.7;">
      واتساب / WhatsApp : +212 716-396333<br>
      إنستغرام / Instagram : @otoqol_officiel<br>
      البريد / E-mail : contact.otoqol@gmail.com
    </div>
  </div>
</body>
</html>`;
  return { subject, text, html };
}

function capturePath() {
  return process.env.SMTP_CAPTURE_FILE || path.join(process.cwd(), 'data', 'mail-capture.jsonl');
}

function appendCapture(row) {
  try {
    const f = capturePath();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(row) + '\n');
  } catch (e) {
    console.error('[mail] failed to write capture file:', e.message);
  }
}

function getFetch() {
  return (typeof fetch === 'function' ? fetch : null);
}

async function sendViaBrevo({ to, subject, text, html }) {
  const fetchFn = getFetch();
  if (!fetchFn) throw new Error('fetch is not available');
  const ctrl = new AbortController();
  const ms = mailTimeoutMs();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const sender = senderFrom();
    const res = await fetchFn(BREVO_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) {}
      throw new Error('Brevo HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    return { sent: true, via: 'brevo' };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaSmtp({ to, subject, text, html }) {
  const transport = makeTransport();
  const info = await transport.sendMail({
    from: fromAddr(),
    to,
    subject,
    text,
    html,
  });
  if (isCapture()) {
    let parsed = null;
    try { parsed = JSON.parse(info.message); } catch (e) {}
    appendCapture({
      at: new Date().toISOString(),
      to,
      from: fromAddr(),
      subject,
      text,
      html,
      envelope: parsed && parsed.envelope,
    });
  }
  return { sent: true, via: isCapture() ? 'capture' : 'smtp' };
}

async function sendMail({ to, subject, text, html, kind }) {
  const label = kind || subject || 'email';
  if (!isConfigured()) {
    console.warn('[mail] mail not configured — not sent: ' + label);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    // Prefer Brevo HTTPS when the key is set (SMTP is often blocked). Capture mode stays on SMTP for local tests.
    if (hasBrevo() && !isCapture()) return await sendViaBrevo({ to, subject, text, html });
    return await sendViaSmtp({ to, subject, text, html });
  } catch (e) {
    const reason = e && (e.name === 'AbortError' || /aborted/i.test(String(e && e.message))) ? 'timeout' : 'send_failed';
    console.error('[mail] failed to send ' + label + ':', e && e.message);
    return { sent: false, reason };
  }
}

async function sendResetEmail({ to, code }) {
  const { subject, text, html } = buildEmail(code);
  return sendMail({ to, subject, text, html, kind: 'password reset email' });
}

function ownerEmail() {
  return process.env.OWNER_EMAIL || DEFAULT_USER;
}

function publicUrl() {
  return String(process.env.PUBLIC_URL || 'https://otoqol.com').trim().replace(/\/+$/, '');
}

function wrapEmail({ titleAr, titleFr, bodyHtml, bodyText }) {
  const subject = titleAr + ' — ' + titleFr + ' | Otoqol';
  const text = [
    'Otoqol',
    'إدارة مدارس السياقة · Gestion d’auto-écoles',
    '',
    titleAr,
    titleFr,
    '',
    bodyText,
    '',
    'فريق Otoqol',
    '',
    'واتساب / WhatsApp : +212 716-396333',
    'إنستغرام / Instagram : @otoqol_officiel',
    'البريد / E-mail : contact.otoqol@gmail.com',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="ar">
<body style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0f766e;color:#ffffff;padding:20px 24px;text-align:center;border-bottom:4px solid #2DD4BF;">
      <div style="font-size:24px;font-weight:700;letter-spacing:0.5px;">Otoqol</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px;">إدارة مدارس السياقة · Gestion d’auto-écoles</div>
    </div>
    <div style="padding:24px;">
      <h1 style="font-size:18px;margin:0 0 4px;text-align:right;direction:rtl;">${escapeHtml(titleAr)}</h1>
      <p style="margin:0 0 16px;color:#64748b;text-align:left;direction:ltr;">${escapeHtml(titleFr)}</p>
      ${bodyHtml}
      <p style="margin:20px 0 0;font-weight:700;">فريق Otoqol</p>
    </div>
    <div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;line-height:1.7;">
      واتساب / WhatsApp : +212 716-396333<br>
      إنستغرام / Instagram : @otoqol_officiel<br>
      البريد / E-mail : contact.otoqol@gmail.com
    </div>
  </div>
</body>
</html>`;
  return { subject, text, html };
}

function row(labelAr, labelFr, value) {
  const v = String(value == null ? '' : value);
  return {
    html: `<p style="margin:0 0 2px;text-align:right;direction:rtl;"><b>${escapeHtml(labelAr)}:</b> ${escapeHtml(v)}</p>
      <p style="margin:0 0 10px;color:#64748b;text-align:left;direction:ltr;font-size:13px;">${escapeHtml(labelFr)} : ${escapeHtml(v)}</p>`,
    text: labelAr + ' / ' + labelFr + ' : ' + v,
  };
}

function buildOwnerSignupEmail(info) {
  const link = publicUrl() + '/owner';
  const fields = [
    row('اسم المدرسة', 'École', info.name),
    row('رمز المدرسة', 'Code', info.code),
    row('المدينة', 'Ville', info.city),
    row('اسم المدير', 'Responsable', info.managerName),
    row('البريد الإلكتروني', 'E-mail', info.email),
    row('الهاتف', 'Téléphone', info.phone),
    row('اسم المستخدم', 'Identifiant', info.username),
  ];
  const bodyHtml = fields.map(f => f.html).join('') +
    `<p style="margin:16px 0 6px;text-align:right;direction:rtl;">لمراجعة الطلب والموافقة أو الرفض:</p>
     <p style="margin:0 0 12px;color:#64748b;text-align:left;direction:ltr;">Pour examiner la demande (approuver ou refuser) :</p>
     <p style="text-align:center;margin:16px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;">${escapeHtml(link)}</a></p>`;
  const bodyText = fields.map(f => f.text).join('\n') + '\n\n' +
    'لمراجعة الطلب والموافقة أو الرفض / Pour examiner la demande :\n' + link;
  return wrapEmail({
    titleAr: 'طلب تسجيل مدرسة جديدة',
    titleFr: 'Nouvelle demande d’inscription',
    bodyHtml,
    bodyText,
  });
}

function buildApprovedEmail(info) {
  const link = publicUrl() + '/app';
  const username = String(info.username || '').trim();
  const userRow = username ? row('اسم المستخدم', 'Identifiant', username).html : '';
  const bodyHtml =
    `<p style="margin:0 0 6px;text-align:right;direction:rtl;">تمت الموافقة على حساب مدرستك في Otoqol.</p>
     <p style="margin:0 0 16px;color:#64748b;text-align:left;direction:ltr;">Le compte de votre auto-école sur Otoqol a été approuvé.</p>` +
    userRow +
    `<p style="margin:16px 0 6px;text-align:right;direction:rtl;">سجّل الدخول من الرابط التالي باسم المستخدم أعلاه (لا نرسل كلمة السر في البريد).</p>
     <p style="margin:0 0 12px;color:#64748b;text-align:left;direction:ltr;">Connectez-vous via le lien ci-dessous avec l’identifiant ci-dessus (le mot de passe n’est pas envoyé par e-mail).</p>
     <p style="text-align:center;margin:16px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;">${escapeHtml(link)}</a></p>`;
  const bodyText = [
    'تمت الموافقة على حساب مدرستك في Otoqol.',
    'Le compte de votre auto-école sur Otoqol a été approuvé.',
    '',
    ...(username ? ['اسم المستخدم / Identifiant : ' + username, ''] : []),
    'رابط تسجيل الدخول / Lien de connexion :',
    link,
    '',
    'سجّل الدخول باسم المستخدم أعلاه. لا نرسل كلمة السر في البريد.',
    'Connectez-vous avec l’identifiant ci-dessus. Le mot de passe n’est pas envoyé par e-mail.',
  ].join('\n');
  return wrapEmail({
    titleAr: 'تمت الموافقة على حساب مدرستك',
    titleFr: 'Votre compte a été approuvé',
    bodyHtml,
    bodyText,
  });
}

async function sendOwnerSignupNotice(info) {
  const { subject, text, html } = buildOwnerSignupEmail(info);
  return sendMail({ to: ownerEmail(), subject, text, html, kind: 'owner signup notice' });
}

async function sendSchoolApprovedEmail({ to, name, username }) {
  const { subject, text, html } = buildApprovedEmail({ name, username });
  return sendMail({ to, subject, text, html, kind: 'school approved email' });
}

module.exports = { isConfigured, sendResetEmail, sendMail, sendOwnerSignupNotice, sendSchoolApprovedEmail,
  buildEmail, buildOwnerSignupEmail, buildApprovedEmail, senderFrom, ownerEmail, publicUrl, BREVO_URL };
