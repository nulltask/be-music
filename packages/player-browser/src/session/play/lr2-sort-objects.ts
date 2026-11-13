import type { ResolvedChart } from '@be-music/chart-model';

// These objects do not take a destination but still affect the permutation of equal-time notes.
const NON_LANE_OPS = new Map([
  ['01', 1],
  ['03', 3],
  ['04', 4],
  ['05', 5],
  ['06', 6],
  ['07', 7],
  ['08', 8],
  ['09', 9],
]);

export function collectLR2SortObjects(
  chart: ResolvedChart,
  course = false,
): Array<{ order: number; timeMs: number; op: number }> {
  const { beatResolver, timing } = chart;
  const objects = [];
  if (chart.sourceFormat === 'bms') {
    if (!course && !chart.sortedEvents.some(({ channel }) => channel === '04' || channel === '07'))
      objects.push({ order: 0, timeMs: 0, op: 4 });
    // LR2's BMS loader creates 1,000 measure records per stage before it sorts.
    for (let measure = 0; measure < 1000; measure++) {
      const beat = beatResolver.measureToBeat(measure);
      objects.push({ order: beat, timeMs: timing.beatToSeconds(beat) * 1000, op: 2 });
    }
  } else {
    for (const beat of chart.barLines) objects.push({ order: beat, timeMs: timing.beatToSeconds(beat) * 1000, op: 2 });
  }
  for (const event of chart.sortedEvents) {
    const op = NON_LANE_OPS.get(event.channel);
    if (op !== undefined)
      objects.push({ order: beatResolver.eventToBeat(event), timeMs: timing.eventToSeconds(event) * 1000, op });
  }
  return objects;
}
