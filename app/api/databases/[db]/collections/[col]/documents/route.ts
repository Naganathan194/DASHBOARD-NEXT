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
    const result = await client.db(db).collection(col).insertOne({
      ...body,
      createdAt: new Date(),
      status: 'pending',
    });
    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
