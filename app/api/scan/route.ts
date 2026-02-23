import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES, assertAssignedEvent } from '@/lib/auth';
import { getDisplayName } from '@/lib/registrationCollections';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function POST(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN, ROLES.SCANNER]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const { qrData } = await req.json();
    let payload: { id: string; token: string; collection: string; db: string };
    try { payload = JSON.parse(qrData); }
    catch { return NextResponse.json({ error: 'Invalid QR data' }, { status: 400 }); }

    const { id, token, collection, db } = payload;
    const assignedCheck = assertAssignedEvent(authCheck as Record<string, unknown>, collection);
    if (assignedCheck instanceof NextResponse) return assignedCheck;
    if (!isAllowedCollection(collection)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
    const client = await connectToMongo();
    const doc = await client.db(db).collection(collection).findOne(buildQuery(id));
    if (!doc) return NextResponse.json({ error: 'Attendee not found' }, { status: 404 });
    if (doc.qrToken !== token) return NextResponse.json({ error: 'Invalid QR code' }, { status: 400 });

    // Human-readable event name for client display
    const eventName = getDisplayName(collection);

    // If requester is a scanner, redact sensitive fields
    const role = String((authCheck as Record<string, unknown>).role || '');
    if (role === ROLES.SCANNER) {
      const name = String(doc.fullName ?? doc.name ?? `${doc.firstName ?? ''} ${doc.lastName ?? ''}`).trim() || 'Attendee';
      const redacted = {
        _id: doc._id,
        name,
        status: doc.status ?? null,
        checkedIn: !!doc.checkedIn,
        checkInTime: doc.checkInTime ?? null,
      };
      return NextResponse.json({ success: true, document: redacted, db, collection, eventName });
    }

    // Admins receive full document
    return NextResponse.json({ success: true, document: doc, db, collection, eventName });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
