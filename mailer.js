require('dotenv').config();

// ==========================================
// FixAI Mailer
// Supports Brevo HTTP API (Recommended for Render), Resend, and SMTP
// ==========================================

let sendMailFn;

// ---------- Option 1: Brevo HTTP API (Free 300 emails/day, sends to ANY recipient) ----------
if (process.env.BREVO_API_KEY) {

  console.log('📧 Email provider: Brevo (HTTP API)');
  const senderEmail = process.env.MAIL_FROM_EMAIL || process.env.OWNER_EMAIL || 'no-reply@fixai.app';
  const senderName = process.env.MAIL_FROM_NAME || 'FixAI';

  sendMailFn = async function sendMailBrevo(to, subject, html) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html
        })
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(`❌ Brevo email FAILED to ${to}:`, data);
        return { ok: false, error: data.message || 'Brevo error' };
      }

      console.log(`✅ Email sent to ${to} via Brevo (messageId: ${data.messageId})`);
      return { ok: true };
    } catch (err) {
      console.error(`❌ Brevo email FAILED to ${to}:`, err.message);
      return { ok: false, error: err.message };
    }
  };

// ---------- Option 2: Resend HTTP API ----------
} else if (process.env.RESEND_API_KEY) {

  console.log('📧 Email provider: Resend (HTTP API)');

  sendMailFn = async function sendMailResend(to, subject, html) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || 'FixAI <onboarding@resend.dev>',
          to: [to],
          subject,
          html
        })
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(`❌ Resend email FAILED to ${to}:`, data);
        return { ok: false, error: data.message || 'Resend error' };
      }

      console.log(`✅ Email sent to ${to} via Resend (id: ${data.id})`);
      return { ok: true };
    } catch (err) {
      console.error(`❌ Resend email FAILED to ${to}:`, err.message);
      return { ok: false, error: err.message };
    }
  };

// ---------- Option 3: SMTP (Local Dev only) ----------
} else if (process.env.SMTP_HOST) {

  const nodemailer = require('nodemailer');

  console.log('📧 Email provider: SMTP');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  sendMailFn = async function sendMailSMTP(to, subject, html) {
    try {
      const info = await transporter.sendMail({
        from: process.env.MAIL_FROM || '"FixAI" <no-reply@fixai.app>',
        to,
        subject,
        html
      });
      console.log(`✅ Email sent to ${to} (messageId: ${info.messageId})`);
      return { ok: true };
    } catch (err) {
      console.error(`❌ SMTP email FAILED to ${to}:`, err.message);
      return { ok: false, error: err.message };
    }
  };

// ---------- Option 4: DEV MODE ----------
} else {

  console.log('⚠️  No email provider configured — OTPs will print to console (DEV MODE)');

  sendMailFn = async function sendMailDev(to, subject, html) {
    console.log('\n===== [DEV MODE] Email Preview =====');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Body:', html.replace(/<[^>]*>/g, ' ').trim());
    console.log('====================================\n');
    return { ok: false, dev: true };
  };
}

async function sendMail(to, subject, html) {
  return sendMailFn(to, subject, html);
}

module.exports = { sendMail };
