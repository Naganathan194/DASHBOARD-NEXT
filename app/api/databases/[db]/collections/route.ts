import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { ALLOWED_COLLECTIONS_SET, isAllowedCollection } from '@/lib/registrationCollections';
import { authorize, ROLES } from '@/lib/auth';
import { cacheGet, cacheSet, invalidateCollectionList, CacheKey, TTL } from '@/lib/cache';

export async function GET(_req: Request, { params }: { params: Promise<{ db: string }> }) {
  const authCheck = await authorize(_req, [ROLES.ADMIN, ROLES.ATTENDEE_VIEWER]);
  if (authCheck instanceof NextResponse) return authCheck;
  const { db } = await params;
  const role = String((authCheck as Record<string, unknown>).role || '');
  const assignedEvent = String((authCheck as Record<string, unknown>).assignedEvent || '');

  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = CacheKey.cols(db, role, assignedEvent);
  const cached = await cacheGet<string[]>(cacheKey);
  if (cached !== null) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });

  try {
    const client = await connectToMongo();
    const cols = await client.db(db).listCollections().toArray();
    // Only return allowed collections
    let names: string[] = cols.map((c: { name: string }) => c.name)
      .filter((n) => ALLOWED_COLLECTIONS_SET.has(String(n).toLowerCase()));
    // If non-admin, restrict to assignedEvent ('*' = all events)
    if (role === ROLES.ATTENDEE_VIEWER) {
      if (assignedEvent === '*') {
        // all-events access – return every allowed collection as-is
      } else if (assignedEvent) {
        names = names.filter((n) => String(n).toLowerCase() === assignedEvent.toLowerCase());
      } else {
        names = [];
      }
    }

    await cacheSet(cacheKey, names, TTL.COLS);
    return NextResponse.json(names, { headers: { 'X-Cache': 'MISS' } });
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
    // Invalidate all cached collection lists for this db
    await invalidateCollectionList(db);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
