import { describe, expect, it } from 'vite-plus/test';
import { createBeMusicSkinRegistry, resolveBeMusicLaneKind, resolveSelectListWindow } from './registry.ts';
import type { BeMusicSkin } from './types.ts';

function stubSkin(id: string): BeMusicSkin {
  return { id, label: id.toUpperCase() } as unknown as BeMusicSkin;
}

describe('createBeMusicSkinRegistry', () => {
  it('resolves by id and falls back to the first skin', () => {
    const registry = createBeMusicSkinRegistry([stubSkin('phantom'), stubSkin('synesthesia')]);
    expect(registry.resolve('synesthesia').id).toBe('synesthesia');
    expect(registry.resolve('missing').id).toBe('phantom');
    expect(registry.resolve(undefined).id).toBe('phantom');
  });

  it('rejects an empty list and duplicate ids', () => {
    expect(() => createBeMusicSkinRegistry([])).toThrow();
    expect(() => createBeMusicSkinRegistry([stubSkin('a'), stubSkin('a')])).toThrow(/duplicate/);
  });
});

describe('resolveBeMusicLaneKind', () => {
  it('follows the IIDX convention for 7-key charts', () => {
    expect(resolveBeMusicLaneKind('16', 0, '7')).toBe('scratch');
    expect(resolveBeMusicLaneKind('11', 1, '7')).toBe('white');
    expect(resolveBeMusicLaneKind('12', 2, '7')).toBe('black');
    expect(resolveBeMusicLaneKind('13', 3, '7')).toBe('white');
  });

  it('treats channel 16 as a normal key in 9-key charts', () => {
    expect(resolveBeMusicLaneKind('16', 6, '9')).not.toBe('scratch');
  });

  it('keeps unmapped lanes white', () => {
    expect(resolveBeMusicLaneKind('11', -1, '7')).toBe('white');
  });
});

describe('resolveSelectListWindow', () => {
  const layout = { listX: 320, listTop: 54, listBottomInset: 26, rowHeight: 28 };

  it('fits as many rows as the list height allows', () => {
    expect(resolveSelectListWindow(layout, 480, 0, 100).visibleRows).toBe(14);
  });

  it('centres the focused row and clamps at both ends', () => {
    expect(resolveSelectListWindow(layout, 480, 0, 100).firstVisibleIndex).toBe(0);
    expect(resolveSelectListWindow(layout, 480, 50, 100).firstVisibleIndex).toBe(43);
    expect(resolveSelectListWindow(layout, 480, 99, 100).firstVisibleIndex).toBe(86);
  });

  it('never scrolls a short list', () => {
    expect(resolveSelectListWindow(layout, 480, 5, 6).firstVisibleIndex).toBe(0);
  });
});
