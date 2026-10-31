import { expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson } from '@be-music/chart-parser';
import { stitchNonstopCourse } from './compose.ts';
import { resolveChartRulesetFacts } from '../../core/play-chart.ts';
import { resolveRuleset } from '../../ruleset/definitions.ts';

const bmson = (total: number) =>
  parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { mode_hint: 'beat-7k', init_bpm: 120, total },
      sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 480 }] }],
    }),
  );

test('mixed NONSTOP resolves the selected TOTAL units rather than its bmson container', () => {
  const zero = bmson(0);
  const absolute = parseBMS('#BPM 120\n#TOTAL 0\n#00111:01');
  for (const [stages, disabled] of [
    [[zero, absolute], false],
    [[absolute, zero], true],
    [[zero, bmson(100)], false],
  ] as const) {
    const stitched = stitchNonstopCourse(
      stages.map((chart) => ({ chart })),
      { connections: ['cut'] },
    );
    expect(stitched.ok).toBe(true);
    if (!stitched.ok) throw new Error(stitched.reason);
    const facts = resolveChartRulesetFacts(stitched.chart, {});
    const config = resolveRuleset(facts, 'beatoraja', { bmsonTotalMode: 'spec' });
    expect(config.gauge.recoveryDisabled === true).toBe(disabled);
    expect(facts.totalUnit).toBe(stages[1]!.sourceFormat === 'bmson' ? 'percent' : 'absolute');
  }
});
