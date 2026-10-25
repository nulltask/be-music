import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { applyCourseLongNoteConstraint, applyUndefinedLongNoteMode } from './long-note.ts';

const LN = '#BPM 120\n#LNOBJ ZZ\n#00111:01\n#00211:ZZ';

test('an undefined long-note mode takes the player mode; a declared one keeps its own', () => {
  const undefinedMode = parseBMS(LN);
  expect(resolveChart(applyUndefinedLongNoteMode(undefinedMode, 3)).notes[0]!.lnMode).toBe(3);
  expect(undefinedMode.bms.lnMode).toBeUndefined();
  const declared = parseBMS(`#LNMODE 1\n${LN}`);
  expect(applyUndefinedLongNoteMode(declared, 2)).toBe(declared);
});

test('a course constraint is applied first, so the player mode no longer applies', () => {
  const constrained = applyCourseLongNoteConstraint(parseBMS(LN), ['cn']);
  expect(resolveChart(applyUndefinedLongNoteMode(constrained, 3)).notes[0]!.lnMode).toBe(2);
});
