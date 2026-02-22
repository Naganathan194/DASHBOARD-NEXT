import { NextResponse } from "next/server";
import { connectToMongo } from "@/lib/mongodb";
import { isAllowedCollection } from "@/lib/registrationCollections";
import { authorize, ROLES, assertAssignedEvent } from "@/lib/auth";
import { formatDateTime } from "@/lib/dateFormat";

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
  try {
    const client = await connectToMongo();
    const docs = await client
      .db(db)
      .collection(col)
      .find({})
      .limit(500)
      .toArray();
    return NextResponse.json(docs);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string }> },
) {
  const { db, col } = await params;
  if (!isAllowedCollection(col))
    return NextResponse.json(
      { error: "Collection not allowed" },
      { status: 404 },
    );
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
    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
