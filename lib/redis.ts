/**
 * Redis client for Upstash using the official @upstash/redis HTTP SDK.
 *
 * Unlike ioredis (which uses persistent TCP), @upstash/redis makes stateless
 * HTTP requests to Upstash's REST API. This is the correct approach for
 * serverless / Next.js environments where TCP connections are dropped between
 * invocations, causing timeouts.
 *
 * Parses the standard `rediss://user:TOKEN@HOST:PORT` URL that is stored in
 * REDIS_URL and converts it to the REST URL + token format required by the SDK.
 */
import { Redis } from '@upstash/redis';

const REDIS_URL = process.env.REDIS_URL;

function createClient(): Redis | null {
  if (!REDIS_URL) {
    console.warn('[Redis] REDIS_URL is not set – running in DB-only mode.');
    return null;
  }
  try {
    // Parse  rediss://user:TOKEN@HOST:PORT  ➜  https://HOST  +  TOKEN
    const m = REDIS_URL.match(/^rediss?:\/\/[^:]*:([^@]+)@([^:/]+)/);
    if (!m) throw new Error('Unrecognised REDIS_URL format (expected rediss://user:token@host:port)');
    const [, token, host] = m;
    return new Redis({ url: `https://${host}`, token });
  } catch (err) {
    console.error('[Redis] init error – running in DB-only mode:', (err as Error).message);
    return null;
  }
}

// Module-level singleton: @upstash/redis is stateless (HTTP) so there is no
// persistent connection to manage, but keeping one instance avoids re-parsing
// the URL on every request.
export const redisClient: Redis | null = createClient();
export default redisClient;
