import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string }> }
) {
  const { db, col: colName } = await params;
  try {
    const client = await connectToMongo();
    const col = client.db(db).collection(colName);
    const [total, approved, rejected, checkedIn, pending] = await Promise.all([
      col.countDocuments(),
      col.countDocuments({ status: 'approved' }),
      col.countDocuments({ status: 'rejected' }),
      col.countDocuments({ checkedIn: true }),
      col.countDocuments({ status: 'pending' }),
    ]);
    return NextResponse.json({ total, approved, rejected, checkedIn, pending });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
