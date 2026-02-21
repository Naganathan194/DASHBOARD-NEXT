/**
 * Maps raw MongoDB collection names → human-readable event display names.
 * DB collection names are never changed; only the presentation layer uses these.
 */
import { getDisplayName, isAllowedCollection } from './registrationCollections';

/**
 * Compatibility layer: re-export the existing helper names so other modules
 * can continue importing from `lib/events` while the canonical mapping lives
 * in `lib/registrationCollections.ts`.
 */
export function getEventDisplayName(colName: string): string {
  return getDisplayName(colName);
}

export function isEventPass(colName: string): boolean {
  if (!colName) return false;
  return colName.toLowerCase() === 'portpassregistrations';
}

export { isAllowedCollection };
