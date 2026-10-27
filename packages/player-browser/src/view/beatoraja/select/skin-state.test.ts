import { describe, expect, test } from 'vite-plus/test';
import { BEATORAJA_BUTTON } from '@be-music/skin-beatoraja';
import { BeatorajaSelectSkinState, type BeatorajaSelectSkinStateContext } from './skin-state.ts';

describe('select image-ref option indices', () => {
  test('reads the selected HS reference, the LN MODE and the option buttons without changing MODE and SORT', () => {
    const ctx: BeatorajaSelectSkinStateContext = {
      options: { skin: { type: 5, w: 1280, h: 720 } },
      entries: [],
      currentIndex: 0,
      searchQuery: '',
      list: { keysFilter: 'ALL', sort: 'OFF' },
      playOptions: { hsFix: 'MINBPM', longNoteMode: 'HCN', gaugeAutoShift: 'BEST_CLEAR', battleMode: 'BATTLE' },
      currentFolderLabel: () => '',
      lampOpOf: () => undefined,
      nowMs: () => 0,
    };
    const state = new BeatorajaSelectSkinState(ctx);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.LNMODE)).toBe(2);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.HSFIX)).toBe(4);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.MODE)).toBe(0);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.SORT)).toBe(0);
    // gaugeautoshift (78) and optiondp (54).
    expect(state.resolveSelectionRefValue(78)).toBe(3);
    expect(state.resolveSelectionRefValue(54)).toBe(2);
  });
});

describe('select CONSTANT op', () => {
  const context = (visualConstant: boolean): BeatorajaSelectSkinStateContext => ({
    options: { skin: { type: 5, w: 1280, h: 720 } },
    entries: [],
    currentIndex: 0,
    searchQuery: '',
    list: { keysFilter: 'ALL', sort: 'OFF' },
    playOptions: { visualConstant },
    currentFolderLabel: () => '',
    lampOpOf: () => undefined,
    nowMs: () => 0,
  });

  test('lights OPTION_CONSTANT (400) while the player has Visual CONSTANT on', () => {
    expect(new BeatorajaSelectSkinState(context(true)).computeActiveOps().has(400)).toBe(true);
    expect(new BeatorajaSelectSkinState(context(false)).computeActiveOps().has(400)).toBe(false);
  });
});
