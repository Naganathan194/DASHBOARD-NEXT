import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { getEventDisplayName, isEventPass } from '@/lib/events';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES } from '@/lib/auth';
import QRCode from 'qrcode';

const WHATSAPP_COMMUNITY_LINK = process.env.WHATSAPP_COMMUNITY_LINK || '';
const WHATSAPP_COMMUNITY_LINK_PORTPASS = process.env.WHATSAPP_COMMUNITY_LINK_PORTPASS || '';

// Get coordinators from individual env variables
function getCoordinators(): Array<{ name?: string; contact?: string }> {
  const coords: Array<{ name?: string; contact?: string }> = [];
  for (let i = 1; i <= 4; i++) {
    const name = process.env[`COORD_${i}_NAME`];
    const contact = process.env[`COORD_${i}_CONTACT`];
    if (name || contact) {
      coords.push({ name, contact });
    }
  }
  return coords;
}

function pick(doc: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) if (doc[k]) return String(doc[k]);
  return '';
}

function detailRow(label: string, value: string): string {
  if (!value || value.trim() === '') return '';
  return `
    <tr>
      <td class="detail-label" style="padding:10px 16px 10px 0;border-bottom:1px solid #1e293b;color:#64748b;font-size:13px;vertical-align:top;max-width:42%;display:inline-block;word-break:break-word;overflow-wrap:break-word;">
        ${label}
      </td>
      <td class="detail-value" style="padding:10px 0;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:14px;font-weight:500;vertical-align:top;max-width:58%;display:inline-block;word-break:break-word;overflow-wrap:break-word;">
        ${value}
      </td>
    </tr>`;
}

