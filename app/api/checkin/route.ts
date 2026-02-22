import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES, assertAssignedEvent } from '@/lib/auth';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN, ROLES.SCANNER]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const { id, db, collection, token } = await req.json();
    const assignedCheck = assertAssignedEvent(authCheck as Record<string, unknown>, collection);
    if (assignedCheck instanceof NextResponse) return assignedCheck;
    if (!isAllowedCollection(collection)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
    const client = await connectToMongo();
    const query = buildQuery(id);
    const doc = await client.db(db).collection(collection).findOne(query);
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Require QR token to be presented for check-in (prevents unauthorized calls)
    if (!token || String(doc.qrToken || '') !== String(token)) return NextResponse.json({ error: 'Invalid or missing token' }, { status: 400 });
    if (doc.checkedIn) return NextResponse.json({ error: 'Already checked in' }, { status: 400 });

    const checkInTime = new Date();
    await client.db(db).collection(collection).updateOne(query, {
      $set: { checkedIn: true, checkInTime },
    });

    return NextResponse.json({ success: true, message: 'Checked in successfully', checkInTime });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
