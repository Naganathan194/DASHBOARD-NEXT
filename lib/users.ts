import { connectToMongo } from './mongodb';
import bcrypt from 'bcryptjs';
import { promisify } from 'util';

const hashAsync = (s: string, rounds = 12) => new Promise<string>((res, rej) => bcrypt.hash(s, rounds, (err: Error | null, hash: string) => err ? rej(err) : res(hash)));
const compareAsync = (s: string, hash: string) => new Promise<boolean>((res, rej) => bcrypt.compare(s, hash, (err: Error | null, ok: boolean) => err ? rej(err) : res(ok)));
import { ROLES } from './auth';
import { ObjectId } from 'mongodb';

export type UserRecord = {
  _id?: unknown;
  username: string;
  passwordHash: string;
  role: string;
  assignedEvent?: string | null;
  createdAt?: Date;
  updatedAt?: Date | null;
};

const USERS_DB = process.env.USERS_DB || 'eventmanager_admin';
const USERS_COLLECTION = process.env.USERS_COLLECTION || 'users';

function sanitizeUserOut(u: any) {
  const { passwordHash, ...rest } = u;
  return rest;
}

export async function createUser(username: string, password: string, role: string, assignedEvent?: string | null) {
  if (!username || typeof username !== 'string') throw new Error('Invalid username');
  if (!password || typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters');
  const allowedRoles = Object.values(ROLES) as string[];
  if (!allowedRoles.includes(role)) throw new Error('Invalid role');

  const client = await connectToMongo();
  const col = client.db(USERS_DB).collection<UserRecord>(USERS_COLLECTION);
  const existing = await col.findOne({ username });
  if (existing) throw new Error('Username already exists');

  const passwordHash = await hashAsync(password, 12);
  const now = new Date();
  const res = await col.insertOne({ username, passwordHash, role, assignedEvent: assignedEvent ?? null, createdAt: now, updatedAt: null });
  const doc = await col.findOne({ _id: res.insertedId });
  return sanitizeUserOut(doc);
}

export async function getAllUsers() {
  const client = await connectToMongo();
  const col = client.db(USERS_DB).collection<UserRecord>(USERS_COLLECTION);
  const docs = await col.find({}).toArray();
  return docs.map(sanitizeUserOut);
}

export async function getUserByUsername(username: string) {
  const client = await connectToMongo();
  const col = client.db(USERS_DB).collection<UserRecord>(USERS_COLLECTION);
  const doc = await col.findOne({ username });
  return doc;
}

export async function updateUser(username: string, updates: Partial<{ password: string; role: string; newUsername: string; assignedEvent?: string | null }>) {
  const client = await connectToMongo();
  const col = client.db(USERS_DB).collection<UserRecord>(USERS_COLLECTION);
  const patch: any = { updatedAt: new Date() };
  // find current user by username to use its _id for uniqueness checks
  const current = await col.findOne({ username });
  if (!current) throw new Error('User not found');
  if (updates.password) {
    if (updates.password.length < 8) throw new Error('Password must be at least 8 characters');
    patch.passwordHash = await hashAsync(updates.password, 12);
  }
  if (updates.role) {
    const allowedRoles = Object.values(ROLES) as string[];
    if (!allowedRoles.includes(updates.role)) throw new Error('Invalid role');
    patch.role = updates.role;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'assignedEvent')) {
    patch.assignedEvent = updates.assignedEvent ?? null;
  }
  if (updates.newUsername) {
    const exists = await col.findOne({ username: updates.newUsername });
    // allow keeping the same username (belongs to the same user), otherwise reject
    if (exists && String((exists as any)._id) !== String((current as any)._id)) throw new Error('Username already exists');
    patch.username = updates.newUsername;
  }

  const res = await col.findOneAndUpdate({ username }, { $set: patch }, { returnDocument: 'after' as any });
  if (!res || !('value' in res) || !res.value) throw new Error('User not found');
  return sanitizeUserOut(res.value);
}

export async function updateUserById(id: string, updates: Partial<{ password: string; role: string; newUsername: string; assignedEvent?: string | null }>) {
  const client = await connectToMongo();
  const col = client.db(USERS_DB).collection<UserRecord>(USERS_COLLECTION);
  const patch: any = { updatedAt: new Date() };
  let oid: any = id;
  try { oid = new ObjectId(id); } catch { /* keep as-is for non ObjectId ids */ }
  let current = await col.findOne({ _id: oid });
  // Fallbacks: sometimes id may actually be a username string, or stored as plain string _id
  if (!current) {
    // try treating id as username
    current = await col.findOne({ username: id });
  }
  if (!current) {
    // try as raw _id string match (non-ObjectId storage)
    current = await col.findOne({ _id: id as any });
  }
  if (!current) throw new Error('User not found');
  if (updates.password) {
    if (updates.password.length < 8) throw new Error('Password must be at least 8 characters');
    patch.passwordHash = await hashAsync(updates.password, 12);
  }
  if (updates.role) {
    const allowedRoles = Object.values(ROLES) as string[];
    if (!allowedRoles.includes(updates.role)) throw new Error('Invalid role');
    patch.role = updates.role;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'assignedEvent')) {
    // normalize empty string to null
    const ae = (updates.assignedEvent as any);
    patch.assignedEvent = (ae === '' ? null : (ae ?? null));
  }
  if (updates.newUsername) {
    const exists = await col.findOne({ username: updates.newUsername });
    if (exists && String((exists as any)._id) !== String((current as any)._id)) throw new Error('Username already exists');
    patch.username = updates.newUsername;
  }

  // Prefer updating by the resolved concrete _id of the found document to avoid
  // cases where an 'id' string was actually a username or non-ObjectId value.
  const filterCandidates: any[] = [];
  if ((current as any)._id !== undefined) filterCandidates.push({ _id: (current as any)._id });
  // if we were able to parse an ObjectId, include it as a candidate
  if (oid && oid !== id) filterCandidates.push({ _id: oid });
  // finally, fallback to username (should be avoided but kept for compatibility)
  filterCandidates.push({ username: id });

  // Try filters in order until one matches; use updateOne so we can check matchedCount
  let updatedDoc: any = null;
  for (const f of filterCandidates) {
    try {
      const r = await col.updateOne(f, { $set: patch });
      if (r && (r as any).matchedCount > 0) {
        updatedDoc = await col.findOne(f);
        break;
      }
    } catch (err) {
      // ignore and try next filter
    }
  }

  if (!updatedDoc) throw new Error('User not found');
  return sanitizeUserOut(updatedDoc);
}

export async function deleteUser(username: string) {
  const client = await connectToMongo();
  const col = client.db(USERS_DB).collection<UserRecord>(USERS_COLLECTION);
  await col.deleteOne({ username });
  return { success: true };
}

export async function validateUserCredentials(username: string, password: string) {
  const u = await getUserByUsername(username);
  if (!u) return false;
  const ok = await compareAsync(password, u.passwordHash);
  return ok ? u : false;
}
