import { describe, expect, test } from 'vite-plus/test';
import { parseBms, resolveBmsControlFlowWithDraws } from '../../parser/src/index.ts';
import { drawRandomOutcomes, type RandomDraws } from './control-flow.ts';
import { createOutcomeComposer, expandChartFingerprintDocument } from './fingerprint-compose.ts';
import {
  canonicalizeFingerprintDocument,
  computeChartFingerprint,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
} from './fingerprint.ts';

const OPTIONS = { chartPath: undefined };
/** The seed ranges can be widened locally with `FP_SEED_FROM` / `FP_SEED_TO` (and the timeout with `FP_TEST_TIMEOUT`). */
const LONG_TEST_TIMEOUT = Number(process.env.FP_TEST_TIMEOUT ?? 60_000);

/** Small deterministic PRNG (mulberry32). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTENT_LINES: ReadonlyArray<(pick: (n: number) => number) => string> = [
  (pick) => `#00${pick(3) + 1}1${[1, 2, 3, 6][pick(4)]}:${['01', '0100', '0001', '01ZZ', '0102'][pick(5)]}`,
  (pick) => `#00${pick(3) + 1}12:${['01', '00010000', 'ZZ', '0000ZZ00'][pick(4)]}`,
  (pick) => `#00${pick(3) + 1}5${[1, 2][pick(2)]}:${['01', '0101', '00000101'][pick(3)]}`,
  (pick) => `#00${pick(3) + 1}08:${['01', '02', '0001'][pick(3)]}`,
  (pick) => `#00${pick(3) + 1}03:${['78', '96', '0078'][pick(3)]}`,
  (pick) => `#00${pick(3) + 1}09:${['01', '0001'][pick(2)]}`,
  (pick) => `#00${pick(3) + 1}SC:${['01', '0001'][pick(2)]}`,
  (pick) => `#00${pick(3) + 1}SP:${['01', '0001', '02'][pick(3)]}`,
  (pick) => `#00${pick(3) + 1}02:${['0.75', '1.5', '1'][pick(3)]}`,
  (pick) => `#00${pick(3) + 1}D1:${['0A', '01'][pick(2)]}`,
  (pick) => `#BPM01 ${[200, 300, 120][pick(3)]}`,
  (pick) => `#BPM02 ${[180, 150][pick(2)]}`,
  (pick) => `#STOP01 ${[48, 96][pick(2)]}`,
  (pick) => `#SCROLL01 ${[0.5, 2][pick(2)]}`,
  (pick) => `#SPEED01 ${[1, 2][pick(2)]}`,
  (pick) => `#SPEED02 ${[1, 0.5][pick(2)]}`,
  (pick) => `#BPM ${[150, 160][pick(2)]}`,
  (pick) => `#TOTAL ${[200, 0][pick(2)]}`,
  (pick) => `#RANK ${[1, 3][pick(2)]}`,
  () => '#LNOBJ ZZ',
  (pick) => `#LNTYPE ${[1, 2][pick(2)]}`,
  (pick) => `#STP 00${pick(3) + 1}.500 ${[100, 250][pick(2)]}`,
];

/** A random chart with nested (and sometimes malformed) control flow. */
function generateChart(seed: number): string {
  const random = createRandom(seed);
  const pick = (n: number): number => Math.floor(random() * n);
  const lines: string[] = ['#PLAYER 1', '#BPM 150', '#00111:0101', '#00213:01', '#00116:0001'];
  if (pick(2) === 0) {
    lines.push('#LNOBJ ZZ');
  }
  const content = (): string => CONTENT_LINES[pick(CONTENT_LINES.length)]!(pick);
  let budget = 30;
  const block = (depth: number): void => {
    const kind = depth === 0 ? 2 + pick(2) : pick(depth > 2 ? 2 : 4);
    if (kind <= 1 || budget <= 0) {
      lines.push(content());
      budget -= 1;
      return;
    }
    if (kind === 2) {
      const max = 1 + pick(3);
      lines.push(pick(5) === 0 ? `#SETRANDOM ${max}` : `#RANDOM ${max}`);
      const ifs = 1 + pick(3);
      for (let index = 0; index < ifs; index += 1) {
        if (pick(4) === 0) {
          block(depth + 1);
        }
        lines.push(`#IF ${1 + pick(max + 1)}`);
        const bodies = 1 + pick(2);
        for (let body = 0; body < bodies; body += 1) {
          block(depth + 1);
        }
        const tail = pick(6);
        if (tail === 0) {
          lines.push(`#ELSEIF ${1 + pick(max)}`);
          block(depth + 1);
        } else if (tail === 1) {
          lines.push('#ELSE');
          block(depth + 1);
        }
        if (pick(8) !== 0) {
          lines.push('#ENDIF');
        }
      }
      if (pick(8) !== 0) {
        lines.push('#ENDRANDOM');
      }
      return;
    }
    const max = 1 + pick(3);
    lines.push(pick(5) === 0 ? `#SETSWITCH ${max}` : `#SWITCH ${max}`);
    const cases = 1 + pick(3);
    for (let index = 0; index < cases; index += 1) {
      lines.push(pick(4) === 0 ? '#DEF' : `#CASE ${1 + pick(max)}`);
      block(depth + 1);
      if (pick(2) === 0) {
        lines.push('#SKIP');
      }
    }
    if (pick(8) !== 0) {
      lines.push('#ENDSW');
    }
  };
  const blocks = 1 + pick(3);
  for (let index = 0; index < blocks; index += 1) {
    block(0);
    if (pick(2) === 0) {
      lines.push(content().startsWith('#0') ? '#00211:0001' : '#00311:01');
    }
  }
  return lines.join('\n');
}

