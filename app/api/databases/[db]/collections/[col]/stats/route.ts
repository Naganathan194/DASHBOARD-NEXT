import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { isAllowedCollection } from '@/lib/registrationCollections';
import { authorize, ROLES, assertAssignedEvent } from '@/lib/auth';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ db: string; col: string }> }
) {
  const authCheck = await authorize(_req, [ROLES.ADMIN, ROLES.ATTENDEE_VIEWER]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db, col: colName } = await params;
  if (!isAllowedCollection(colName)) return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
  const assignedCheck = assertAssignedEvent(authCheck as Record<string, unknown>, colName);
  if (assignedCheck instanceof NextResponse) return assignedCheck;
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
