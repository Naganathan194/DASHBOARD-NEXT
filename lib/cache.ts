/**
 * Cache helpers built on top of the @upstash/redis HTTP client in lib/redis.ts.
 *
 * @upstash/redis automatically serialises/deserialises JSON values, so there
 * is no manual JSON.parse / JSON.stringify needed here.  All operations
 * silently degrade when Redis is unavailable so the app keeps working using
 * MongoDB as the source of truth.
 *
 * Cache key schema
 * ─────────────────────────────────────────────────────────────────────
 *  dbs                              → list of databases               (TTL 5 min)
 *  cols:{db}:{role}:{assignedEvent} → collections for a user context  (TTL 5 min)
 *  docs:{db}:{col}                  → document list for a collection  (TTL 60 s)
 *  doc:{db}:{col}:{id}              → single document                 (TTL 60 s)
 *  stats:{db}:{col}                 → collection stats                (TTL 30 s)
 *  users:all                        → all users list                  (TTL 5 min)
 */
import redis from './redis';

// ---------------------------------------------------------------------------
// TTLs (seconds)
// ---------------------------------------------------------------------------
export const TTL = {
  DBS:    300,
  COLS:   300,
  DOCS:   180,
  DOC:    60,
  STATS:  60,
  USERS:  300,
} as const;

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------
export const CacheKey = {
  dbs:    ()                                          => 'dbs',
  cols:   (db: string, role: string, event: string)  => `cols:${db}:${role}:${event}`,
  docs:   (db: string, col: string)                  => `docs:${db}:${col}`,
  doc:    (db: string, col: string, id: string)      => `doc:${db}:${col}:${id}`,
  stats:  (db: string, col: string)                  => `stats:${db}:${col}`,
  users:  ()                                         => 'users:all',
  userByUsername: (username: string)                 => `users:username:${String(username || '').toLowerCase()}`,
};

// ---------------------------------------------------------------------------
// Core get / set helpers
// ---------------------------------------------------------------------------

/**
 * Read a cached value. Returns null on cache miss or Redis error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    // @upstash/redis auto-deserialises stored JSON – no manual JSON.parse needed
    const value = await redis.get<T>(key);
    if (value === null || value === undefined) return null;
    return value;
  } catch (err) {
    console.error(`[Cache] GET error for key "${key}":`, (err as Error).message);
    return null;
  }
}

/**
 * Write a value to cache with an optional TTL (seconds).
 * Silently ignores errors so writes never break the response path.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    // @upstash/redis auto-serialises the value; use { ex } for TTL
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.error(`[Cache] SET error for key "${key}":`, (err as Error).message);
  }
}

/**
 * Delete one or more exact keys.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (!redis) return;
  if (!keys.length) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.error('[Cache] DEL error:', (err as Error).message);
  }
}

/**
 * Delete all keys matching a glob pattern (e.g. "cols:mydb:*").
 * Uses SCAN so it doesn't block the Redis server.
 * Falls back silently on error.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  if (!redis) return;
  try {
    // @upstash/redis scan: pass cursor as number, returns cursor as string – coerce back
    let cursor = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(nextCursor);
      if (keys.length) {
        await redis.del(...keys);
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error(`[Cache] SCAN/DEL error for pattern "${pattern}":`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Domain-specific invalidation helpers (call after successful writes)
// ---------------------------------------------------------------------------

/** Invalidate everything related to a specific document (approve/reject/edit/delete). */
export async function invalidateDoc(db: string, col: string, id: string): Promise<void> {
  await cacheDel(
    CacheKey.doc(db, col, id),
    CacheKey.docs(db, col),
    CacheKey.stats(db, col),
  );
}

/** Invalidate the document list + stats for a collection (after insert). */
export async function invalidateCollection(db: string, col: string): Promise<void> {
  await cacheDel(
    CacheKey.docs(db, col),
    CacheKey.stats(db, col),
  );
}

/** Invalidate all collection-list cache entries for a database (after creating a new collection). */
export async function invalidateCollectionList(db: string): Promise<void> {
  await cacheDelPattern(`cols:${db}:*`);
}

/** Invalidate the users list (after create / update / delete user). */
export async function invalidateUsers(): Promise<void> {
  await cacheDel(CacheKey.users());
  await cacheDelPattern('users:username:*');
}
