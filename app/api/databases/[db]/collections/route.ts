import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { ALLOWED_COLLECTIONS_SET, isAllowedCollection } from '@/lib/registrationCollections';
import { authorize, ROLES } from '@/lib/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ db: string }> }) {
  const authCheck = await authorize(_req, [ROLES.ADMIN, ROLES.ATTENDEE_VIEWER]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db } = await params;
  try {
    const client = await connectToMongo();
    const cols = await client.db(db).listCollections().toArray();
    // Only return allowed collections
    let names: string[] = cols.map((c: { name: string }) => c.name)
      .filter((n) => ALLOWED_COLLECTIONS_SET.has(String(n).toLowerCase()));
    // If non-admin, restrict to assignedEvent ('*' = all events)
    const role = String((authCheck as Record<string, unknown>).role || '');
    if (role === ROLES.ATTENDEE_VIEWER) {
      const assigned = String((authCheck as Record<string, unknown>).assignedEvent || '');
      if (assigned === '*') {
        // all-events access – return every allowed collection as-is
      } else if (assigned) {
        names = names.filter((n) => String(n).toLowerCase() === assigned.toLowerCase());
      } else {
        names = [];
      }
    }
    return NextResponse.json(names);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ db: string }> }) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db } = await params;
  try {
    const { name } = await req.json();
    if (!isAllowedCollection(name)) {
      return NextResponse.json({ error: 'Collection not allowed' }, { status: 404 });
    }
    const client = await connectToMongo();
    await client.db(db).createCollection(name);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
