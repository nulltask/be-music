import { describe, expect, test } from 'vite-plus/test';
import { buildGamepadGuide } from './gamepad-guide.ts';

const keysOf = (rows: ReturnType<typeof buildGamepadGuide>['standard']) =>
  Object.fromEntries(rows.map((row) => [row.name, row.keys]));

describe('buildGamepadGuide', () => {
  test("lists a standard pad's and an IIDX controller's buttons on the select screen", () => {
    const guide = buildGamepadGuide('select');
    expect(keysOf(guide.standard)).toEqual({
      '1P key 2': ['LB / L1'],
      '1P key 3': ['X / □'],
      '1P key 4': ['RB / R1'],
      '1P key 5': ['A / ✕'],
      '1P key 6': ['Y / △'],
      '1P key 7': ['B / ○'],
      '1P turntable ↻': ['LT / L2'],
      '1P turntable ↺': ['RT / R2'],
      '1P START': ['Start / Options'],
      '1P SELECT': ['Back / Share'],
      '↑ key': ['D-pad ↑'],
      '↓ key': ['D-pad ↓'],
      '← key': ['D-pad ←'],
      '→ key': ['D-pad →'],
    });
    expect(keysOf(guide.iidx)).toMatchObject({
      '1P key 1': ['Button 1'],
      '1P key 7': ['Button 7'],
      '1P turntable ↻': ['Turntable ↻'],
      '1P START': ['E1'],
      '1P SELECT': ['E2'],
    });
  });

  test('lists the D-pad as key 1 in a play, without START or SELECT', () => {
    const guide = buildGamepadGuide('play', 'ja');
    const standard = keysOf(guide.standard);
    expect(standard['1P 鍵盤 1']).toEqual(['十字キー']);
    expect(standard['1P START']).toBeUndefined();
    expect(keysOf(guide.iidx)['1P START']).toBeUndefined();
    expect(keysOf(guide.iidx)['1P 皿 ↺']).toEqual(['ターンテーブル ↺']);
  });

  test('lists nothing for the keys of every screen', () => {
    expect(buildGamepadGuide('global')).toEqual({ standard: [], iidx: [] });
  });
});
