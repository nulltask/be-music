import { describe, expect, test } from 'vite-plus/test';
import { BEATORAJA_BUTTON } from '@be-music/skin-beatoraja';
import { BeatorajaSelectSkinState, type BeatorajaSelectSkinStateContext } from './skin-state.ts';

describe('select image-ref option indices', () => {
  test('reads the selected HS reference and zero-based LN override without changing MODE and SORT', () => {
    const ctx: BeatorajaSelectSkinStateContext = {
      options: { skin: { type: 5, w: 1280, h: 720 } },
      entries: [],
      currentIndex: 0,
      searchQuery: '',
      list: { keysFilter: 'ALL', sort: 'OFF' },
      lnModeOverride: 2,
      playOptions: { hsFix: 'MINBPM' },
      currentFolderLabel: () => '',
      lampOpOf: () => undefined,
      nowMs: () => 0,
    };
    const state = new BeatorajaSelectSkinState(ctx);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.LNMODE)).toBe(2);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.HSFIX)).toBe(4);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.MODE)).toBe(0);
    expect(state.resolveSelectionRefValue(BEATORAJA_BUTTON.SORT)).toBe(0);
  });
});
