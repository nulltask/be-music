import { computeChartFingerprint, drawRandomOutcomes, resolveChart } from '@be-music/chart-model';
import { expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson, resolveBMSControlFlowWithDraws } from './index.ts';

function bmson(modeHint?: unknown, soundChannels: unknown[] = []) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, mode_hint: modeHint },
      sound_channels: soundChannels,
    }),
  );
}

test('reports legacy conversion at the document root', () => {
  const chart = parseBmson('{"info":{"initBPM":120},"soundChannel":[]}');
  expect(chart.diagnostics).toMatchObject([{ code: 'legacy-bmson', position: { kind: 'field', path: '$' } }]);
  expect(resolveChart(chart).diagnostics).toEqual(chart.diagnostics);
});

test.each(['unknown-layout', 42, null])('reports unknown or malformed mode hints (%j)', (hint) => {
  expect(bmson(hint).diagnostics).toMatchObject([
    { code: 'unknown-mode-hint', position: { kind: 'field', path: 'info.mode_hint' } },
  ]);
});

test.each([undefined, '  ', 'beat-7k', 'generic-12keys'])('accepts mode hints (%j) without a warning', (hint) => {
  expect(resolveChart(bmson(hint)).diagnostics).toEqual([]);
});

test('reports a dropped stacked note at its position and keeps same-length keysound layers', () => {
  const chart = bmson('beat-7k', [
    { name: 'first.wav', notes: [{ x: 1, y: 960 }] },
    { name: 'dropped.wav', notes: [{ x: 1, y: 960, l: 240 }] },
    { name: 'layer.wav', notes: [{ x: 1, y: 960 }] },
  ]);
  const resolved = resolveChart(chart);
  expect(resolved.diagnostics).toMatchObject([
    { code: 'stacked-note-length', position: { kind: 'object', measure: 1, position: [0, 960], channel: '11' } },
  ]);
  expect(resolved.notes).toHaveLength(1);
  expect(resolved.sampleTriggers.map(({ samplePath }) => samplePath)).toEqual(['first.wav', 'layer.wav']);
});

test('reports undefined references and unsupported or invalid chart options with source positions', () => {
  const chart = parseBMS(
    [
      '#OPTION vendor:unimplemented',
      '#OPTION 774:HI-SPEED_x200',
      '#CHANGEOPTION01 vendor:timed',
      '#00108:0200',
      '#001A6:0102',
    ].join('\n'),
  );
  const diagnostics = resolveChart(chart).diagnostics;
  expect(diagnostics).toMatchObject([
    { code: 'missing-reference', subject: '#BPM02', position: { kind: 'object', channel: '08' } },
    { code: 'missing-reference', subject: '#CHANGEOPTION02', position: { kind: 'object', channel: 'A6' } },
    { code: 'unsupported-option', position: { kind: 'field', path: '#OPTION[1]' } },
    { code: 'invalid-option', position: { kind: 'field', path: '#OPTION[2]' } },
    { code: 'unsupported-option', position: { kind: 'object', channel: 'A6' } },
  ]);
});

test('checks references on the selected BMS branch without treating LNOBJ tails as missing audio', () => {
  const chart = parseBMS(
    ['#LNOBJ ZZ', '#RANDOM 2', '#IF 1', '#WAV01 sound.wav', '#ENDIF', '#ENDRANDOM', '#00111:01ZZ'].join('\n'),
  );
  expect(resolveChart(chart).diagnostics).toEqual([]);
  expect(
    resolveChart(
      resolveBMSControlFlowWithDraws(
        chart,
        drawRandomOutcomes(chart, () => 0),
      ),
    ).diagnostics,
  ).toEqual([]);
  expect(
    resolveChart(
      resolveBMSControlFlowWithDraws(
        chart,
        drawRandomOutcomes(chart, () => 0.99),
      ),
    ).diagnostics,
  ).toMatchObject([{ code: 'missing-reference', subject: '#WAV01' }]);
});

test('parser diagnostics do not change the fingerprint', () => {
  const chart = bmson('unknown-layout');
  const fingerprint = computeChartFingerprint(chart, { chartPath: undefined });
  expect(chart.diagnostics).toHaveLength(1);
  delete chart.diagnostics;
  expect(computeChartFingerprint(chart, { chartPath: undefined })).toBe(fingerprint);
});

test('reports a missing bmson BGA reference without warning about a clear or a defined image', () => {
  const chart = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [],
      bga: {
        bga_header: [{ id: 1, name: 'image.bmp' }],
        bga_events: [
          { y: 0, id: 1 },
          { y: 240, id: 0 },
          { y: 480, id: 2 },
        ],
      },
    }),
  );
  expect(resolveChart(chart).diagnostics).toMatchObject([
    { code: 'missing-reference', subject: '2', position: { kind: 'field', path: 'bga.bga_events[2]' } },
  ]);
});
