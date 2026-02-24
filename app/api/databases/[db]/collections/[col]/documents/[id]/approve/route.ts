import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { getEventDisplayName, isEventPass } from '@/lib/events';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { authorize, ROLES } from '@/lib/auth';

const WHATSAPP_COMMUNITY_LINK = process.env.WHATSAPP_COMMUNITY_LINK;
const WHATSAPP_COMMUNITY_LINK_PORTPASS = process.env.WHATSAPP_COMMUNITY_LINK_PORTPASS;

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

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

/** Pick first truthy value from a list of field names on a doc */
function pick(doc: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) if (doc[k]) return String(doc[k]);
  return '';
}

/** Build a two-column table row for the attendee details card */
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

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const params_ = await params;
  // require admin
  const authCheck = await authorize(_req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  if (!isAllowedCollection(params_.col)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
  try {
    const client = await connectToMongo();
    const query = buildQuery(params_.id);
    const doc = await client.db(params_.db).collection(params_.col).findOne(query);
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const qrToken = crypto.randomBytes(16).toString('hex');
    const qrPayload = JSON.stringify({
      id: params_.id,
      token: qrToken,
      collection: params_.col,
      db: params_.db,
    });

    const qrOptions = {
      errorCorrectionLevel: 'H' as const,
      margin: 2,
      width: 320,
      color: { dark: '#1e293b', light: '#ffffff' },
    };

    const [qrBuffer, qrDataUrl] = await Promise.all([
      QRCode.toBuffer(qrPayload, qrOptions),
      QRCode.toDataURL(qrPayload, qrOptions),
    ]);

    await client.db(params_.db).collection(params_.col).updateOne(query, {
      $set: {
        status: 'approved',
        approvedAt: new Date(),
        qrToken,
        qrCode: qrDataUrl,
        checkedIn: false,
        checkInTime: null,
      },
    });

    const email = pick(doc as Record<string, unknown>, 'email', 'mail', 'Email');

    if (email) {
      // ── Resolve all attendee fields ────────────────────────────────────────
      const d = doc as Record<string, unknown>;
      const firstName = pick(d, 'firstName', 'first_name', 'fname');
      const lastName = pick(d, 'lastName', 'last_name', 'lname');
      const fullName = firstName && lastName
        ? `${firstName} ${lastName}`.trim()
        : pick(d, 'fullName', 'name', 'candidateName', 'studentName') || 'Attendee';

      const displayName = getEventDisplayName(params_.col);
      const eventIsPass = isEventPass(params_.col);

      const contactNumber = pick(d, 'contactNumber', 'phone', 'mobile', 'phoneNumber', 'contact', 'mobileNumber');
      const gender = pick(d, 'gender', 'Gender');
      const collegeName = pick(d, 'collegeName', 'college', 'institution', 'institutionName', 'College');
      const registerNo = pick(d, 'registerNumber', 'regNo', 'registrationNumber', 'rollNumber', 'rollNo', 'regno', 'registerNo');
      const department = pick(d, 'department', 'dept', 'branch', 'stream', 'Department');
      const year = pick(d, 'year', 'yearOfStudy', 'currentYear', 'Year');
      const city = pick(d, 'city', 'City', 'location', 'place');

      // ── Subject ────────────────────────────────────────────────────────────
      const subject = eventIsPass
        ? `🎟️ Your Event Pass is Confirmed — 6 March 2026 | ${APP_NAME}`
        : `🎉 You're In! ${displayName} — 5 March 2026 | ${APP_NAME}`;

      // ── Event date block ────────────────────────────────────────────────────
      const eventDateHtml = eventIsPass
        ? `<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
            <span style="font-size:20px">📅</span>
            <div>
              <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Event Date</div>
              <div style="font-size:15px;color:#e2e8f0;font-weight:700">Friday, 6 March 2026</div>
              <div style="font-size:12px;color:#f59e0b;margin-top:2px">⚠️ This pass is valid exclusively for 6 March 2026</div>
            </div>
          </div>`
        : `<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
            <span style="font-size:20px">📅</span>
            <div>
              <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Workshop Date</div>
              <div style="font-size:15px;color:#e2e8f0;font-weight:700">Thursday, 5 March 2026</div>
            </div>
          </div>`;

      // ── Attendee details rows ──────────────────────────────────────────────
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

      const qrCid = `qrcode_${params_.id}@eventmanager`;

      // Build WhatsApp join button (if configured) and coordinators list (up to 4)
      const coordinators = getCoordinators();

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

      // choose link: port pass registrations get a separate link when configured
      const whatsappLink = (params_.col && String(params_.col).toLowerCase() === 'portpassregistrations' && WHATSAPP_COMMUNITY_LINK_PORTPASS)
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

      const whatsappHtml = whatsappLink
        ? `
          <div style="margin-top:6px;text-align:center;margin-bottom:18px">
            <a href="${whatsappLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#25D366;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Join our WhatsApp Community</a>
            ${whatsappQrDataUrl ? `<div style="margin-top:10px"><img src="${whatsappQrDataUrl}" alt="Join WhatsApp" style="width:140px;height:140px;border-radius:8px;display:block;margin:8px auto 0"/></div>` : ''}
          </div>`
        : '';

      // ── Email HTML ─────────────────────────────────────────────────────────
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
      .email-card   { border-radius: 16px !important; }
      .header-pad   { padding: 36px 20px 32px !important; }
      .header-h1    { font-size: 26px !important; letter-spacing: -0.5px !important; }
      .header-sub   { font-size: 14px !important; }
      .body-pad     { padding: 24px 16px !important; }
      .card-pad     { padding: 18px 16px !important; }
      .qr-card      { padding: 24px 16px !important; }
      .qr-img       { width: 180px !important; height: 180px !important; }
      .footer-pad   { padding: 18px 16px 22px !important; }
      .greeting     { font-size: 15px !important; }
      .greeting-name{ font-size: 17px !important; }
      .detail-label { font-size: 11px !important; padding: 8px 12px 8px 0 !important; width: 38% !important; }
      .detail-value { font-size: 13px !important; padding: 8px 0 !important; }
      .event-badge  { padding: 8px 18px !important; font-size: 15px !important; }
      .tip-pad      { padding: 14px 16px !important; }
      .details-table td { display:block !important; width:100% !important; padding:8px 0 !important; box-sizing:border-box; }
      .details-table td:first-child { padding-right:0 !important; }
      .detail-row td { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#060a14;font-family:'Segoe UI',Arial,sans-serif">
<div class="email-wrapper" style="padding:24px 0;background:#060a14">
<div class="email-card" style="max-width:620px;margin:0 auto;background:#0a0e1a;border-radius:24px;overflow:hidden;color:#e2e8f0;box-shadow:0 30px 80px rgba(0,0,0,0.7)">

  <!-- TOP STRIPE -->
  <div style="height:5px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b)"></div>

  <!-- HEADER BANNER -->
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

  <!-- BODY -->
  <div class="body-pad" style="padding:36px">

    <!-- Greeting -->
    <p class="greeting" style="font-size:17px;margin:0 0 6px;color:#e2e8f0">
      Hello, <strong class="greeting-name" style="color:#a78bfa;font-size:19px">${fullName}</strong> 👋
    </p>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 28px;line-height:1.7">
      We&rsquo;re delighted to welcome you! Here are your complete registration details &mdash; keep this email handy on your big day.
    </p>

    <!-- EVENT INFO CARD -->
    <div class="card-pad" style="background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08));border:1.5px solid rgba(99,102,241,0.35);border-radius:18px;padding:26px;margin-bottom:24px">
      <h3 style="margin:0 0 18px;color:#a78bfa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">
        ✦ Event Information
      </h3>
      ${eventDateHtml}
      <div style="display:flex;align-items:flex-start;gap:12px">
        <span style="font-size:20px;flex-shrink:0">📍</span>
        <div>
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Venue</div>
          <div style="font-size:15px;color:#e2e8f0;font-weight:700">Sona College of Technology</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:2px">Department of Information Technology</div>
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
    <div class="qr-card" style="background:linear-gradient(160deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%);border:2px solid #6366f1;border-radius:20px;padding:36px 24px;text-align:center;margin-bottom:24px;box-shadow:0 0 60px rgba(99,102,241,0.2) inset">
      <h3 style="margin:0 0 8px;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">
        🎫 Your Entry Pass QR
      </h3>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 24px;line-height:1.6">
        Show this QR code at the entrance for check-in.
      </p>
      <!-- QR image -->
      <div style="display:inline-block;background:#fff;padding:16px;border-radius:16px;box-shadow:0 0 40px rgba(99,102,241,0.4),0 16px 32px rgba(0,0,0,0.4)">
        <img class="qr-img" src="cid:${qrCid}" alt="Entry QR Code" style="width:220px;height:220px;display:block;border-radius:6px"/>
      </div>
      <p style="color:#f1f5f9;font-size:15px;font-weight:700;margin:22px 0 8px;letter-spacing:0.2px">
        🚪 Present this QR at the entrance
      </p>
      <p style="color:#64748b;font-size:13px;margin:0;line-height:1.6">
        Your QR is also attached as a PNG &mdash; save it to your phone for easy check-in.
      </p>
    </div>

    <!-- PRO TIP -->
    <div class="tip-pad" style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:16px 20px">
      <p style="margin:0;font-size:13px;color:#fbbf24;line-height:1.6">
        <strong>💡 Pro Tip:</strong> Screenshot or download the attached PNG QR code and keep it accessible on your phone for the fastest check-in experience.
      </p>
    </div>
    ${whatsappHtml}
    ${coordinatorsHtml}

  </div>

  <!-- FOOTER -->
  <div class="footer-pad" style="padding:22px 36px 28px;text-align:center;border-top:1px solid #1e293b">
    <p style="color:#475569;font-size:12px;margin:0 0 4px">${APP_NAME} &middot; Automated notification</p>
    <p style="color:#334155;font-size:11px;margin:0">&copy; 2026 ${APP_NAME}. All rights reserved.</p>
  </div>

  <!-- BOTTOM STRIPE -->
  <div style="height:5px;background:linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6,#6366f1)"></div>

</div>
</div>
</body>
</html>`;


      await sendMail(
        email,
        subject,
        html,
        [{
          filename: `entry_pass_${String(fullName).replace(/\s+/g, '_')}.png`,
          content: qrBuffer,
          contentType: 'image/png',
          cid: qrCid,
        }]
      );
    }

    return NextResponse.json({ success: true, qrCode: qrDataUrl });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

