import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { getEventDisplayName } from '@/lib/events';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const { db, col, id } = await params;
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
    const lastName  = String(d.lastName  ?? d.last_name  ?? d.lname  ?? '');
    const name = firstName && lastName
      ? `${firstName} ${lastName}`.trim()
      : String(d.fullName ?? d.name ?? d.candidateName ?? 'Attendee');

    const displayName = getEventDisplayName(col);

    if (email) {
      const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 0;background:#060a14;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#0a0e1a;border-radius:20px;overflow:hidden;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.6)">
  <div style="height:4px;background:linear-gradient(90deg,#ef4444,#dc2626,#b91c1c)"></div>
  <div style="background:linear-gradient(135deg,#450a0a,#7f1d1d);padding:44px 32px;text-align:center">
    <div style="font-size:44px;margin-bottom:12px">📋</div>
    <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800">Registration Update</h1>
    <p style="color:rgba(255,255,255,0.65);font-size:14px;margin:10px 0 0">${displayName}</p>
  </div>
  <div style="padding:32px">
    <p style="font-size:16px;margin:0 0 6px">Hi <strong style="color:#fca5a5">${name}</strong>,</p>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 24px">
      Thank you for your interest in <strong style="color:#f87171">${displayName}</strong>.
      After careful review, we regret to inform you that your registration could not be approved at this time.
    </p>
    <div style="background:#1c0f0f;border:1px solid rgba(239,68,68,0.3);border-left:4px solid #ef4444;border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0 0 6px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px">Reason for rejection</p>
      <p style="margin:0;color:#fca5a5;font-size:15px;line-height:1.6">${reason}</p>
    </div>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0">
      If you believe this decision was made in error or have any questions, please reach out to the event organizer directly.
      We hope to see you at future events!
    </p>
  </div>
  <div style="padding:20px 32px 26px;text-align:center;border-top:1px solid #1e293b">
    <p style="color:#475569;font-size:12px;margin:0">${APP_NAME} Port &middot; Automated notification</p>
  </div>
  <div style="height:4px;background:linear-gradient(90deg,#b91c1c,#dc2626,#ef4444)"></div>
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
