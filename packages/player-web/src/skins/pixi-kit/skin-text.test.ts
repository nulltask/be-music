import { describe, expect, it } from 'vite-plus/test';
import { addHitArea, collectHitAreas } from './skin-text.ts';

describe('collectHitAreas', () => {
  it('gathers the hit areas declared while building', () => {
    const play = (): void => {};
    const hits = collectHitAreas(() => {
      addHitArea(10, 20, 30, 40, 'pointer', play);
    });
    expect(hits).toEqual([{ x: 10, y: 20, w: 30, h: 40, cursor: 'pointer', action: play }]);
  });

  it('ignores hit areas declared outside a build and keeps nested builds apart', () => {
    addHitArea(0, 0, 1, 1, 'pointer', () => {});
    const outer = collectHitAreas(() => {
      const inner = collectHitAreas(() => addHitArea(1, 1, 1, 1, 'text', () => {}));
      expect(inner).toHaveLength(1);
      addHitArea(2, 2, 2, 2, 'pointer', () => {});
    });
    expect(outer.map((hit) => hit.x)).toEqual([2]);
  });
});
