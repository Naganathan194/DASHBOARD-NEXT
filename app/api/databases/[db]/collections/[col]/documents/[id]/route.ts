import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { ObjectId, Filter, Document } from 'mongodb';
import { authorize, ROLES, assertAssignedEvent } from '@/lib/auth';
import { cacheGet, cacheSet, invalidateDoc, CacheKey, TTL } from '@/lib/cache';
import { isAllowedCollection } from '@/lib/registrationCollections';

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
  if (!isAllowedCollection(col)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
  const assignedCheck = assertAssignedEvent(authCheck as Record<string, unknown>, col);
  if (assignedCheck instanceof NextResponse) return assignedCheck;

  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = CacheKey.doc(db, col, id);
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached !== null) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });

  try {
    const client = await connectToMongo();
    const doc = await client.db(db).collection(col).findOne(buildQuery(id));
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const serialised = JSON.parse(JSON.stringify(doc));
    await cacheSet(cacheKey, serialised, TTL.DOC);
    return NextResponse.json(serialised, { headers: { 'X-Cache': 'MISS' } });
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
  if (!isAllowedCollection(col)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
  try {
    const body = await req.json();
    const { _id, ...updateData } = body;
    void _id;
    const client = await connectToMongo();
    await client.db(db).collection(col).updateOne(
      buildQuery(id),
      { $set: { ...updateData, updatedAt: new Date() } }
    );
    // Invalidate doc, docs list, and stats
    await invalidateDoc(db, col, id);
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
  if (!isAllowedCollection(col)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
  try {
    const client = await connectToMongo();
    await client.db(db).collection(col).deleteOne(buildQuery(id));
    // Invalidate doc, docs list, and stats
    await invalidateDoc(db, col, id);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
