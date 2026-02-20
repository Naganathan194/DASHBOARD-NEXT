import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { ObjectId, Filter, Document } from 'mongodb';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(req: Request) {
  try {
    const { id, db, collection } = await req.json();
    const client = await connectToMongo();
    const query = buildQuery(id);
    const doc = await client.db(db).collection(collection).findOne(query);
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (doc.checkedIn) return NextResponse.json({ error: 'Already checked in', doc }, { status: 400 });

    const checkInTime = new Date();
    await client.db(db).collection(collection).updateOne(query, {
      $set: { checkedIn: true, checkInTime },
    });

    return NextResponse.json({ success: true, checkInTime });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
