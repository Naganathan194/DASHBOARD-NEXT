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
    const agg = await col
      .aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
            pending: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'pending'] },
                      { $and: [{ $eq: [{ $type: '$status' }, 'missing'] }] },
                      { $eq: ['$status', null] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            checkedIn: { $sum: { $cond: [{ $eq: ['$checkedIn', true] }, 1, 0] } },
          },
        },
      ])
      .toArray();

    const stats = agg[0] ?? { total: 0, approved: 0, rejected: 0, checkedIn: 0, pending: 0 };
    const { total, approved, rejected, checkedIn, pending } = stats as Record<string, number>;
    return NextResponse.json({ total, approved, rejected, checkedIn, pending });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
