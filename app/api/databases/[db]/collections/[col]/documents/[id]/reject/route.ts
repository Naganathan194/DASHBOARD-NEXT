import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { getEventDisplayName } from '@/lib/events';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES } from '@/lib/auth';
import QRCode from 'qrcode';

const WHATSAPP_COMMUNITY_LINK = process.env.WHATSAPP_COMMUNITY_LINK || '';
const COORDINATORS_JSON = process.env.COORDINATORS || '';
const WHATSAPP_COMMUNITY_LINK_PORTPASS = process.env.WHATSAPP_COMMUNITY_LINK_PORTPASS || '';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const { db, col, id } = await params;
  // require admin
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  if (!isAllowedCollection(col)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
  try {
    const { reason } = await req.json();
    if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 });

    const client = await connectToMongo();
    const query = buildQuery(id);
    const doc = await client.db(db).collection(col).findOne(query);
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    await client.db(db).collection(col).updateOne(query, {
      $set: { status: 'rejected', rejectedAt: new Date(), rejectionReason: reason },
    });

    const d = doc as Record<string, unknown>;
    const email = String(d.email ?? d.mail ?? d.Email ?? '');

    const firstName = String(d.firstName ?? d.first_name ?? d.fname ?? '');
    const lastName = String(d.lastName ?? d.last_name ?? d.lname ?? '');
    const name = firstName && lastName
      ? `${firstName} ${lastName}`.trim()
      : String(d.fullName ?? d.name ?? d.candidateName ?? 'Attendee');

    const displayName = getEventDisplayName(col);

    const parseCoordinators = (): Array<{ name?: string; contact?: string }> => {
      try {
        if (COORDINATORS_JSON.trim()) {
          const parsed = JSON.parse(COORDINATORS_JSON);
          if (Array.isArray(parsed)) return parsed.slice(0, 4);
        }
      } catch (e) {
        // ignore parse errors
      }
      const coords: Array<{ name?: string; contact?: string }> = [];
      for (let i = 1; i <= 4; i++) {
        const n = process.env[`COORD_${i}_NAME`];
        const c = process.env[`COORD_${i}_CONTACT`];
        if (n || c) coords.push({ name: n, contact: c });
      }
      return coords;
    };

    const coordinators = parseCoordinators();

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
        <div style="margin-top:18px;background:rgba(15,23,42,0.6);border:1px solid rgba(30,41,59,0.6);border-radius:12px;padding:16px 18px;text-align:left;margin-bottom:18px">
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


    if (email) {
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Registration Update</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-wrapper { padding: 12px 0 !important; }
      .email-card    { border-radius: 14px !important; }
      .header-pad    { padding: 32px 18px 28px !important; }
      .header-h1     { font-size: 22px !important; }
      .header-sub    { font-size: 13px !important; }
      .body-pad      { padding: 22px 16px !important; }
      .reason-box    { padding: 16px !important; }
      .footer-pad    { padding: 16px !important; }
      .greeting      { font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#060a14;font-family:'Segoe UI',Arial,sans-serif">
<div class="email-wrapper" style="padding:24px 0;background:#060a14">
<div class="email-card" style="max-width:600px;margin:0 auto;background:#0a0e1a;border-radius:20px;overflow:hidden;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.6)">

  <div style="height:4px;background:linear-gradient(90deg,#ef4444,#dc2626,#b91c1c)"></div>

  <div class="header-pad" style="background:linear-gradient(135deg,#450a0a,#7f1d1d);padding:44px 32px;text-align:center">
    <div style="font-size:44px;margin-bottom:12px">📋</div>
    <h1 class="header-h1" style="margin:0;color:#fff;font-size:28px;font-weight:800;line-height:1.2">Registration Update</h1>
    <p class="header-sub" style="color:rgba(255,255,255,0.65);font-size:14px;margin:10px 0 0">${displayName}</p>
  </div>

  <div class="body-pad" style="padding:32px">
    <p class="greeting" style="font-size:16px;margin:0 0 6px">
      Hi <strong style="color:#fca5a5">${name}</strong>,
    </p>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 24px">
      Thank you for your interest in <strong style="color:#f87171">${displayName}</strong>.
      After careful review, we regret to inform you that your registration could not be approved at this time.
    </p>
    <div class="reason-box" style="background:#1c0f0f;border:1px solid rgba(239,68,68,0.3);border-left:4px solid #ef4444;border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0 0 6px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px">Reason for rejection</p>
      <p style="margin:0;color:#fca5a5;font-size:15px;line-height:1.6">${reason}</p>
    </div>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0">
      If you believe this decision was made in error or have any questions, please reach out to the event organizer directly.
      We hope to see you at future events!
    </p>
    ${coordinatorsHtml}
  </div>

  <div class="footer-pad" style="padding:20px 32px 26px;text-align:center;border-top:1px solid #1e293b">
    <p style="color:#475569;font-size:12px;margin:0">${APP_NAME} &middot; Automated notification</p>
  </div>

  <div style="height:4px;background:linear-gradient(90deg,#b91c1c,#dc2626,#ef4444)"></div>

</div>
</div>
</body>
</html>`;

      await sendMail(email, `Registration Update — ${displayName} | ${APP_NAME}`, html);
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
