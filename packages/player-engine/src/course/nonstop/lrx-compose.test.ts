import { resolveChart } from '@be-music/chart-model';
import { parseChart, parseLRX } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { stitchNonstopCourse } from './compose.ts';

// BPM 120: 480 ticks is 0.5 s.
const lrx = (laneType: number, ...notes: string[]) =>
  parseLRX({
    lrs: `<LRS><sound id="0" filename="a.wav" /><sound id="1" filename="b.wav" /><n c="301" s="0" p="120" /><n c="300" s="0" />${notes.join('')}</LRS>`,
    lrh: `<LRH><information lanetype="${laneType}" /></LRH>`,
  });

test("a course of LRX stages stitches into an LRX chart that keeps each note's values", () => {
  const stage = lrx(
    0,
    '<n c="1" s="480" e="960" p="0" vol="64" />',
    '<n c="1" s="1440" p="0" />',
    '<n c="1" s="1560" p="1" cn="1" pan="0" />',
    '<n c="2" s="1920" p="1" dmg="0" />',
  );
  const result = stitchNonstopCourse([{ chart: stage }, { chart: stage }], { connections: ['cut'] });
  if (!result.ok) throw new Error(`stitch failed: ${result.reason}`);
  expect(result.chart.sourceFormat).toBe('lrx');
  expect(result.chart.lrx?.laneType).toBe(0);
  const resolved = resolveChart(result.chart);
  // Each stage keeps a CN of half a second and a note with a chain note 0.125 s after it.
  const longNotes = resolved.notes.filter((note) => note.kind === 'ln');
  expect(longNotes).toHaveLength(2);
  for (const note of longNotes) {
    expect(note.lnMode).toBe(2);
    expect(note.endSeconds! - note.seconds).toBeCloseTo(0.5, 3);
  }
  const chained = resolved.notes.filter((note) => note.chainSounds !== undefined);
  expect(chained).toHaveLength(2);
  for (const note of chained) expect(note.chainSounds![0]!.delaySeconds).toBeCloseTo(0.125, 3);
  // The note's own volume and the chain note's balance travel with them, and the hidden note is a lane sound again.
  expect(resolved.sampleTriggers.filter((trigger) => trigger.sampleGain !== undefined)).toHaveLength(2);
  expect(resolved.sampleTriggers.filter((trigger) => trigger.samplePan !== undefined)).toHaveLength(2);
  expect(resolved.invisibleNotes.map((note) => note.channel)).toEqual(['12', '12']);
});

test('LRX does not mix with BMS, and its stages share a lane type', () => {
  const bms = parseChart('#BPM 120\n#WAV01 a.wav\n#00111:01', 'bms');
  expect(
    stitchNonstopCourse([{ chart: bms }, { chart: lrx(0, '<n c="1" s="480" p="0" />') }], { connections: ['cut'] }),
  ).toMatchObject({
    ok: false,
    reason: 'lrx-mixed',
    stage: 1,
  });
  expect(
    stitchNonstopCourse(
      [{ chart: lrx(0, '<n c="1" s="480" p="0" />') }, { chart: lrx(1, '<n c="1" s="480" p="0" />') }],
      {
        connections: ['cut'],
      },
    ),
  ).toMatchObject({ ok: false, reason: 'lrx-layout-mismatch', stage: 1 });
});
