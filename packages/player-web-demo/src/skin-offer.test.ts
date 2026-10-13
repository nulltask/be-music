import { describe, expect, test } from 'vite-plus/test';
import { describeSkinOffer } from './skin-offer.ts';

describe('describeSkinOffer', () => {
  test('makes no offer without a skin', () => {
    expect(describeSkinOffer(new Set())).toBeUndefined();
    expect(describeSkinOffer(new Set(['default']))).toBeUndefined();
  });

  test('offers one skin, naming an LR2 theme when the drop named one', () => {
    expect(describeSkinOffer(new Set(['lr2']), ['LITONE5'])).toEqual({
      title: 'Use this skin?',
      message: 'The folder you dropped has the LR2 skin “LITONE5”. Play with it instead of the built-in skin?',
      options: [{ family: 'lr2', label: 'Use skin' }],
    });
    expect(describeSkinOffer(new Set(['beatoraja']))?.message).toBe(
      'The folder you dropped has a beatoraja skin. Play with it instead of the built-in skin?',
    );
  });

  test('offers each skin of a drop that has both, beatoraja first', () => {
    expect(describeSkinOffer(new Set(['lr2', 'beatoraja']))?.options).toEqual([
      { family: 'beatoraja', label: 'Use beatoraja skin' },
      { family: 'lr2', label: 'Use LR2 skin' },
    ]);
  });
});
