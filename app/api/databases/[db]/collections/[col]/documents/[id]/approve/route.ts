import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { getEventDisplayName, isEventPass } from '@/lib/events';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { authorize, ROLES } from '@/lib/auth';

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
      <td style="padding:10px 16px 10px 0;border-bottom:1px solid #1e293b;color:#64748b;font-size:13px;vertical-align:top;max-width:42%;display:inline-block;word-break:break-word;overflow-wrap:break-word;">
        ${label}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:14px;font-weight:500;vertical-align:top;max-width:58%;display:inline-block;word-break:break-word;overflow-wrap:break-word;">
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
      const lastName  = pick(d, 'lastName',  'last_name',  'lname');
      const fullName  = firstName && lastName
        ? `${firstName} ${lastName}`.trim()
        : pick(d, 'fullName', 'name', 'candidateName', 'studentName') || 'Attendee';

      const displayName  = getEventDisplayName(params_.col);
      const eventIsPass  = isEventPass(params_.col);

      const contactNumber = pick(d, 'contactNumber', 'phone', 'mobile', 'phoneNumber', 'contact', 'mobileNumber');
      const gender        = pick(d, 'gender', 'Gender');
      const collegeName   = pick(d, 'collegeName', 'college', 'institution', 'institutionName', 'College');
      const registerNo    = pick(d, 'registerNumber', 'regNo', 'registrationNumber', 'rollNumber', 'rollNo', 'regno', 'registerNo');
      const department    = pick(d, 'department', 'dept', 'branch', 'stream', 'Department');
      const year          = pick(d, 'year', 'yearOfStudy', 'currentYear', 'Year');
      const city          = pick(d, 'city', 'City', 'location', 'place');

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
        detailRow('👤 Name',              fullName),
        detailRow('📧 Email',             email),
        detailRow('📱 Contact Number',    contactNumber),
        detailRow('⚧  Gender',            gender),
        detailRow('🏫 College',           collegeName),
        detailRow('🎓 Register Number',   registerNo),
        detailRow('📚 Department',        department),
        detailRow('🗓️ Year',              year),
        detailRow('🏙️ City',             city),
      ].join('');

      const qrCid = `qrcode_${params_.id}@eventmanager`;

      // ── Email HTML ─────────────────────────────────────────────────────────
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    /* Mobile-first overrides for email clients that support media queries */
    @media only screen and (max-width:480px) {
      .details-table td { display:block !important; width:100% !important; padding:8px 0 !important; box-sizing:border-box; }
      .details-table td:first-child { padding-right:0 !important; }
      .detail-row td { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:24px 0;background:#060a14;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:620px;margin:0 auto;background:#0a0e1a;border-radius:24px;overflow:hidden;color:#e2e8f0;box-shadow:0 30px 80px rgba(0,0,0,0.7)">

  <!-- ═══ TOP STRIPE ═══ -->
  <div style="height:5px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b)"></div>

  <!-- ═══ HEADER BANNER ═══ -->
  <div style="background:linear-gradient(135deg,#312e81 0%,#4c1d95 40%,#6d28d9 70%,#7c3aed 100%);padding:52px 36px 44px;text-align:center">
    <div style="font-size:52px;line-height:1;margin-bottom:16px">🎊</div>
    <h1 style="margin:0 0 10px;color:#fff;font-size:34px;font-weight:900;letter-spacing:-1px">
      You&rsquo;re Officially In!
    </h1>
    <p style="color:rgba(255,255,255,0.75);font-size:16px;margin:0 0 20px;line-height:1.5">
      Your registration has been <strong style="color:#a5f3fc">confirmed</strong> for
    </p>
    <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.25);border-radius:60px;padding:10px 28px;backdrop-filter:blur(10px)">
      <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:0.3px">${displayName}</span>
    </div>
  </div>

  <!-- ═══ BODY ═══ -->
  <div style="padding:36px">

    <!-- Greeting -->
    <p style="font-size:17px;margin:0 0 6px;color:#e2e8f0">
      Hello, <strong style="color:#a78bfa;font-size:19px">${fullName}</strong> 👋
    </p>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 32px;line-height:1.7">
      We&rsquo;re absolutely delighted to welcome you! Get ready for an incredible experience.
      Here are your complete registration details — keep this email handy on your big day.
    </p>

    <!-- ── EVENT INFO CARD ── -->
    <div style="background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08));border:1.5px solid rgba(99,102,241,0.35);border-radius:18px;padding:26px;margin-bottom:26px">
      <h3 style="margin:0 0 20px;color:#a78bfa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">
        ✦ Event Information
      </h3>
      ${eventDateHtml}
      <div style="display:flex;align-items:flex-start;gap:12px">
        <span style="font-size:20px">📍</span>
        <div>
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Venue</div>
          <div style="font-size:15px;color:#e2e8f0;font-weight:700">Sona College of Technology</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:2px">Department of Information Technology</div>
        </div>
      </div>
    </div>

    <!-- ── ATTENDEE DETAILS CARD ── -->
    <div style="background:#111827;border:1.5px solid #1e293b;border-radius:18px;padding:26px;margin-bottom:26px">
      <h3 style="margin:0 0 20px;color:#60a5fa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">
        ✦ Your Registration Details
      </h3>
      <table class="details-table" style="width:100%;border-collapse:collapse">
        ${detailsHtml}
      </table>
    </div>

    <!-- ── QR CODE CARD ── -->
    <div style="background:linear-gradient(160deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%);border:2px solid #6366f1;border-radius:20px;padding:36px;text-align:center;margin-bottom:28px;box-shadow:0 0 60px rgba(99,102,241,0.2) inset">
      <h3 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:900;letter-spacing:-0.5px">
        🎫 Your Entry Pass QR
      </h3>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;line-height:1.6">
        This is your personalised entry pass. Keep it safe and show it at the entrance.
      </p>
      <!-- QR wrapper -->
      <div style="display:inline-block;background:#fff;padding:18px;border-radius:20px;box-shadow:0 0 50px rgba(99,102,241,0.5),0 20px 40px rgba(0,0,0,0.4)">
        <img src="cid:${qrCid}" alt="Entry QR Code" style="width:230px;height:230px;display:block;border-radius:8px"/>
      </div>
      <!-- Mandatory footer lines -->
      <p style="color:#f1f5f9;font-size:16px;font-weight:700;margin:26px 0 10px;letter-spacing:0.2px">
        🚪 Present this QR at the entrance
      </p>
      <p style="color:#64748b;font-size:13px;margin:0;line-height:1.6">
        Your QR code is also attached as a PNG file &mdash; save it to your phone for easy check-in.
      </p>
    </div>

    <!-- ── PRO TIP ── -->
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:16px 20px;margin-bottom:8px">
      <p style="margin:0;font-size:13px;color:#fbbf24;line-height:1.6">
        <strong>💡 Pro Tip:</strong> Screenshot or download the attached PNG QR code and keep it accessible on your phone screen for the fastest check-in experience.
      </p>
    </div>

  </div>

  <!-- ═══ FOOTER ═══ -->
  <div style="padding:22px 36px 28px;text-align:center;border-top:1px solid #1e293b">
    <p style="color:#475569;font-size:12px;margin:0 0 4px">
      ${APP_NAME} &middot; Automated notification
    </p>
    <p style="color:#334155;font-size:11px;margin:0">&copy; 2026 ${APP_NAME}. All rights reserved.</p>
  </div>

  <!-- ═══ BOTTOM STRIPE ═══ -->
  <div style="height:5px;background:linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6,#6366f1)"></div>

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

