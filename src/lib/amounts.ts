// Tiller's own display formatting - "$1,234.56", "-$3,463.68" - parsed back to
// a plain decimal string, since Drizzle's `numeric` columns want a string, not
// a JS number (which would lose precision on large balances).

// Strips Tiller's currency formatting. Shared by both parsers below; not
// exported because the sign handling differs by column and callers should
// never be tempted to skip it.
function parseTillerNumber(raw: string): number {
  const numeric = Number(raw.trim().replace(/[$,]/g, ""))
  if (Number.isNaN(numeric)) throw new Error(`Unparseable Tiller amount: "${raw}"`)
  return numeric
}

// Plaid convention: positive = outflow. Tiller stores negative-is-expense, so
// this flips the sign on the way in - see CLAUDE.md's gotcha. Blank is
// rejected explicitly: Number("") is 0, so an empty cell would otherwise
// silently import as a real $0.00 transaction instead of being skipped.
export function parseTillerAmount(raw: string): string {
  if (!raw.trim()) throw new Error("Blank amount")
  return (-parseTillerNumber(raw)).toFixed(2)
}

// Last Balance is a point-in-time snapshot, not a transaction - spec §1 marks
// only Amount as sign-inverted, so this does not flip. Blank is legitimate
// (not every account row carries one) and maps to null rather than throwing.
export function parseTillerBalance(raw: string): string | null {
  if (!raw.trim()) return null
  return parseTillerNumber(raw).toFixed(2)
}
