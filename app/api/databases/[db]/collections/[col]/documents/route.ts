import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string }> }
) {
  const { db, col } = await params;
  try {
    const client = await connectToMongo();
    const docs = await client.db(db).collection(col).find({}).limit(500).toArray();
    return NextResponse.json(docs);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ db: string; col: string }> }
) {
  const { db, col } = await params;
  try {
    const body = await req.json();
    const client = await connectToMongo();

    // Human-readable registration timestamp (IST)
    const now = new Date();
    const registeredAt = now.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }) + ' IST';

    const result = await client.db(db).collection(col).insertOne({
      ...body,
      registeredAt,          // e.g. "21 February 2026, 03:45:10 pm IST"
      createdAt: now,        // raw Date kept for internal sorting / queries
      status: 'pending',
    });
    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
