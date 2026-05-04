export function findStackableRowIndex(
  rowCount: number,
  preferredRow: number,
  canPlaceAt: (targetRow: number) => boolean,
): number | undefined {
  const safeRowCount = Number.isFinite(rowCount) ? Math.max(0, Math.floor(rowCount)) : 0;
  const safePreferredRow = Number.isFinite(preferredRow) ? Math.floor(preferredRow) : 0;
  if (safeRowCount <= 0) {
    return undefined;
  }

  // Keep overlap ordering deterministic for SCROLL=0 stacks:
  // prefer rows farther from the judge line (upper rows) first.
  for (let targetRow = safePreferredRow - 1; targetRow >= 0; targetRow -= 1) {
    if (canPlaceAt(targetRow)) {
      return targetRow;
    }
  }
  for (let targetRow = safePreferredRow + 1; targetRow < safeRowCount; targetRow += 1) {
    if (canPlaceAt(targetRow)) {
      return targetRow;
    }
  }
  return undefined;
}
