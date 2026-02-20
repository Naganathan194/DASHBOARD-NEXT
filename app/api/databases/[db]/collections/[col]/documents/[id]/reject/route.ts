import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { ObjectId, Filter, Document } from 'mongodb';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const { db, col, id } = await params;
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

    const email = doc.email || doc.mail || doc.Email;
    const name  = doc.firstName || doc.fullName || doc.name || doc.candidateName || 'Attendee';
    const event = doc.eventName || doc.event || col;

    if (email) {
      const html = `
      <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:auto;background:#0f172a;border-radius:16px;overflow:hidden;color:#e2e8f0">
        <div style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:40px 32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700">Registration Update</h1>
        </div>
        <div style="padding:32px">
          <p style="font-size:16px">Hi <strong>${name}</strong>,</p>
          <p>We regret to inform you that your registration for <strong style="color:#f87171">${event}</strong> has not been approved.</p>
          <div style="background:#1e293b;border-radius:12px;padding:24px;margin:24px 0;border-left:4px solid #ef4444">
            <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px">Reason</p>
            <p style="margin:0;color:#fca5a5;font-size:15px">${reason}</p>
          </div>
          <p style="color:#94a3b8;font-size:14px">If you have any questions, please contact the event organizer.</p>
          <div style="border-top:1px solid #334155;margin-top:24px;padding-top:16px;text-align:center;color:#64748b;font-size:12px">
            <p>${APP_NAME} · Automated notification</p>
          </div>
        </div>
      </div>`;
      await sendMail(email, `Registration Update for ${event}`, html);
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
