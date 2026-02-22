import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES, assertAssignedEvent } from '@/lib/auth';

function buildQuery(id: string): Filter<Document> {
  try { return { _id: new ObjectId(id) }; } catch { return { _id: id } as unknown as Filter<Document>; }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const authCheck = await authorize(_req, [ROLES.ADMIN, ROLES.ATTENDEE_VIEWER]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db, col, id } = await params;
  const assignedCheck = assertAssignedEvent(authCheck as Record<string, unknown>, col);
  if (assignedCheck instanceof NextResponse) return assignedCheck;
  try {
    const client = await connectToMongo();
    const doc = await client.db(db).collection(col).findOne(buildQuery(id));
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(doc);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db, col, id } = await params;
  try {
    const body = await req.json();
    const { _id, ...updateData } = body;
    void _id;
    const client = await connectToMongo();
    await client.db(db).collection(col).updateOne(
      buildQuery(id),
      { $set: { ...updateData, updatedAt: new Date() } }
    );
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string; id: string }> }
) {
  // DELETE should be admin only
  const authCheck = await authorize(_req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db, col, id } = await params;
  try {
    const client = await connectToMongo();
    await client.db(db).collection(col).deleteOne(buildQuery(id));
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
