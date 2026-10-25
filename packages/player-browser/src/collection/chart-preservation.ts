import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';

/** Drop formatting data while retaining the original WAV loader order and branch gates used by LR2 EXTRA. */
export function compactChartPreservation(chart: BeMusicJSON): void {
  const sourceLines = structuredClone(
    chart.preservation.bms.sourceLines.filter(
      (entry) => entry.kind === 'directive' || (entry.kind === 'header' && /^WAV[0-9A-Z]{2}$/i.test(entry.command)),
    ),
  );
  chart.preservation = createEmptyJSON(chart.sourceFormat).preservation;
  chart.preservation.bms.sourceLines = sourceLines;
}