/** Every outcome vector (one value per `#RANDOM` / `#SWITCH` line), or `undefined` when there are too many. */
function enumerateOutcomes(text: string, limit = 256): number[][] | undefined {
  const maxes: number[] = [];
  for (const line of text.split('\n')) {
    const match = /^#(RANDOM|SWITCH) (\d+)$/.exec(line);
    if (match) {
      maxes.push(Math.max(1, Number.parseInt(match[2]!, 10)));
    }
  }
  let vectors: number[][] = [[]];
  for (const max of maxes) {
    const next: number[][] = [];
    for (const vector of vectors) {
      for (let value = 1; value <= max; value += 1) {
        next.push([...vector, value]);
      }
    }
    vectors = next;
    if (vectors.length > limit) {
      return undefined;
    }
  }
  return vectors;
}

/** The draws of `text` whose `#RANDOM` / `#SWITCH` lines take the values of `vector`, in file order. */
function drawsFor(text: string, vector: ReadonlyArray<number>): RandomDraws {
  const maxes = [...text.matchAll(/^#(?:RANDOM|SWITCH) (\d+)$/gm)].map((match) => Number.parseInt(match[1]!, 10));
  const values: number[] = [];
  vector.forEach((value, index) => {
    if (maxes[index]! >= 2) {
      values.push((value - 0.5) / maxes[index]!);
    }
  });
  let cursor = 0;
  return drawRandomOutcomes(parseBms(text), () => values[cursor++] ?? 0);
}

/** Checks every outcome of `text` against the parser and the document's distribution; returns the outcomes checked. */
function checkAgainstParser(text: string, label: string): number {
  const outcomes = enumerateOutcomes(text);
  if (!outcomes) {
    return 0;
  }
  const json = parseBms(text);
  const distribution = new Map<string, bigint>();
  const compose = createOutcomeComposer(json, OPTIONS);
  for (const vector of outcomes) {
    const draws = drawsFor(text, vector);
    const expected = createPlayFingerprintDocument(resolveBmsControlFlowWithDraws(json, draws), OPTIONS);
    const composed = compose(draws);
    expect(composed, `${label}, outcome ${vector.join(',')}\n${text}`).toEqual(expected);
    const key = canonicalizeFingerprintDocument(expected);
    distribution.set(key, (distribution.get(key) ?? 0n) + 1n);
  }
  // The document alone gives the same distribution of play documents.
  const expanded = new Map<string, { n: bigint; d: bigint }>();
  for (const { probability, document } of expandChartFingerprintDocument(
    createChartFingerprintDocument(json, OPTIONS),
  )) {
    const key = canonicalizeFingerprintDocument(document);
    const sum = expanded.get(key) ?? { n: 0n, d: 1n };
    expanded.set(key, { n: sum.n * probability.d + probability.n * sum.d, d: sum.d * probability.d });
  }
  const total = BigInt(outcomes.length);
  expect([...expanded.keys()].sort(), `${label}\n${text}`).toEqual([...distribution.keys()].sort());
  for (const [key, count] of distribution) {
    const probability = expanded.get(key)!;
    expect(probability.n * total, `${label}\n${text}`).toBe(count * probability.d);
  }
  return outcomes.length;
}

/** Several sequential blocks writing long-note halves on the same lanes, so their outcomes interact. */
function generateLongNoteChart(seed: number): string {
  const random = createRandom(seed);
  const pick = (n: number): number => Math.floor(random() * n);
  const lines: string[] = ['#BPM 150', pick(2) === 0 ? '#LNOBJ ZZ' : '#LNTYPE 1', '#00111:01000100', '#00151:00010001'];
  const data = ['01', 'ZZ', '0100', '00ZZ', '0001', '01ZZ', '0000ZZ00'];
  const blocks = 2 + pick(4);
  for (let index = 0; index < blocks; index += 1) {
    lines.push(`#RANDOM ${2 + pick(2)}`);
    const ifs = 1 + pick(2);
    for (let branch = 1; branch <= ifs; branch += 1) {
      lines.push(`#IF ${branch}`);
      const objects = 1 + pick(2);
      for (let object = 0; object < objects; object += 1) {
        lines.push(`#00${1 + pick(3)}${['11', '51', '12'][pick(3)]}:${data[pick(data.length)]}`);
      }
      lines.push('#ENDIF');
    }
    lines.push('#ENDRANDOM');
    if (pick(3) === 0) {
      lines.push(`#00${1 + pick(3)}11:${data[pick(data.length)]}`);
    }
  }
  return lines.join('\n');
}

describe('chart fingerprint control flow against the parser', () => {
  test(
    'every outcome of random charts composes to the parser-resolved play document',
    () => {
      let checked = 0;
      const from = Number(process.env.FP_SEED_FROM ?? 1);
      const to = Number(process.env.FP_SEED_TO ?? 500);
      for (let seed = from; seed <= to; seed += 1) {
        checked += checkAgainstParser(generateChart(seed), `seed ${seed}`);
      }
      expect(checked).toBeGreaterThan(1000);
    },
    LONG_TEST_TIMEOUT,
  );

  test(
    'interacting long notes in separate blocks compose correctly',
    () => {
      let checked = 0;
      const from = Number(process.env.FP_SEED_FROM ?? 1);
      const to = Number(process.env.FP_SEED_TO ?? 300);
      for (let seed = from; seed <= to; seed += 1) {
        checked += checkAgainstParser(generateLongNoteChart(seed), `long-note seed ${seed}`);
      }
      expect(checked).toBeGreaterThan(1000);
    },
    LONG_TEST_TIMEOUT,
  );
});

describe('reviewer repros (finding A6)', () => {
  test.each([
    [
      'a definition inside a branch used outside it',
      ['#BPM 150', '#BPM01 300', '#00208:01', '#00111:01', '#RANDOM 2', '#IF 1', '#BPM01 200', '#ENDIF', '#ENDRANDOM'],
    ],
    [
      'a missing #ENDIF that outlives #ENDRANDOM',
      ['#BPM 150', '#RANDOM 2', '#IF 1', '#00211:01', '#IF 2', '#00212:01', '#ENDIF', '#ENDRANDOM', '#00511:01'],
    ],
    [
      'an #IF inside a #SWITCH outside the #IFs of a #RANDOM',
      [
        '#BPM 150',
        '#RANDOM 2',
        '#SWITCH 2',
        '#CASE 1',
        '#IF 1',
        '#00311:01',
        '#ENDIF',
        '#SKIP',
        '#CASE 2',
        '#00312:01',
        '#ENDSW',
        '#ENDRANDOM',
      ],
    ],
    [
      'labels tested in a nested #SWITCH under #ELSE',
      [
        '#BPM 150',
        '#RANDOM 3',
        '#IF 1',
        '#00111:01',
        '#ELSE',
        '#SETSWITCH 1',
        '#CASE 1',
        '#IF 3',
        '#00313:01',
        '#ENDIF',
        '#ENDSW',
        '#ENDIF',
        '#ENDRANDOM',
      ],
    ],
    [
      'long-note halves split across a branch boundary',
      ['#BPM 150', '#LNOBJ ZZ', '#00111:01', '#RANDOM 2', '#IF 1', '#00211:ZZ', '#ENDIF', '#ENDRANDOM'],
    ],
    [
      'branch headers a later top-level line overrides (file order)',
      [
        '#BPM 150',
        '#BPM01 300',
        '#00111:01',
        '#RANDOM 2',
        '#IF 1',
        '#BPM 200',
        '#BPM01 200',
        '#TOTAL 400',
        '#00112:01',
        '#ELSE',
        '#BPM02 240',
        '#ENDIF',
        '#ENDRANDOM',
        '#BPM 180',
        '#BPM01 250',
        '#00208:01',
        '#00308:02',
      ],
    ],
  ])('composes like the parser: %s', (label, lines) => {
    expect(checkAgainstParser(lines.join('\n'), label)).toBeGreaterThan(1);
  });

  test('a missing #ENDIF keeps later lines conditional', () => {
    const text = [
      '#BPM 150',
      '#RANDOM 2',
      '#IF 1',
      '#00211:01',
      '#IF 2',
      '#00212:01',
      '#ENDIF',
      '#ENDRANDOM',
      '#00511:01',
    ].join('\n');
    const compose = createOutcomeComposer(parseBms(text), OPTIONS);
    expect(compose(drawsFor(text, [1])).notes).toContainEqual({ m: '5', p: '0', lane: '11' });
    expect(compose(drawsFor(text, [2])).notes).not.toContainEqual({ m: '5', p: '0', lane: '11' });
  });

  test('a label tested only in a nested block still splits the default values', () => {
    const text = (lane: string): string =>
      [
        '#BPM 150',
        '#RANDOM 3',
        '#IF 1',
        '#00111:01',
        '#ELSE',
        '#SETSWITCH 1',
        '#CASE 1',
        '#IF 3',
        `#003${lane}:01`,
        '#ENDIF',
        '#ENDSW',
        '#ENDIF',
        '#ENDRANDOM',
      ].join('\n');
    const chart = (lane: string): string => computeChartFingerprint(parseBms(text(lane)), OPTIONS);
    expect(chart('13')).not.toBe(chart('14'));
  });
});

describe('evaluation budget (finding A7)', () => {
  function timed(text: string): {
    fingerprint: string;
    ms: number;
    document: ReturnType<typeof createChartFingerprintDocument>;
  } {
    const json = parseBms(text);
    const started = performance.now();
    const fingerprint = computeChartFingerprint(json, OPTIONS);
    const ms = performance.now() - started;
    return { fingerprint, ms, document: createChartFingerprintDocument(json, OPTIONS) };
  }

  test('nested fall-through #SWITCH blocks (k = 10, depth 6)', () => {
    const lines: string[] = ['#BPM 150'];
    const level = (depth: number): void => {
      lines.push('#SWITCH 10');
      for (let value = 1; value <= 10; value += 1) {
        lines.push(`#CASE ${value}`, `#00${depth}1${(value % 9) + 1}:01`);
      }
      if (depth < 6) {
        level(depth + 1);
      }
      lines.push('#ENDSW');
    };
    level(1);
    const result = timed(lines.join('\n'));
    expect(result.ms).toBeLessThan(3000);
    expect(result.fingerprint).toBe(timed(lines.join('\n')).fingerprint);
    expect(JSON.stringify(result.document)).toContain('"opaque"');
  });

  test('20 000 #IF blocks under #RANDOM 1000000', () => {
    const lines: string[] = ['#BPM 150', '#RANDOM 1000000'];
    for (let label = 1; label <= 20_000; label += 1) {
      lines.push(`#IF ${label}`, `#${String(1 + (label % 900)).padStart(3, '0')}11:01`, '#ENDIF');
    }
    lines.push('#ENDRANDOM');
    const result = timed(lines.join('\n'));
    expect(result.ms).toBeLessThan(3000);
    expect(JSON.stringify(result.document)).toContain('"opaque"');
  });

  test('2000 nested #RANDOM / #IF blocks', () => {
    const lines: string[] = ['#BPM 150'];
    for (let depth = 0; depth < 2000; depth += 1) {
      lines.push('#RANDOM 2', '#IF 1');
    }
    lines.push('#00111:01');
    for (let depth = 0; depth < 2000; depth += 1) {
      lines.push('#ENDIF', '#ENDRANDOM');
    }
    const result = timed(lines.join('\n'));
    expect(result.ms).toBeLessThan(3000);
    expect(result.fingerprint).toMatch(/^bmfp1:[0-9a-f]{64}$/);
  });

  test('a chart below the budget is not opaque', () => {
    const lines: string[] = ['#BPM 150', '#RANDOM 8'];
    for (let label = 1; label <= 8; label += 1) {
      lines.push(`#IF ${label}`, '#RANDOM 4');
      for (let inner = 1; inner <= 4; inner += 1) {
        lines.push(`#IF ${inner}`, `#00${label}1${inner}:01`, '#ENDIF');
      }
      lines.push('#ENDRANDOM', '#ENDIF');
    }
    lines.push('#ENDRANDOM');
    const result = timed(lines.join('\n'));
    expect(JSON.stringify(result.document)).not.toContain('"opaque"');
    expect(result.ms).toBeLessThan(1000);
  });
});
