import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';

export async function GET(_req: Request, { params }: { params: Promise<{ db: string }> }) {
  const { db } = await params;
  try {
    const client = await connectToMongo();
    const cols = await client.db(db).listCollections().toArray();
    return NextResponse.json(cols.map((c: { name: string }) => c.name));
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ db: string }> }) {
  const { db } = await params;
  try {
    const { name } = await req.json();
    const client = await connectToMongo();
    await client.db(db).createCollection(name);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
