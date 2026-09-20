require('dotenv').config();

// ==========================================
// FixAI Mailer — Supports Resend (HTTP) and SMTP
// Resend is recommended for Render (free tier blocks SMTP ports)
// ==========================================

let sendMailFn;

// ---------- Option 1: Resend (HTTP-based, works on Render) ----------
if (process.env.RESEND_API_KEY) {

  console.log('📧 Email provider: Resend (HTTP API)');
  console.log('   From:', process.env.MAIL_FROM || 'onboarding@resend.dev');

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

// ---------- Option 2: SMTP (Gmail etc — won't work on Render free tier) ----------
} else if (process.env.SMTP_HOST) {

  const nodemailer = require('nodemailer');

  console.log('📧 Email provider: SMTP');
  console.log('   Host:', process.env.SMTP_HOST);
  console.log('   Port:', process.env.SMTP_PORT || 587);
  console.log('   User:', process.env.SMTP_USER || '(not set)');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  transporter.verify()
    .then(() => console.log('✅ SMTP connection verified!'))
    .catch(err => console.error('❌ SMTP connection FAILED:', err.message));

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

// ---------- Option 3: DEV MODE (no email configured — print to console) ----------
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

// Export
async function sendMail(to, subject, html) {
  return sendMailFn(to, subject, html);
}

module.exports = { sendMail };
