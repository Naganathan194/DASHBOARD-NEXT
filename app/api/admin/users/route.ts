import { NextResponse } from 'next/server';
import { authorize, ROLES } from '@/lib/auth';
import { createUser, getAllUsers, updateUser, updateUserById, deleteUser } from '@/lib/users';

export async function GET(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const users = await getAllUsers();
    // ensure _id is serialized as string for clients
    const safe = (users || []).map((u: any) => ({ ...u, _id: u._id ? String(u._id) : undefined }));
    return NextResponse.json(safe);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const body = await req.json();
    const { username, password, role, assignedEvent } = body || {};
    if (!username || !password || !role) return NextResponse.json({ error: 'username, password and role required' }, { status: 400 });
    const created = await createUser(String(username), String(password), String(role), assignedEvent ? String(assignedEvent) : undefined);
    return NextResponse.json({ success: true, user: created });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const body = await req.json();
    const { id, username, password, role, newUsername, assignedEvent } = body || {};
    if (!id && !username) return NextResponse.json({ error: 'id or username required' }, { status: 400 });
    let updated;
    if (id) {
      updated = await updateUserById(String(id), { password: password ? String(password) : undefined, role: role ? String(role) : undefined, newUsername: newUsername ? String(newUsername) : undefined, assignedEvent: assignedEvent ? String(assignedEvent) : undefined });
    } else {
      updated = await updateUser(String(username), { password: password ? String(password) : undefined, role: role ? String(role) : undefined, newUsername: newUsername ? String(newUsername) : undefined, assignedEvent: assignedEvent ? String(assignedEvent) : undefined });
    }
    return NextResponse.json({ success: true, message: 'User updated successfully', user: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const authCheck = await authorize(req, [ROLES.ADMIN]);
  if (authCheck instanceof NextResponse) return authCheck;
  try {
    const { username } = await req.json();
    if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
    const res = await deleteUser(String(username));
    return NextResponse.json(res);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
