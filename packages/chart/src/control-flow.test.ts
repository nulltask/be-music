import type { BmsControlFlowEntry } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { drawRandomOutcomes, evaluateControlFlow, hasControlFlow, type RandomDraws } from './control-flow.ts';

const DIRECTIVES = new Set([
  'RANDOM',
  'SETRANDOM',
  'IF',
  'ELSEIF',
  'ELSE',
  'ENDIF',
  'ENDRANDOM',
  'SWITCH',
  'SETSWITCH',
  'CASE',
  'SKIP',
  'DEF',
  'ENDSW',
]);

/**
 * Builds a control-flow list the way the parser captures it: directives, `#xxx value` headers, and `#mmmcc:data`
 * object lines (kept as a single event so the active lines can be read back as `cc:data`).
 */
function source(lines: string[]): { bms: { controlFlow: BmsControlFlowEntry[] } } {
  const controlFlow = lines.map((line): BmsControlFlowEntry => {
    const object = /^#(\d{3})([0-9A-Z]{2}):(.+)$/u.exec(line);
    if (object) {
      const [, measure, channel, value] = object;
      return {
        kind: 'object',
        measure: Number(measure),
        channel: channel!,
        events: [{ measure: Number(measure), channel: channel!, position: [0, 1], value: value! }],
      };
    }
    const [command, ...rest] = line.slice(1).split(' ');
    const value = rest.join(' ');
    if (DIRECTIVES.has(command!)) {
      return value.length > 0
        ? { kind: 'directive', command: command as never, value }
        : { kind: 'directive', command: command as never };
    }
    return { kind: 'header', command: command!, value };
  });
  return { bms: { controlFlow } };
}

/** The active lines under `draws`, as `#HEADER value` / `cc:data`. */
function activeLines(lines: string[], draws: RandomDraws): string[] {
  return evaluateControlFlow(source(lines), draws).map((entry) =>
    entry.kind === 'header' ? `#${entry.command} ${entry.value}` : `${entry.channel}:${entry.events[0]!.value}`,
  );
}

/** A random source that returns `values` in turn and counts the calls. */
function sequence(values: number[]): { random: () => number; calls: () => number } {
  let index = 0;
  return {
    random: () => values[index++] ?? 0,
    calls: () => index,
  };
}

describe('drawRandomOutcomes', () => {
  test('draws one value per #RANDOM / #SWITCH line in file order, including lines in a branch not taken', () => {
    const rng = sequence([0.9, 0, 0.5]);
    const draws = drawRandomOutcomes(
      source(['#RANDOM 2', '#IF 1', '#RANDOM 3', '#ENDRANDOM', '#ENDIF', '#ENDRANDOM', '#SWITCH 4', '#ENDSW']),
      rng.random,
    );
    expect(draws).toEqual([
      { command: 'RANDOM', range: 2, value: 2 },
      { command: 'RANDOM', range: 3, value: 1 },
      { command: 'SWITCH', range: 4, value: 3 },
    ]);
    expect(rng.calls()).toBe(3);
  });

  test('single-outcome lines record 1 without consuming the random source', () => {
    const rng = sequence([0.9]);
    const draws = drawRandomOutcomes(
      source(['#RANDOM 1', '#RANDOM', '#RANDOM 0', '#RANDOM -3', '#RANDOM x', '#SWITCH 1', '#RANDOM 2']),
      rng.random,
    );
    expect(draws.map((draw) => `${draw.command} ${draw.value}/${draw.range}`)).toEqual([
      'RANDOM 1/1',
      'RANDOM 1/1',
      'RANDOM 1/1',
      'RANDOM 1/1',
      'RANDOM 1/1',
      'SWITCH 1/1',
      'RANDOM 2/2',
    ]);
    expect(rng.calls()).toBe(1);
  });

  test('#SETRANDOM / #SETSWITCH fix their value (1 when missing or not positive) and draw nothing', () => {
    const rng = sequence([]);
    const draws = drawRandomOutcomes(
      source(['#SETRANDOM 3', '#SETSWITCH 2', '#SETRANDOM 0', '#SETSWITCH']),
      rng.random,
    );
    expect(draws).toEqual([
      { command: 'SETRANDOM', range: 1, value: 3 },
      { command: 'SETSWITCH', range: 1, value: 2 },
      { command: 'SETRANDOM', range: 1, value: 1 },
      { command: 'SETSWITCH', range: 1, value: 1 },
    ]);
    expect(rng.calls()).toBe(0);
  });

  test('clamps the random source into the line range', () => {
    const lines = source(['#RANDOM 4', '#RANDOM 4', '#RANDOM 4', '#RANDOM 4']);
    const values = drawRandomOutcomes(lines, sequence([-1, 1, 5, Number.NaN]).random).map((draw) => draw.value);
    expect(values).toEqual([1, 4, 4, 1]);
  });

  test('a chart without control flow has no draws', () => {
    expect(drawRandomOutcomes(source([]), () => 0.5)).toEqual([]);
    expect(hasControlFlow(source([]))).toBe(false);
    expect(hasControlFlow(source(['#RANDOM 2']))).toBe(true);
  });
});

