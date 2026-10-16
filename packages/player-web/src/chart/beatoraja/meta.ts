// Tiny helper for surfacing chart-level metadata that beatoraja's text resolvers (`SUBARTIST`,
// `FULLARTIST`) need but isn't promoted onto `BeMusicMetadata` directly.
//
// Two source paths:
//
// - **BMS / PMS** — `#SUBARTIST <value>` is parsed but not promoted to a typed metadata field, so
//   it lands in `metadata.extras.SUBARTIST` (the parser's catch-all for unrecognised header
//   commands). One string, free-form.
// - **bmson** — `info.subartists[]` is a structured `"role:value"` array per the bmson 1.0.0
//   spec. We join with a single space (matching beatoraja's `SongData.getSubartist()` which
//   concatenates the contributor list into one display line).
//
// Returning a single joined string keeps the call sites simple — every text resolver that needs
// the sub-artist treats it as an opaque blob and feeds it into `joinNonEmpty()` for
// `FULLARTIST`. Hosts that want the structured `{ role, name }` form can post-process via
// {@link parseBmsonSubartist} from `@be-music/json` directly on `bmson.info.subartists`.

import type { BeMusicJson } from '@be-music/json';

/**
 * Resolve the chart's sub-artist line as a single joined string. Returns `''` when neither
 * `#SUBARTIST` (BMS) nor `info.subartists` (bmson) was authored. The bmson path takes priority
 * — bmson charts that ALSO inherited a stray `extras.SUBARTIST` (round-tripped through a
 * BMS-flavoured tool) fall back on the structured field rather than the duplicate extras
 * entry.
 */
export function extractChartSubartist(chart: BeMusicJson | undefined): string {
  if (chart === undefined) return '';
  const bmsonList = chart.bmson?.info?.subartists;
  if (bmsonList !== undefined && bmsonList.length > 0) {
    // Filter empties so a list like `['', 'mov:foo']` doesn't render with a leading space.
    return bmsonList.filter((entry) => typeof entry === 'string' && entry.length > 0).join(' ');
  }
  const bmsExtra = chart.metadata.extras?.SUBARTIST;
  if (typeof bmsExtra === 'string' && bmsExtra.length > 0) return bmsExtra;
  return '';
}
