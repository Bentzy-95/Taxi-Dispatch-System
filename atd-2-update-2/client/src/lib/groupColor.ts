// Deterministic color per groupId, so every booking in the same combined
// trip gets the exact same color, and different combined trips get
// visibly different colors from each other. Plain "unassigned" or solo
// bookings get no color at all - only combined ones need to stand out.
//
// Deliberately kept separate from the app's red "signal" color, which
// already means "error/attention" elsewhere in the UI - reusing it here
// would make combined trips look like warnings.
const GROUP_PALETTE = [
  "#2563eb", // blue
  "#059669", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
] as const;

export function colorForGroup(groupId: string): string {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 31 + groupId.charCodeAt(i)) >>> 0;
  }
  return GROUP_PALETTE[hash % GROUP_PALETTE.length];
}
