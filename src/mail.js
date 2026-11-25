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

async function sendResetEmail({ to, code }) {
  if (!isConfigured()) {
    console.warn('[mail] mail not configured — password reset email not sent');
    return { sent: false, reason: 'not_configured' };
  }
  const { subject, text, html } = buildEmail(code);
  try {
    // Prefer Brevo HTTPS when the key is set (SMTP is often blocked). Capture mode stays on SMTP for local tests.
    if (hasBrevo() && !isCapture()) return await sendViaBrevo({ to, subject, text, html });
    return await sendViaSmtp({ to, subject, text, html });
  } catch (e) {
    const reason = e && (e.name === 'AbortError' || /aborted/i.test(String(e && e.message))) ? 'timeout' : 'send_failed';
    console.error('[mail] failed to send password reset email:', e && e.message);
    return { sent: false, reason };
  }
}

module.exports = { isConfigured, sendResetEmail, buildEmail, senderFrom, BREVO_URL };
