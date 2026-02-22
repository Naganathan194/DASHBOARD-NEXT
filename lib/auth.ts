import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const ROLES = {
  ADMIN: 'ADMIN',
  ATTENDEE_VIEWER: 'ATTENDEE_VIEWER',
  SCANNER: 'SCANNER',
} as const;

type Role = (typeof ROLES)[keyof typeof ROLES];

const SECRET = process.env.JWT_SECRET || process.env.APP_NAME || 'eventmanager-secret';

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hmac(data: string) {
  return crypto.createHmac('sha256', SECRET).update(data).digest();
}

export function signToken(payload: Record<string, unknown>, expiresInSeconds = 60 * 60) {
  const exp = Date.now() + expiresInSeconds * 1000;
  const p = { ...payload, exp };
  const json = JSON.stringify(p);
  const sig = hmac(json);
  return `${base64Url(json)}.${base64Url(sig)}`;
}

export function verifyToken(token: string) {
  try {
    const [b64payload, b64sig] = token.split('.');
    if (!b64payload || !b64sig) return null;
    const payloadJson = Buffer.from(b64payload, 'base64').toString('utf8');
    const expectedSig = base64Url(hmac(payloadJson));
    if (expectedSig !== b64sig) return null;
    const payload = JSON.parse(payloadJson) as any;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getAuthFromRequest(req: Request) {
  try {
    const auth = req.headers.get('authorization') || '';
    if (!auth) return null;

    if (auth.toLowerCase().startsWith('basic ')) {
      const b = auth.slice(6);
      const decoded = Buffer.from(b, 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user && pass && process.env.ADMIN_USER && process.env.ADMIN_PASS && user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
        return { role: ROLES.ADMIN, user } as Record<string, unknown>;
      }
      return null;
    }

    if (auth.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim();
      const payload = verifyToken(token);
      if (!payload) return null;
      // ensure role exists
      if (!payload.role) return null;
      return payload;
    }

    return null;
  } catch {
    return null;
  }
}

/** Enforce that for non-admin roles, requested collection matches assignedEvent on token */
export function assertAssignedEvent(payload: Record<string, unknown>, collection: string) {
  try {
    const role = String(payload.role || '');
    if (role === ROLES.ADMIN) return null;
    // only enforce for viewer and scanner
    if (role === ROLES.ATTENDEE_VIEWER || role === ROLES.SCANNER) {
      const assigned = String(payload.assignedEvent ?? '');
      if (!assigned) return NextResponse.json({ error: 'No event assigned' }, { status: 403 });
      if (assigned.toLowerCase() !== String(collection || '').toLowerCase()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

export async function authorize(req: Request, allowedRoles: string[]) {
  const payload = await getAuthFromRequest(req);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = String(payload.role || '');
  if (!allowedRoles.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return payload as Record<string, unknown>;
}
