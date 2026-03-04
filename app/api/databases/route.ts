import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { authorize, ROLES } from '@/lib/auth';
import { cacheGet, cacheSet, CacheKey, TTL } from '@/lib/cache';

export async function GET(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = CacheKey.dbs();
    const cached = await cacheGet<string[]>(cacheKey);
    if (cached !== null) return NextResponse.json(cached);

    // ── Fetch from MongoDB ───────────────────────────────────────────────────
    const client = await connectToMongo();
    const dbs = await client.db().admin().listDatabases();
    const names = dbs.databases
      .map((d: { name: string }) => d.name)
      .filter((n: string) => !['admin', 'local', 'config'].includes(n));

    await cacheSet(cacheKey, names, TTL.DBS);
    return NextResponse.json(names);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
