/**
 * Centralised registration collections config.
 * - `ALLOWED_COLLECTIONS` lists DB collection names that are allowed in the app.
 * - `DISPLAY_NAME_MAP` maps the DB collection name -> user-facing display name.
 */
export const ALLOWED_COLLECTIONS = [
  'hackproofingregistrations',
  'prompttoproductregistrations',
  'fullstackfusionregistrations',
  'learnhowtothinkregistrations',
  'portpassregistrations',
] as const;

export const DISPLAY_NAME_MAP: Record<string, string> = {
  hackproofingregistrations:      'Hackproofing',
  prompttoproductregistrations:   'Prompt To Product',
  fullstackfusionregistrations:   'Full Stack Fusion',
  learnhowtothinkregistrations:   'Learn How To Think',
  portpassregistrations:          'Port Pass',
};

export function isAllowedCollection(colName: string): boolean {
  if (!colName) return false;
  return ALLOWED_COLLECTIONS.includes(colName.toLowerCase() as any);
}

export function getDisplayName(colName: string): string {
  if (!colName) return '';
  const key = colName.toLowerCase();
  if (DISPLAY_NAME_MAP[key]) return DISPLAY_NAME_MAP[key];
  // Fallback: title-case the raw name with spaces inserted before capitals/underscores/dashes
  return colName
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export const ALLOWED_COLLECTIONS_SET = new Set(ALLOWED_COLLECTIONS.map((c) => c.toLowerCase()));
