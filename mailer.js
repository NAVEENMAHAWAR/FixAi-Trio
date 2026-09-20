require('dotenv').config();
const nodemailer = require('nodemailer');

let transporter = null;

// Create the email transporter only when SMTP is configured.
if (process.env.SMTP_HOST) {
  console.log('📧 SMTP configured:');
  console.log('   Host:', process.env.SMTP_HOST);
  console.log('   Port:', process.env.SMTP_PORT || 587);
  console.log('   User:', process.env.SMTP_USER || '(not set)');
  console.log('   Pass:', process.env.SMTP_PASS ? '****' + process.env.SMTP_PASS.slice(-4) : '(not set)');

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  // Verify SMTP connection on startup
  transporter.verify()
    .then(() => console.log('✅ SMTP connection verified successfully!'))
    .catch(err => console.error('❌ SMTP connection FAILED:', err.message));
} else {
  console.log('⚠️  SMTP not configured — emails will be printed to console (DEV MODE)');
}

// Send an email
async function sendMail(to, subject, html) {

  // If SMTP is not configured, show the email content in the terminal.
  // This is useful during development and testing.
  if (!transporter) {
    console.log('\n===== [DEV MODE] Email Preview =====');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(
      'Body:',
      html.replace(/<[^>]*>/g, ' ').trim()
    );
    console.log('====================================\n');

    return {
      ok: false,
      dev: true
    };
  }

  // Send the email through the configured SMTP server.
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || '"FixAI" <no-reply@fixai.app>',
      to,
      subject,
      html
    });

    console.log(`✅ Email sent to ${to} (messageId: ${info.messageId})`);
    return {
      ok: true
    };
  } catch (err) {
    console.error(`❌ Email FAILED to ${to}:`, err.message);
    console.error('   Full error:', err.code, err.response || '');
    return {
      ok: false,
      error: err.message
    };
  }
}

module.exports = {
  sendMail
};