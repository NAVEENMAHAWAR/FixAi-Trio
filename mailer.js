require('dotenv').config();
const nodemailer = require('nodemailer');

let transporter = null;

// Create the email transporter only when SMTP is configured.
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
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
  await transporter.sendMail({
    from: process.env.MAIL_FROM || '"FixAI" <no-reply@fixai.app>',
    to,
    subject,
    html
  });

  return {
    ok: true
  };
}

module.exports = {
  sendMail
};
