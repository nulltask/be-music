import { describe, expect, it } from 'vite-plus/test';
import { createBeMusicSkinRegistry, resolveBeMusicLaneKind, resolveSelectListWindow } from './registry.ts';
import type { BeMusicSkin } from './types.ts';

function stubSkin(id: string, apiVersion = 1): BeMusicSkin {
  return {
    apiVersion,
    id,
    label: id.toUpperCase(),
    version: '1.0.0',
    author: { name: 'be-music' },
  } as unknown as BeMusicSkin;
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

  it('leaves out skins for an unsupported API revision and reports them', () => {
    const rejected: string[] = [];
    const registry = createBeMusicSkinRegistry([stubSkin('future', 2), stubSkin('phantom')], {
      onRejected: (skin, problems) => rejected.push(`${skin.id}: ${problems[0]}`),
    });
    expect(registry.skins.map((skin) => skin.id)).toEqual(['phantom']);
    expect(registry.resolve('future').id).toBe('phantom');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatch(/^future: apiVersion 2/u);
  });

  it('adds skins later, replacing one with the same id, and notifies subscribers', () => {
    const registry = createBeMusicSkinRegistry([stubSkin('phantom')]);
    let changes = 0;
    const stop = registry.subscribe(() => {
      changes += 1;
    });
    expect(registry.add(stubSkin('lattice'))).toEqual([]);
    expect(registry.skins.map((skin) => skin.id)).toEqual(['phantom', 'lattice']);
    expect(registry.resolve('lattice').id).toBe('lattice');
    const replacement = { ...stubSkin('lattice'), label: 'Lattice 2' } as BeMusicSkin;
    expect(registry.add(replacement)).toEqual([]);
    expect(registry.skins).toHaveLength(2);
    expect(registry.resolve('lattice').label).toBe('Lattice 2');
    expect(changes).toBe(2);
    stop();
    registry.add(stubSkin('neon'));
    expect(changes).toBe(2);
  });

  it('refuses to add an invalid skin and reports why', () => {
    const registry = createBeMusicSkinRegistry([stubSkin('phantom')]);
    const problems = registry.add(stubSkin('future', 2));
    expect(problems[0]).toMatch(/apiVersion 2/u);
    expect(registry.skins.map((skin) => skin.id)).toEqual(['phantom']);
  });

  it('throws when no skin is valid', () => {
    expect(() => createBeMusicSkinRegistry([stubSkin('future', 2)], { onRejected: () => {} })).toThrow(/valid/u);
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
