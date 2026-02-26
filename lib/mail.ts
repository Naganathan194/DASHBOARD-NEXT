import nodemailer from 'nodemailer';

// Brevo (formerly Sendinblue) SMTP relay
// BREVO_SMTP_USER = your Brevo account login email
// BREVO          = your Brevo SMTP key / API key (xkeysib-...)
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER || '';
// Use the dedicated SMTP key (generated from Brevo Dashboard → SMTP & API → SMTP tab)
// Falls back to the API key, but the SMTP key is strongly preferred
const BREVO_SMTP_KEY  = process.env.BREVO_SMTP_KEY || process.env.BREVO || '';
const FROM_EMAIL      = process.env.FROM_EMAIL || BREVO_SMTP_USER;
const APP_NAME        = process.env.APP_NAME   || 'EventManager';

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,          // STARTTLS on port 587
  auth: {
    user: BREVO_SMTP_USER,
    pass: BREVO_SMTP_KEY,
  },
  tls: { minVersion: 'TLSv1.2' },
});

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  attachments: nodemailer.SendMailOptions['attachments'] = []
) {
  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${APP_NAME}" <${FROM_EMAIL}>`,
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
