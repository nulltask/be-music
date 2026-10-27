/** An engine enum value as words for a label: `FULL_COMBO` reads `FULL COMBO`, `emptyPoor` reads `EMPTY POOR`. */
export function formatEnumLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toUpperCase();
}