export async function POST(_req: Request, { params }: { params: Promise<{ db: string; col: string; id: string }> }) {
  const { db, col, id } = await params;
  // require admin
  const authCheck = await authorize(_req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  if (!isAllowedCollection(col)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });

  try {
    const client = await connectToMongo();
    const query: Filter<Document> = (() => { try { return { _id: new ObjectId(id) } as Filter<Document>; } catch { return { _id: id } as unknown as Filter<Document>; } })();
    const doc = await client.db(db).collection(col).findOne(query) as Record<string, unknown> | null;
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const email = pick(doc, 'email', 'mail', 'Email');
    if (!email) return NextResponse.json({ error: 'No email on document' }, { status: 400 });

    const firstName = pick(doc, 'firstName', 'first_name', 'fname');
    const lastName = pick(doc, 'lastName', 'last_name', 'lname');
    const fullName = firstName && lastName ? `${firstName} ${lastName}`.trim() : (pick(doc, 'fullName', 'name', 'candidateName', 'studentName') || 'Attendee');
    const displayName = getEventDisplayName(col);
    const eventIsPass = isEventPass(col);

    const contactNumber = pick(doc as Record<string, unknown>, 'contactNumber', 'phone', 'mobile', 'phoneNumber', 'contact', 'mobileNumber');
    const gender = pick(doc as Record<string, unknown>, 'gender', 'Gender');
    const collegeName = pick(doc as Record<string, unknown>, 'collegeName', 'college', 'institution', 'institutionName', 'College');
    const registerNo = pick(doc as Record<string, unknown>, 'registerNumber', 'regNo', 'registrationNumber', 'rollNumber', 'rollNo', 'regno', 'registerNo');
    const department = pick(doc as Record<string, unknown>, 'department', 'dept', 'branch', 'stream', 'Department');
    const year = pick(doc as Record<string, unknown>, 'year', 'yearOfStudy', 'currentYear', 'Year');
    const city = pick(doc as Record<string, unknown>, 'city', 'City', 'location', 'place');

    const subject = eventIsPass
      ? `🎟️ Your Event Pass is Confirmed — 6 March 2026 | ${APP_NAME}`
      : `🎉 You're In! ${displayName} — 5 March 2026 | ${APP_NAME}`;

    const detailsHtml = [
      detailRow('👤 Name', fullName),
      detailRow('📧 Email', email),
      detailRow('📱 Contact Number', contactNumber),
      detailRow('⚧  Gender', gender),
      detailRow('🏫 College', collegeName),
      detailRow('🎓 Register Number', registerNo),
      detailRow('📚 Department', department),
      detailRow('🗓️ Year', year),
      detailRow('🏙️ City', city),
    ].join('');

    const qrDataUrl = String(doc.qrCode ?? '');
    const qrCid = `qrcode_${id}@eventmanager`;
    let attachments: { filename: string; content: Buffer; contentType: string; cid: string }[] = [];

    if (qrDataUrl && qrDataUrl.startsWith('data:')) {
      const m = qrDataUrl.match(/^data:(image\/png);base64,(.+)$/);
      if (m) {
        const b64 = m[2];
        const buf = Buffer.from(b64, 'base64');
        attachments.push({ filename: `entry_pass_${String(fullName).replace(/\s+/g, '_')}.png`, content: buf, contentType: 'image/png', cid: qrCid });
      }
    }

    const coordinators = getCoordinators();

    // choose link: port pass registrations get a separate link when configured
    const whatsappLink = (col && String(col).toLowerCase() === 'portpassregistrations' && WHATSAPP_COMMUNITY_LINK_PORTPASS)
      ? WHATSAPP_COMMUNITY_LINK_PORTPASS
      : WHATSAPP_COMMUNITY_LINK;

    let whatsappQrDataUrl = '';
    if (whatsappLink) {
      try {
        whatsappQrDataUrl = await QRCode.toDataURL(whatsappLink, { errorCorrectionLevel: 'H' as const, margin: 1, width: 200 });
      } catch (e) {
        whatsappQrDataUrl = '';
      }
    }

    const coordinatorsHtml = coordinators.length > 0
      ? `
        <div style="margin-top:18px;background:rgba(15,23,42,0.6);border:1px solid rgba(30,41,59,0.6);border-radius:12px;padding:14px 16px;text-align:left;margin-bottom:18px">
          <h4 style="margin:0 0 8px;color:#93c5fd;font-size:13px;letter-spacing:0.6px">👥 Student Coordinators</h4>
          <table style="width:100%;border-collapse:collapse">
            ${coordinators.map(coord => `
              <tr>
                <td style="padding:6px 8px;color:#c7d2fe;font-weight:700;width:70%">${coord.name ?? 'Coordinator'}</td>
                <td style="padding:6px 8px;color:#93c5fd;text-align:right;width:30%"><a href="${coord.contact && coord.contact.startsWith('+') ? `https://wa.me/${coord.contact.replace(/[^0-9]/g, '')}` : (coord.contact ? `tel:${coord.contact}` : '#')}" style="color:#a78bfa;text-decoration:none">${coord.contact ?? ''}</a></td>
              </tr>
            `).join('')}
          </table>
        </div>`
      : '';

    const whatsappHtml = whatsappLink
      ? `
        <div style="margin-top:6px;text-align:center;margin-bottom:18px">
          <a href="${whatsappLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#25D366;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Join our WhatsApp Community</a>
          ${whatsappQrDataUrl ? `<div style="margin-top:10px"><img src="${whatsappQrDataUrl}" alt="Join WhatsApp" style="width:140px;height:140px;border-radius:8px;display:block;margin:8px auto 0"/></div>` : ''}
        </div>`
      : '';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Registration Confirmed</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-wrapper { padding: 12px 0 !important; }
      .email-card    { border-radius: 16px !important; }
      .header-pad    { padding: 36px 20px 32px !important; }
      .header-h1     { font-size: 26px !important; letter-spacing: -0.5px !important; }
      .header-sub    { font-size: 14px !important; }
      .body-pad      { padding: 24px 16px !important; }
      .card-pad      { padding: 18px 16px !important; }
      .qr-card       { padding: 24px 16px !important; }
      .qr-img        { width: 180px !important; height: 180px !important; }
      .footer-pad    { padding: 18px 16px 22px !important; }
      .greeting      { font-size: 15px !important; }
      .greeting-name { font-size: 17px !important; }
      .detail-label  { font-size: 11px !important; padding: 8px 12px 8px 0 !important; width: 38% !important; }
      .detail-value  { font-size: 13px !important; padding: 8px 0 !important; }
      .event-badge   { padding: 8px 18px !important; font-size: 15px !important; }
      .details-table td { display:block !important; width:100% !important; padding:8px 0 !important; box-sizing:border-box; }
      .details-table td:first-child { padding-right:0 !important; }
      .detail-row td { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#060a14;font-family:'Segoe UI',Arial,sans-serif">
<div class="email-wrapper" style="padding:24px 0;background:#060a14">
<div class="email-card" style="max-width:620px;margin:0 auto;background:#0a0e1a;border-radius:24px;overflow:hidden;color:#e2e8f0;box-shadow:0 30px 80px rgba(0,0,0,0.7)">

  <div style="height:5px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b)"></div>

  <div class="header-pad" style="background:linear-gradient(135deg,#312e81 0%,#4c1d95 40%,#6d28d9 70%,#7c3aed 100%);padding:52px 36px 44px;text-align:center">
    <div style="font-size:48px;line-height:1;margin-bottom:14px">🎊</div>
    <h1 class="header-h1" style="margin:0 0 10px;color:#fff;font-size:34px;font-weight:900;letter-spacing:-1px;line-height:1.15">
      You&rsquo;re Officially In!
    </h1>
    <p class="header-sub" style="color:rgba(255,255,255,0.75);font-size:16px;margin:0 0 20px;line-height:1.5">
      Your registration has been <strong style="color:#a5f3fc">confirmed</strong> for
    </p>
    <div class="event-badge" style="display:inline-block;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.25);border-radius:60px;padding:10px 28px">
      <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:0.3px">${displayName}</span>
    </div>
  </div>

  <div class="body-pad" style="padding:36px">
    <p class="greeting" style="font-size:17px;margin:0 0 6px;color:#e2e8f0">
      Hello, <strong class="greeting-name" style="color:#a78bfa;font-size:19px">${fullName}</strong> 👋
    </p>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 28px;line-height:1.7">
      We&rsquo;re resending your registration details &mdash; keep this email handy on your big day.
    </p>

    <!-- EVENT INFO CARD -->
    <div class="card-pad" style="background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08));border:1.5px solid rgba(99,102,241,0.35);border-radius:18px;padding:26px;margin-bottom:24px">
      <h3 style="margin:0 0 18px;color:#a78bfa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">
        ✦ Event Information
      </h3>
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
        <span style="font-size:20px;flex-shrink:0">📅</span>
        <div>
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Event Date</div>
          <div style="font-size:15px;color:#e2e8f0;font-weight:700">Friday, 6 March 2026</div>
          ${eventIsPass ? `<div style="font-size:12px;color:#f59e0b;margin-top:2px">⚠️ This pass is valid exclusively for 6 March 2026</div>` : ''}
        </div>
      </div>
    </div>

    <!-- ATTENDEE DETAILS CARD -->
    <div class="card-pad" style="background:#111827;border:1.5px solid #1e293b;border-radius:18px;padding:26px;margin-bottom:24px">
      <h3 style="margin:0 0 18px;color:#60a5fa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">
        ✦ Your Registration Details
      </h3>
      <table class="details-table" style="width:100%;border-collapse:collapse">
        ${detailsHtml}
      </table>
    </div>

    <!-- QR CODE CARD -->
    ${qrDataUrl ? `
    <div class="qr-card" style="background:linear-gradient(160deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%);border:2px solid #6366f1;border-radius:20px;padding:36px 24px;text-align:center;margin-bottom:24px;box-shadow:0 0 60px rgba(99,102,241,0.2) inset">
      <h3 style="margin:0 0 8px;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">🎫 Your Entry Pass QR</h3>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 24px;line-height:1.6">Show this QR code at the entrance for check-in.</p>
      <div style="display:inline-block;background:#fff;padding:16px;border-radius:16px;box-shadow:0 0 40px rgba(99,102,241,0.4),0 16px 32px rgba(0,0,0,0.4)">
        <img class="qr-img" src="cid:${qrCid}" alt="Entry QR Code" style="width:220px;height:220px;display:block;border-radius:6px"/>
      </div>
      <p style="color:#f1f5f9;font-size:15px;font-weight:700;margin:22px 0 8px">🚪 Present this QR at the entrance</p>
      <p style="color:#64748b;font-size:13px;margin:0;line-height:1.6">Your QR is also attached as a PNG &mdash; save it to your phone for easy check-in.</p>
    </div>` : ''}

    ${whatsappHtml}
    ${coordinatorsHtml}

  </div>

  <div class="footer-pad" style="padding:22px 36px 28px;text-align:center;border-top:1px solid #1e293b">
    <p style="color:#475569;font-size:12px;margin:0 0 4px">${APP_NAME} &middot; Automated notification</p>
    <p style="color:#334155;font-size:11px;margin:0">&copy; 2026 ${APP_NAME}. All rights reserved.</p>
  </div>

  <div style="height:5px;background:linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6,#6366f1)"></div>

</div>
</div>
</body>
</html>`;

    await sendMail(email, subject, html, attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, cid: a.cid })));
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
