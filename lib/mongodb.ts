import { MongoClient, MongoClientOptions } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable in .env.local');
}

const options: MongoClientOptions = {
  // Keep the pool small for serverless (Vercel spins up many function instances).
  // M0 free tier allows ~500 total connections; each Vercel function instance will
  // hold at most maxPoolSize connections, so keep this low.
  maxPoolSize: 5,

  // Release idle connections quickly so they don't pile up across warm instances.
  minPoolSize: 0,
  maxIdleTimeMS: 10_000,

  // Fail fast rather than queue requests indefinitely.
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
  socketTimeoutMS: 20_000,

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
