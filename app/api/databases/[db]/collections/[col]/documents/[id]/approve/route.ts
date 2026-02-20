import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { sendMail, APP_NAME } from '@/lib/mail';
import { ObjectId, Filter, Document } from 'mongodb';
import QRCode from 'qrcode';
import crypto from 'crypto';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const params_ = await params;
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
      width: 300,
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

    const email = doc.email || doc.mail || doc.Email;
    const name  = doc.firstName || doc.fullName || doc.name || doc.candidateName || 'Attendee';
    const event = doc.eventName || doc.event || params_.col;

    if (email) {
      const qrCid = `qrcode_${params_.id}@eventmanager`;
      const html = `
      <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:auto;background:#0f172a;border-radius:16px;overflow:hidden;color:#e2e8f0">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:40px 32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700">🎉 You're In!</h1>
          <p style="color:#c7d2fe;margin:8px 0 0">Seat Confirmed</p>
        </div>
        <div style="padding:32px">
          <p style="font-size:16px">Hi <strong>${name}</strong>,</p>
          <p>Your registration for <strong style="color:#818cf8">${event}</strong> has been <span style="color:#4ade80;font-weight:700">approved</span>! 🎊</p>
          <div style="background:#1e293b;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
            <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;text-transform:uppercase;letter-spacing:1px">Your Entry QR Code</p>
            <img src="cid:${qrCid}" alt="QR Code" style="width:200px;height:200px;border-radius:8px;border:4px solid #6366f1"/>
            <p style="color:#64748b;font-size:12px;margin:12px 0 0">Present this QR at the entrance</p>
          </div>
          <p style="color:#94a3b8;font-size:14px">Your QR code is also attached as a PNG file — save it to your phone for easy check-in.</p>
          <div style="border-top:1px solid #334155;margin-top:24px;padding-top:16px;text-align:center;color:#64748b;font-size:12px">
            <p>${APP_NAME} · Automated notification</p>
          </div>
        </div>
      </div>`;

      await sendMail(
        email,
        `✅ Approved! Your seat for ${event} is confirmed`,
        html,
        [{ filename: `entry_qr_${String(name).replace(/\s+/g, '_')}.png`, content: qrBuffer, contentType: 'image/png', cid: qrCid }]
      );
    }

    return NextResponse.json({ success: true, qrCode: qrDataUrl });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
