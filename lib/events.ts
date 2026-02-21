/**
 * Maps raw MongoDB collection names → human-readable event display names.
 * DB collection names are never changed; only the presentation layer uses these.
 */
export const EVENT_DISPLAY_NAMES: Record<string, string> = {
  prompttoproductregistrations:   'Prompt to Product',
  portpassregistrations:          'Event Pass',
  hackproofingregistrations:      'Hackproofing the Future',
  learnhowtothinkregistrations:   'Learn How to Think, Not to Code',
  fullstackfusionregistrations:   'Full Stack Fusion',
};

/**
 * Returns the user-facing event name for a given collection name.
 * Falls back to a title-cased version of the raw name if no mapping exists.
 */
export function getEventDisplayName(colName: string): string {
  const key = colName.toLowerCase();
  if (EVENT_DISPLAY_NAMES[key]) return EVENT_DISPLAY_NAMES[key];
  // Fallback: split on camelCase / underscores / dashes and title-case
  return colName
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/** True when the collection is the "Event Pass" (6 March 2026 event). */
export function isEventPass(colName: string): boolean {
  return colName.toLowerCase() === 'portpassregistrations';
}
