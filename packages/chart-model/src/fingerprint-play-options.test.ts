import { expect, test } from 'vite-plus/test';
import { parseBMS, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import type { RandomDraws } from './control-flow.ts';
import { createOutcomeComposer, expandChartFingerprintDocument } from './fingerprint-compose.ts';
import {
  computeChartFingerprint,
  computePlayFingerprint,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
} from './fingerprint.ts';

const OPTIONS = { chartPath: 'options.bms' };
const notes = '#BPM 120\n#00111:01\n#00213:01';

test('a chart without gameplay options keeps its document; one with them records them (#932)', () => {
  const plain = createPlayFingerprintDocument(parseBMS(notes), OPTIONS);
  expect(plain).not.toHaveProperty('playOptions');
  // Display-only declarations are no gameplay options.
  expect(computePlayFingerprint(parseBMS(`#OPTION 774:HI-SPEED_x2.00\n${notes}`), OPTIONS)).toBe(
    computePlayFingerprint(parseBMS(notes), OPTIONS),
  );
  const copied = parseBMS(`#OPTION 774:NOTES_COPY\n#OPTION 774:RANDOM_MIRROR\n${notes}`);
  expect(createPlayFingerprintDocument(copied, OPTIONS).playOptions).toEqual({ notes: 'COPY', random: 'MIRROR' });
  expect(createChartFingerprintDocument(copied, OPTIONS).playOptions).toEqual({ notes: 'COPY', random: 'MIRROR' });
  expect(computeChartFingerprint(copied, OPTIONS)).not.toBe(computeChartFingerprint(parseBMS(notes), OPTIONS));
  // Declarations that cancel out leave the document as it was.
  expect(computePlayFingerprint(parseBMS(`#OPTION 774:NOTES_COPY\n#OPTION 774:NOTES_OFF\n${notes}`), OPTIONS)).toBe(
    computePlayFingerprint(parseBMS(notes), OPTIONS),
  );
});

test.each([
  ['#RANDOM 2\n#IF 1\n#OPTION 774:NOTES_COPY\n#ENDIF\n#ENDRANDOM', 1],
  [
    '#OPTION 774:NOTES_DOUBLE\n#RANDOM 2\n#IF 1\n#OPTION 774:NOTES_OFF\n#ELSE\n#OPTION 774:RANDOM_ALL\n#ENDIF\n#ENDRANDOM',
    1,
  ],
  [
    '#RANDOM 2\n#IF 1\n#OPTION 774:CRAZY_ADDMINE\n#ENDIF\n#ENDRANDOM\n#RANDOM 2\n#IF 2\n#OPTION 774:CRAZY_OFF\n#ENDIF\n#ENDRANDOM',
    2,
  ],
])('conditional gameplay options compose like the resolved chart: %s', (headers, variables) => {
  const chart = parseBMS(`${headers}\n${notes}`);
  const compose = createOutcomeComposer(chart, OPTIONS);
  const outcomes: RandomDraws[] =
    variables === 1
      ? [1, 2].map((value) => [{ command: 'RANDOM', range: 2, value }])
      : [1, 2].flatMap((first) =>
          [1, 2].map((second): RandomDraws => [
            { command: 'RANDOM', range: 2, value: first },
            { command: 'RANDOM', range: 2, value: second },
          ]),
        );
  const expected = new Set<string>();
  for (const draws of outcomes) {
    const document = createPlayFingerprintDocument(resolveBMSControlFlowWithDraws(chart, draws), OPTIONS);
    expect(compose(draws)).toEqual(document);
    expected.add(JSON.stringify(document.playOptions ?? {}));
  }
  const expanded = new Set(
    expandChartFingerprintDocument(createChartFingerprintDocument(chart, OPTIONS)).map(({ document }) =>
      JSON.stringify(document.playOptions ?? {}),
    ),
  );
  expect(expanded).toEqual(expected);
  expect(expected.size).toBeGreaterThan(1);
});
