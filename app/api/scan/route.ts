import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { ObjectId, Filter, Document } from 'mongodb';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(req: Request) {
  try {
    const { qrData } = await req.json();
    let payload: { id: string; token: string; collection: string; db: string };
    try { payload = JSON.parse(qrData); }
    catch { return NextResponse.json({ error: 'Invalid QR data' }, { status: 400 }); }

    const { id, token, collection, db } = payload;
    const client = await connectToMongo();
    const doc = await client.db(db).collection(collection).findOne(buildQuery(id));
    if (!doc) return NextResponse.json({ error: 'Attendee not found' }, { status: 404 });
    if (doc.qrToken !== token) return NextResponse.json({ error: 'Invalid QR code' }, { status: 400 });

    return NextResponse.json({ success: true, document: doc, db, collection });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
