import { NextResponse } from 'next/server';
import { connectToMongo } from '@/lib/mongodb';
import { authorize, ROLES } from '@/lib/auth';

export async function GET(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const client = await connectToMongo();
    const dbs = await client.db().admin().listDatabases();
    const names = dbs.databases
      .map((d: { name: string }) => d.name)
      .filter((n: string) => !['admin', 'local', 'config'].includes(n));
    return NextResponse.json(names);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
