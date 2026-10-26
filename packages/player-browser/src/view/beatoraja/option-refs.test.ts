import { createEmptyJSON } from '@be-music/chart-source';
import { BEATORAJA_BUTTON } from '@be-music/skin-beatoraja';
import { describe, expect, test } from 'vite-plus/test';
import { chartOwnLongNoteMode, resolveBeatorajaOptionRef } from './option-refs.ts';

describe('beatoraja option images on the decide, play and result screens', () => {
  test("shows the chart's own LN mode, else the player's LN MODE", () => {
    const undefinedMode = createEmptyJSON('bms');
    const charge = createEmptyJSON('bms');
    charge.bms.lnMode = 2;
    expect(chartOwnLongNoteMode(undefinedMode)).toBeUndefined();
    expect(chartOwnLongNoteMode(charge)).toBe(2);
    const bmson = createEmptyJSON('bmson');
    expect(chartOwnLongNoteMode(bmson)).toBeUndefined();
    bmson.bmson.info.lnType = 3;
    expect(chartOwnLongNoteMode(bmson)).toBe(3);
    const playOptions = { longNoteMode: 'HCN' as const };
    expect(resolveBeatorajaOptionRef(BEATORAJA_BUTTON.LNMODE, { chart: charge, playOptions })).toBe(1);
    expect(resolveBeatorajaOptionRef(BEATORAJA_BUTTON.LNMODE, { chart: undefinedMode, playOptions })).toBe(2);
    expect(resolveBeatorajaOptionRef(BEATORAJA_BUTTON.LNMODE, { playOptions })).toBe(2);
  });

  test('reads the option buttons’ labels off the play options', () => {
    expect(resolveBeatorajaOptionRef(54, { playOptions: { battleMode: 'BATTLE-AS' } })).toBe(3);
    expect(resolveBeatorajaOptionRef(BEATORAJA_BUTTON.HSFIX, { playOptions: { hsFix: 'MAXBPM' } })).toBe(2);
    expect(resolveBeatorajaOptionRef(12345, {})).toBeUndefined();
  });
});
