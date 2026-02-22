import { NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import { validateUserCredentials } from '@/lib/users';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) return NextResponse.json({ error: 'username and password required' }, { status: 400 });

    // Admin via env
    if (process.env.ADMIN_USER && process.env.ADMIN_PASS && username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
      const payload = { username: process.env.ADMIN_USER, role: 'ADMIN' };
      const token = signToken(payload, 60 * 60 * 24); // 1 day
      return NextResponse.json({ token, user: payload });
    }

    // Non-admin users: check users collection
    const u = await validateUserCredentials(username, password);
    if (!u) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    const payload: Record<string, unknown> = { username: u.username, role: u.role };
    if (u.assignedEvent) payload.assignedEvent = u.assignedEvent;
    const token = signToken(payload, 60 * 60 * 24);
    return NextResponse.json({ token, user: payload });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
