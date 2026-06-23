// Shift schedule times (end_time, main_jantri_time) are stored as IST
// wall-clock "HH:MM" values against a "YYYY-MM-DD" shift_date. Computing the
// absolute instant with `new Date(dateStr)` + Date#setHours is timezone-
// dependent: `new Date("2026-06-23")` parses as UTC midnight while setHours
// applies the SERVER's local timezone. Dev runs in IST and prod in UTC, so the
// same shift produced instants 5:30 apart — betting windows and result-declare
// cutoffs fired at the wrong time in production.
//
// These helpers build the instant explicitly in IST so the result is identical
// on any server. IST is UTC+5:30 year-round (no DST).
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Absolute UTC instant (ms since epoch) for an IST wall-clock time.
 *
 * @param dateStr  Shift date as "YYYY-MM-DD".
 * @param hhmm     Time of day as "HH:MM" (IST).
 * @param nextDay  When true, the time rolls into the following day (carry-over
 *                 shifts whose window extends past midnight).
 */
export function istInstantMs(
  dateStr: string,
  hhmm: string,
  nextDay = false
): number {
  const [Y, Mo, D] = dateStr.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  let ms = Date.UTC(Y, Mo - 1, D, h, m, 0, 0) - IST_OFFSET_MS;
  if (nextDay) ms += DAY_MS;
  return ms;
}
