// Shared YYYY-MM-DD validation for anything that eventually reaches a
// Postgres ::date cast - GET /transactions' from/to and cursor date today,
// SDG-196/SDG-198's date params later. Pure, so unit-testable on its own.

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// The pattern alone accepts calendar nonsense like "2026-02-31" - that would
// reach Postgres, fail the ::date cast, and surface as a 500 through
// app.onError instead of a 400 at the edge. Round-tripping through Date
// catches it: an invalid calendar date normalizes to a different string.
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  // An out-of-range calendar value (month 13, Feb 31) parses to an Invalid
  // Date rather than throwing - and Invalid Date.toISOString() itself throws,
  // so that has to be ruled out before comparing the round-tripped string.
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}