describe('evaluateControlFlow', () => {
  const ifElse = [
    '#RANDOM 3',
    '#IF 1',
    '#00111:01',
    '#ELSEIF 2',
    '#00112:02',
    '#ELSE',
    '#00113:03',
    '#ENDIF',
    '#ENDRANDOM',
  ];

  test('#IF / #ELSEIF / #ELSE take exactly one branch', () => {
    expect(activeLines(ifElse, [{ command: 'RANDOM', range: 3, value: 1 }])).toEqual(['11:01']);
    expect(activeLines(ifElse, [{ command: 'RANDOM', range: 3, value: 2 }])).toEqual(['12:02']);
    expect(activeLines(ifElse, [{ command: 'RANDOM', range: 3, value: 3 }])).toEqual(['13:03']);
  });

  test('a definition in a taken branch is active, one in a branch not taken is not', () => {
    const lines = ['#RANDOM 2', '#IF 1', '#WAV01 one.wav', '#BPM 150', '#ENDIF', '#IF 2', '#WAV01 two.wav', '#ENDIF'];
    expect(activeLines(lines, [{ command: 'RANDOM', range: 2, value: 1 }])).toEqual(['#WAV01 one.wav', '#BPM 150']);
    expect(activeLines(lines, [{ command: 'RANDOM', range: 2, value: 2 }])).toEqual(['#WAV01 two.wav']);
  });

  test('an #IF left open outlives its #ENDRANDOM and keeps gating the lines after it', () => {
    const lines = ['#RANDOM 2', '#IF 2', '#00111:01', '#ENDRANDOM', '#00112:02'];
    expect(activeLines(lines, [{ command: 'RANDOM', range: 2, value: 1 }])).toEqual([]);
    expect(activeLines(lines, [{ command: 'RANDOM', range: 2, value: 2 }])).toEqual(['11:01', '12:02']);
  });

  test('nested #RANDOM blocks test the innermost value and restore the outer one after #ENDRANDOM', () => {
    const lines = [
      '#RANDOM 2',
      '#IF 1',
      '#RANDOM 2',
      '#IF 2',
      '#00111:01',
      '#ENDIF',
      '#ENDRANDOM',
      '#ENDIF',
      '#IF 1',
      '#00112:02',
      '#ENDIF',
      '#ENDRANDOM',
    ];
    const draws = (outer: number, inner: number): RandomDraws => [
      { command: 'RANDOM', range: 2, value: outer },
      { command: 'RANDOM', range: 2, value: inner },
    ];
    expect(activeLines(lines, draws(1, 2))).toEqual(['11:01', '12:02']);
    expect(activeLines(lines, draws(1, 1))).toEqual(['12:02']);
    // The inner line is still drawn (and must be in the draws) when its branch is not taken.
    expect(activeLines(lines, draws(2, 2))).toEqual([]);
  });

  test('#SWITCH falls through from the matching #CASE until #SKIP, and #DEF takes the rest', () => {
    const lines = [
      '#SWITCH 3',
      '#CASE 1',
      '#00111:01',
      '#CASE 2',
      '#00112:02',
      '#SKIP',
      '#DEF',
      '#00113:03',
      '#SKIP',
      '#ENDSW',
      '#00114:04',
    ];
    const run = (value: number): string[] => activeLines(lines, [{ command: 'SWITCH', range: 3, value }]);
    expect(run(1)).toEqual(['11:01', '12:02', '14:04']);
    expect(run(2)).toEqual(['12:02', '14:04']);
    expect(run(3)).toEqual(['13:03', '14:04']);
  });

  test('a #SWITCH nested in an #IF and an #IF nested in a #CASE', () => {
    const lines = [
      '#RANDOM 2',
      '#IF 2',
      '#SWITCH 2',
      '#CASE 2',
      '#IF 2',
      '#00111:01',
      '#ENDIF',
      '#SKIP',
      '#ENDSW',
      '#ENDIF',
      '#ENDRANDOM',
    ];
    const run = (random: number, switchValue: number): string[] =>
      activeLines(lines, [
        { command: 'RANDOM', range: 2, value: random },
        { command: 'SWITCH', range: 2, value: switchValue },
      ]);
    expect(run(2, 2)).toEqual(['11:01']);
    expect(run(2, 1)).toEqual([]);
    expect(run(1, 2)).toEqual([]);
  });

  test('#RANDOM 1 always takes #IF 1, and #SETRANDOM takes the branch it fixes', () => {
    const block = ['#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:02', '#ENDIF', '#ENDRANDOM'];
    const single = source(['#RANDOM 1', ...block]);
    expect(
      activeLines(
        ['#RANDOM 1', ...block],
        drawRandomOutcomes(single, () => 0.9),
      ),
    ).toEqual(['11:01']);
    const fixed = source(['#SETRANDOM 2', ...block]);
    expect(
      activeLines(
        ['#SETRANDOM 2', ...block],
        drawRandomOutcomes(fixed, () => 0),
      ),
    ).toEqual(['12:02']);
  });

  test('the same draws always select the same lines', () => {
    const chart = source(ifElse);
    const draws = drawRandomOutcomes(chart, () => 0.5);
    expect(evaluateControlFlow(chart, draws)).toEqual(evaluateControlFlow(chart, draws));
    expect(evaluateControlFlow(chart, draws)).toEqual(
      evaluateControlFlow(
        chart,
        drawRandomOutcomes(chart, () => 0.5),
      ),
    );
  });

  test('rejects draws that were not drawn for this control flow', () => {
    const chart = source(['#RANDOM 2', '#SETRANDOM 3']);
    const valid: RandomDraws = [
      { command: 'RANDOM', range: 2, value: 1 },
      { command: 'SETRANDOM', range: 1, value: 3 },
    ];
    expect(() => evaluateControlFlow(chart, valid)).not.toThrow();
    expect(() => evaluateControlFlow(chart, valid.slice(0, 1))).toThrow(RangeError);
    expect(() => evaluateControlFlow(chart, [...valid, valid[0]!])).toThrow(RangeError);
    expect(() => evaluateControlFlow(chart, [{ ...valid[0]!, command: 'SWITCH' }, valid[1]!])).toThrow(RangeError);
    expect(() => evaluateControlFlow(chart, [{ ...valid[0]!, range: 3 }, valid[1]!])).toThrow(RangeError);
    expect(() => evaluateControlFlow(chart, [{ ...valid[0]!, value: 3 }, valid[1]!])).toThrow(RangeError);
    expect(() => evaluateControlFlow(chart, [valid[0]!, { ...valid[1]!, value: 2 }])).toThrow(RangeError);
  });
});
