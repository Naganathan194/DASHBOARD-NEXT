/**
 * Centralized date/time formatting utility.
 *
 * Format: DD:MM:YYYY HH:MM AM/PM
 * Example: 21:02:2026 03:45 PM
 *
 * Uses manual formatting (no toLocaleString) to avoid
 * Next.js hydration mismatches between server and client.
 */

/** Set of document field names that hold date/time values */
export const DATE_FIELD_KEYS = new Set([
  "registeredAt",
  "createdAt",
  "updatedAt",
  "approvedAt",
  "rejectedAt",
  "checkInTime",
]);

/** Check if a value is an ISO 8601 date string (e.g. 2026-02-22T11:48:16.575Z) */
export function isIsoDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const isoRegex =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
  return isoRegex.test(value);
}

/**
 * Format a date value as `DD:MM:YYYY HH:MM AM/PM`.
 *
 * Accepts:
 * - `Date` object
 * - ISO 8601 string (e.g. `"2026-02-21T15:45:00Z"`)
 * - Unix timestamp in **milliseconds** (number)
 * - `null` / `undefined` → returns `'—'`
 *
 * Returns `'—'` for any value that cannot be parsed into a valid date.
 */
export function formatDateTime(
  value: Date | string | number | null | undefined,
): string {
  if (value == null) return "—";

  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string") {
    date = new Date(value);
  } else {
    return "—";
  }

  if (isNaN(date.getTime())) return "—";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12; // convert 0 → 12 for 12-hour format
  const hh = String(hours).padStart(2, "0");

  return `${dd}:${mm}:${yyyy} ${hh}:${minutes} ${ampm}`;
}
