import { NextResponse } from "next/server";
import { connectToMongo } from "@/lib/mongodb";
import { isAllowedCollection } from "@/lib/registrationCollections";
import { authorize, ROLES, assertAssignedEvent } from "@/lib/auth";
import { formatDateTime } from "@/lib/dateFormat";
import { cacheGet, cacheSet, invalidateCollection, CacheKey, TTL } from "@/lib/cache";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string }> },
) {
  const authCheck = await authorize(_req, [ROLES.ADMIN, ROLES.ATTENDEE_VIEWER]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db, col } = await params;
  if (!isAllowedCollection(col))
    return NextResponse.json(
      { error: "Collection not allowed" },
      { status: 404 },
    );
  const assignedCheck = assertAssignedEvent(
    authCheck as Record<string, unknown>,
    col,
  );
  if (assignedCheck instanceof NextResponse) return assignedCheck;

  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = CacheKey.docs(db, col);
  const cached = await cacheGet<unknown[]>(cacheKey);
  if (cached !== null) {
    console.info(`[CACHE] HIT docs db=${db} col=${col}`);
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
  }

  try {
    const client = await connectToMongo();
    const listProjection = {
      _id: 1,
      status: 1,
      checkedIn: 1,
      checkInTime: 1,
      rejectionReason: 1,
      createdAt: 1,
      registeredAt: 1,
      registrationId: 1,
      regId: 1,
      registerNumber: 1,
      firstName: 1,
      lastName: 1,
      fname: 1,
      lname: 1,
      fullName: 1,
      name: 1,
      candidateName: 1,
      studentName: 1,
      email: 1,
      mail: 1,
      Email: 1,
      transactionId: 1,
      transaction_id: 1,
      utr: 1,
      upiTransactionId: 1,
      paymentId: 1,
      payment_id: 1,
      txnId: 1,
      txn_id: 1,
      referenceId: 1,
    } as const;
    const docs = await client
      .db(db)
      .collection(col)
      .find({}, { projection: listProjection })
      .toArray();

    // Serialize MongoDB ObjectId fields to strings before caching
    const serialised = JSON.parse(JSON.stringify(docs));
    await cacheSet(cacheKey, serialised, TTL.DOCS);
    console.info(`[CACHE] MISS docs db=${db} col=${col} count=${serialised.length}`);
    return NextResponse.json(serialised, { headers: { 'X-Cache': 'MISS' } });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string }> },
) {
  const authCheck = await authorize(req, [ROLES.ADMIN, ROLES.REGISTRAR]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db, col } = await params;
  if (!isAllowedCollection(col))
    return NextResponse.json(
      { error: "Collection not allowed" },
      { status: 404 },
    );
  const assignedCheck = assertAssignedEvent(authCheck as Record<string, unknown>, col);
  if (assignedCheck instanceof NextResponse) return assignedCheck;
  try {
    const body = await req.json();
    const client = await connectToMongo();

    // Human-readable registration timestamp
    const now = new Date();
    const registeredAt = formatDateTime(now); // e.g. "21:02:2026 03:45 PM"

    const result = await client
      .db(db)
      .collection(col)
      .insertOne({
        ...body,
        registeredAt, // DD:MM:YYYY HH:MM AM/PM
        createdAt: now, // raw Date kept for internal sorting / queries
        status: "pending",
      });

    // Invalidate docs list + stats after insert
    await invalidateCollection(db, col);
    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
