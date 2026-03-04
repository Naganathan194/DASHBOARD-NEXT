import { MongoClient, MongoClientOptions } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_MAX_POOL_SIZE = Number(process.env.MONGODB_MAX_POOL_SIZE || 15);
const MONGODB_MIN_POOL_SIZE = Number(process.env.MONGODB_MIN_POOL_SIZE || 0);

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable in .env.local');
}

const options: MongoClientOptions = {
  // Allow a bit more concurrency for parallel logins and dashboard requests.
  // Keep this configurable so deployments can tune based on cluster limits.
  maxPoolSize: Number.isFinite(MONGODB_MAX_POOL_SIZE) ? Math.max(5, MONGODB_MAX_POOL_SIZE) : 15,

  // Release idle connections quickly so they don't pile up across warm instances.
  minPoolSize: Number.isFinite(MONGODB_MIN_POOL_SIZE) ? Math.max(0, MONGODB_MIN_POOL_SIZE) : 0,
  maxConnecting: 5,
  waitQueueTimeoutMS: 15_000,
  maxIdleTimeMS: 10_000,

  // Give enough time for Atlas M0 cold-start (free tier can be slow).
  serverSelectionTimeoutMS: 30_000,
  connectTimeoutMS: 30_000,
  socketTimeoutMS: 45_000,

  // Retry once on transient network errors.
  retryWrites: true,
  retryReads: true,
};

// ---------------------------------------------------------------------------
// Global connection cache
// ---------------------------------------------------------------------------
// In a Vercel serverless environment every cold start imports this module
// fresh, but the Node.js runtime IS reused across invocations on the same
// instance (warm starts).  We store the promise on `globalThis` so that:
//   • Hot-module-reload in Next.js dev mode doesn't open a new connection on
//     every file save.
//   • Warm serverless invocations reuse the already-connected client instead
//     of opening a new one.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // In development, reuse the same promise across HMR reloads.
  if (!globalThis._mongoClientPromise) {
    globalThis._mongoClientPromise = new MongoClient(MONGODB_URI, options).connect();
  }
  clientPromise = globalThis._mongoClientPromise;
} else {
  // In production each module instance gets one promise; the runtime keeps it
  // alive for the lifetime of the warm function instance.
  clientPromise = new MongoClient(MONGODB_URI, options).connect();
}

/**
 * Returns a connected MongoClient, reusing the cached connection whenever
 * possible.  Do NOT call client.close() after using this – the connection
 * must stay open for the pool to be effective.
 */
export async function connectToMongo(): Promise<MongoClient> {
  return clientPromise;
}

// Export the raw promise so callers can also do:
//   import clientPromise from '@/lib/mongodb'
export default clientPromise;
