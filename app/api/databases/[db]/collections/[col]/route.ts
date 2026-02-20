import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string }> }
) {
  const { db, col } = await params;
  try {
    const client = await connectToMongo();
    await client.db(db).collection(col).drop();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
