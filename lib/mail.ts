import nodemailer from 'nodemailer';

const EMAIL_USER = process.env.EMAIL_USER || 'your@outlook.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'your_password';
const APP_NAME   = process.env.APP_NAME   || 'EventManager';

const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false, // STARTTLS
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  tls: { ciphers: 'SSLv3' },
});

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  attachments: nodemailer.SendMailOptions['attachments'] = []
) {
  try {
    await transporter.sendMail({ from: `"${APP_NAME}" <${EMAIL_USER}>`, to, subject, html, attachments });
    console.log(`📧 Mail sent to ${to}`);
  } catch (err: unknown) {
    console.error('Mail error:', (err as Error).message);
  }
}

export { APP_NAME };
