import nodemailer from 'nodemailer';

const EMAIL_USER = process.env.EMAIL_USER || 'your@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'your_app_password';
const APP_NAME   = process.env.APP_NAME   || 'EventManager';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
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
