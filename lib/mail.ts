import nodemailer from 'nodemailer';

const EMAIL_USER = process.env.EMAIL_USER || 'your@outlook.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'your_password';
const APP_NAME   = process.env.APP_NAME   || 'EventManager';

const transporter = nodemailer.createTransport({
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,        // use STARTTLS on 587
  requireTLS: true,     // force TLS upgrade
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  tls: { minVersion: 'TLSv1.2' },
});

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  attachments: nodemailer.SendMailOptions['attachments'] = []
) {
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${APP_NAME}" <${EMAIL_USER}>`,
    to,
    subject,
    html,
    attachments,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Mail sent to ${to} — id=${info.messageId}`);
    return info;
  } catch (err: unknown) {
    console.error('Mail error:', (err as Error).message);
    throw err;
  }
}

export { APP_NAME };
