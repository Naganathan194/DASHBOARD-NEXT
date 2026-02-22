import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { getEventDisplayName, isEventPass } from '@/lib/events';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES } from '@/lib/auth';

function pick(doc: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) if (doc[k]) return String(doc[k]);
  return '';
}

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
    const lastName  = pick(doc, 'lastName',  'last_name',  'lname');
    const fullName  = firstName && lastName ? `${firstName} ${lastName}`.trim() : (pick(doc, 'fullName', 'name', 'candidateName', 'studentName') || 'Attendee');
    const displayName  = getEventDisplayName(col);
    const eventIsPass  = isEventPass(col);

    const contactNumber = pick(doc as Record<string, unknown>, 'contactNumber', 'phone', 'mobile', 'phoneNumber', 'contact', 'mobileNumber');
    const gender        = pick(doc as Record<string, unknown>, 'gender', 'Gender');
    const collegeName   = pick(doc as Record<string, unknown>, 'collegeName', 'college', 'institution', 'institutionName', 'College');
    const registerNo    = pick(doc as Record<string, unknown>, 'registerNumber', 'regNo', 'registrationNumber', 'rollNumber', 'rollNo', 'regno', 'registerNo');
    const department    = pick(doc as Record<string, unknown>, 'department', 'dept', 'branch', 'stream', 'Department');
    const year          = pick(doc as Record<string, unknown>, 'year', 'yearOfStudy', 'currentYear', 'Year');
    const city          = pick(doc as Record<string, unknown>, 'city', 'City', 'location', 'place');

    const subject = eventIsPass
      ? `🎟️ Your Event Pass is Confirmed — 6 March 2026 | ${APP_NAME}`
      : `🎉 You're In! ${displayName} — 5 March 2026 | ${APP_NAME}`;

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

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @media only screen and (max-width:480px) {
      .details-table td { display:block !important; width:100% !important; padding:8px 0 !important; box-sizing:border-box; }
      .details-table td:first-child { padding-right:0 !important; }
      .detail-row td { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:24px 0;background:#060a14;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:620px;margin:0 auto;background:#0a0e1a;border-radius:24px;overflow:hidden;color:#e2e8f0;box-shadow:0 30px 80px rgba(0,0,0,0.7)">

  <div style="height:5px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b)"></div>

  <div style="background:linear-gradient(135deg,#312e81 0%,#4c1d95 40%,#6d28d9 70%,#7c3aed 100%);padding:52px 36px 44px;text-align:center">
    <div style="font-size:52px;line-height:1;margin-bottom:16px">🎊</div>
    <h1 style="margin:0 0 10px;color:#fff;font-size:34px;font-weight:900;letter-spacing:-1px">You're Officially In!</h1>
    <p style="color:rgba(255,255,255,0.75);font-size:16px;margin:0 0 20px;line-height:1.5">Your registration has been <strong style="color:#a5f3fc">confirmed</strong> for</p>
    <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.25);border-radius:60px;padding:10px 28px;backdrop-filter:blur(10px)">
      <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:0.3px">${displayName}</span>
    </div>
  </div>

  <div style="padding:36px">

    <p style="font-size:17px;margin:0 0 6px;color:#e2e8f0">Hello, <strong style="color:#a78bfa;font-size:19px">${fullName}</strong> 👋</p>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 32px;line-height:1.7">We're absolutely delighted to welcome you! Get ready for an incredible experience. Here are your complete registration details — keep this email handy on your big day.</p>

    <div style="background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08));border:1.5px solid rgba(99,102,241,0.35);border-radius:18px;padding:26px;margin-bottom:26px">
      <h3 style="margin:0 0 20px;color:#a78bfa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">✦ Event Information</h3>
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
        <span style="font-size:20px">📅</span>
        <div>
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Event Date</div>
          <div style="font-size:15px;color:#e2e8f0;font-weight:700">Friday, 6 March 2026</div>
          <div style="font-size:12px;color:#f59e0b;margin-top:2px">⚠️ This pass is valid exclusively for 6 March 2026</div>
        </div>
      </div>
    </div>

    <div style="background:#111827;border:1.5px solid #1e293b;border-radius:18px;padding:26px;margin-bottom:26px">
      <h3 style="margin:0 0 20px;color:#60a5fa;font-size:13px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">✦ Your Registration Details</h3>
      <table class="details-table" style="width:100%;border-collapse:collapse">
        ${detailsHtml}
      </table>
    </div>

    <div style="background:linear-gradient(160deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%);border:2px solid #6366f1;border-radius:20px;padding:36px;text-align:center;margin-bottom:28px;box-shadow:0 0 60px rgba(99,102,241,0.2) inset">
      <h3 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:900;letter-spacing:-0.5px">🎫 Your Entry Pass QR</h3>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;line-height:1.6">This is your personalised entry pass. Keep it safe and show it at the entrance.</p>
      <div style="display:inline-block;background:#fff;padding:18px;border-radius:20px;box-shadow:0 0 50px rgba(99,102,241,0.5),0 20px 40px rgba(0,0,0,0.4)">
        <img src="cid:${qrCid}" alt="Entry QR Code" style="width:230px;height:230px;display:block;border-radius:8px"/>
      </div>
      <p style="color:#f1f5f9;font-size:16px;font-weight:700;margin:26px 0 10px;letter-spacing:0.2px">🚪 Present this QR at the entrance</p>
      <p style="color:#64748b;font-size:13px;margin:0;line-height:1.6">Your QR code is also attached as a PNG file — save it to your phone for easy check-in.</p>
    </div>

  </div>

  <div style="padding:22px 36px 28px;text-align:center;border-top:1px solid #1e293b">
    <p style="color:#475569;font-size:12px;margin:0 0 4px">${APP_NAME} · Automated notification</p>
    <p style="color:#334155;font-size:11px;margin:0">&copy; 2026 ${APP_NAME}. All rights reserved.</p>
  </div>

  <div style="height:5px;background:linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6,#6366f1)"></div>

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
