import { describe, expect, test } from 'vitest';
import {
  createLaneBindings,
  resolveLaneChannels,
  resolveLaneDisplayMode,
  resolveLr2LaneIndex,
  resolveSideKeySlot,
  resolveSideRelativeLaneIndex,
} from './lane-layout.ts';

describe('resolveSideKeySlot', () => {
  test('IIDX-side default — 11..15 → 1..5, 16/26 → 0 (scratch), 18/19 → 6/7', () => {
    expect(resolveSideKeySlot('11')).toBe(1);
    expect(resolveSideKeySlot('15')).toBe(5);
    expect(resolveSideKeySlot('16')).toBe(0);
    expect(resolveSideKeySlot('26')).toBe(0);
    expect(resolveSideKeySlot('18')).toBe(6);
    expect(resolveSideKeySlot('19')).toBe(7);
  });

  test('PMS / 9 KEY (COMPAT) — 11..19 each map to lane slots 1..9', () => {
    // Channels 16, 17, 18, 19 are LANE NOTES under 9KEY-COMPAT (not scratch / FREE ZONE), so they get distinct slots 6,
    // 7, 8, 9 — matching `play_9.lr2skin`'s `#SRC_NOTE,1..9`.
    expect(resolveSideKeySlot('11', '9')).toBe(1);
    expect(resolveSideKeySlot('15', '9')).toBe(5);
    expect(resolveSideKeySlot('16', '9')).toBe(6);
    expect(resolveSideKeySlot('17', '9')).toBe(7);
    expect(resolveSideKeySlot('18', '9')).toBe(8);
    expect(resolveSideKeySlot('19', '9')).toBe(9);
  });

  test('PMS / 9 KEY (STD) — 22..25 map to slots 6..9 of the 1P-side bank', () => {
    expect(resolveSideKeySlot('22', '9')).toBe(6);
    expect(resolveSideKeySlot('23', '9')).toBe(7);
    expect(resolveSideKeySlot('24', '9')).toBe(8);
    expect(resolveSideKeySlot('25', '9')).toBe(9);
    // Channels outside the PMS-STD 22..25 band on the 2P side are rejected — there's no `#SRC_NOTE` slot for them.
    expect(resolveSideKeySlot('21', '9')).toBe(-1);
    expect(resolveSideKeySlot('28', '9')).toBe(-1);
  });

  test('5 KEY / 10 KEY — channels 18/19 (and 28/29) reject (no 6/7-key columns)', () => {
    // 5K SP: keys 1..5 + scratch on 1P side. Channels 18/19 are not valid lane notes.
    expect(resolveSideKeySlot('11', '5')).toBe(1);
    expect(resolveSideKeySlot('15', '5')).toBe(5);
    expect(resolveSideKeySlot('16', '5')).toBe(0);
    expect(resolveSideKeySlot('18', '5')).toBe(-1);
    expect(resolveSideKeySlot('19', '5')).toBe(-1);
    // 10K DP: 5 keys + scratch per side. Same rejection on 2P side.
    expect(resolveSideKeySlot('21', '10')).toBe(1);
    expect(resolveSideKeySlot('25', '10')).toBe(5);
    expect(resolveSideKeySlot('26', '10')).toBe(0);
    expect(resolveSideKeySlot('28', '10')).toBe(-1);
    expect(resolveSideKeySlot('29', '10')).toBe(-1);
  });

  test('7 KEY / 14 KEY — channels 18/19 stay valid (= slots 6/7)', () => {
    // Sanity: the 5K-family clamp doesn't accidentally affect the 7K-family (where 18/19 ARE
    // the 6/7-key columns). Without this regression test the clamp would silently break
    // 7K play if someone misclassified the variant guard.
    expect(resolveSideKeySlot('18', '7')).toBe(6);
    expect(resolveSideKeySlot('19', '7')).toBe(7);
    expect(resolveSideKeySlot('28', '14')).toBe(6);
    expect(resolveSideKeySlot('29', '14')).toBe(7);
    // Default (variant unset) keeps the legacy `'7'`-equivalent behavior — pre-existing callers
    // that don't pass a variant still resolve 18/19 to 6/7 (matches the prior contract).
    expect(resolveSideKeySlot('18')).toBe(6);
    expect(resolveSideKeySlot('19')).toBe(7);
  });
});

describe('24 KEY / 48 KEY keyboard modes', () => {
  const SP_CHANNELS = [...'123456789ABCDEFGHIJKLMNO'].map((lane) => `1${lane}`);
  const DP_CHANNELS = [...SP_CHANNELS, ...[...'123456789ABCDEFGHIJKLMNO'].map((lane) => `2${lane}`)];

  test('resolveSideKeySlot — the 24 columns are plain 1-based lane indices, with no scratch', () => {
    expect(resolveSideKeySlot('11', '24')).toBe(1);
    expect(resolveSideKeySlot('19', '24')).toBe(9);
    expect(resolveSideKeySlot('1A', '24')).toBe(10);
    expect(resolveSideKeySlot('1O', '24')).toBe(24);
    // `16` / `17` are ordinary lanes here — never scratch (slot 0) or FREE ZONE.
    expect(resolveSideKeySlot('16', '24')).toBe(6);
    expect(resolveSideKeySlot('17', '24')).toBe(7);
    // Slot 0 is what `isScratchLaneForVariant` keys off; no keyboard-mode channel may produce it.
    expect(SP_CHANNELS.map((channel) => resolveSideKeySlot(channel, '24'))).not.toContain(0);
    // The 2P bank uses the same side-relative slots under `'48'`.
    expect(resolveSideKeySlot('21', '48')).toBe(1);
    expect(resolveSideKeySlot('2O', '48')).toBe(24);
    // Past the 24-column bank (`1P` = lane 25) and non-lane channels are rejected.
    expect(resolveSideKeySlot('1P', '24')).toBe(-1);
    expect(resolveSideKeySlot('D1', '24')).toBe(-1);
  });

  test('resolveLr2LaneIndex — keyboard modes have no LR2 lane rects, so every channel reports -1', () => {
    // LR2 only defines the 20 IIDX rects; returning -1 sends these charts to the fallback playfield
    // instead of squeezing 24 lanes into the 7-key rect table.
    expect(resolveLr2LaneIndex('11', '24')).toBe(-1);
    expect(resolveLr2LaneIndex('1O', '24')).toBe(-1);
    expect(resolveLr2LaneIndex('2A', '48')).toBe(-1);
  });

  test('resolveLaneChannels — lanes render in ascending column order, 1P bank before 2P', () => {
    const notes = [{ channel: '1O' }, { channel: '11' }, { channel: '1A' }, { channel: '19' }];
    expect(resolveLaneChannels(notes, '24')).toEqual(['11', '19', '1A', '1O']);
    expect(
      resolveLaneChannels(
        DP_CHANNELS.map((channel) => ({ channel })),
        '48',
      ),
    ).toEqual(DP_CHANNELS);
  });

  test('resolveLaneDisplayMode — extended lane channels select the keyboard modes', () => {
    expect(resolveLaneDisplayMode(SP_CHANNELS)).toBe('24 KEY SP');
    expect(resolveLaneDisplayMode(DP_CHANNELS)).toBe('48 KEY DP');
    // A `.bme` extension would otherwise mean 7 KEY SP; one extended column outranks it.
    expect(resolveLaneDisplayMode(['11', '18', '1A'], { chartExtension: '.bme' })).toBe('24 KEY SP');
    // Host override reaches the same modes without any extended channel present.
    expect(resolveLaneDisplayMode(['11', '12'], { playVariant: '24' })).toBe('24 KEY SP');
    expect(resolveLaneDisplayMode(['11', '21'], { playVariant: '48' })).toBe('48 KEY DP');
  });

  test('createLaneBindings — every column gets its own key, none of them scratch', () => {
    const bindings = createLaneBindings(SP_CHANNELS, { playVariant: '24' });
    expect(bindings.map((binding) => binding.channel)).toEqual(SP_CHANNELS);
    expect(bindings.every((binding) => binding.side === '1P')).toBe(true);
    expect(bindings.some((binding) => binding.isScratch)).toBe(false);
    expect(new Set(bindings.flatMap((binding) => binding.inputTokens)).size).toBe(24);

    const dpBindings = createLaneBindings(DP_CHANNELS, { playVariant: '48' });
    expect(dpBindings.map((binding) => binding.channel)).toEqual(DP_CHANNELS);
    expect(dpBindings.filter((binding) => binding.side === '2P')).toHaveLength(24);
    // 48 lanes outrun the printable-key pool, so the tail falls back to function keys — still unique.
    expect(new Set(dpBindings.flatMap((binding) => binding.inputTokens)).size).toBe(48);
  });
});

describe('resolveLr2LaneIndex', () => {
  test('IIDX-side — 1P stays at 0..7, 2P offsets by 10', () => {
    expect(resolveLr2LaneIndex('11')).toBe(1);
    expect(resolveLr2LaneIndex('16')).toBe(0);
    expect(resolveLr2LaneIndex('19')).toBe(7);
    expect(resolveLr2LaneIndex('21')).toBe(11);
    expect(resolveLr2LaneIndex('26')).toBe(10);
    expect(resolveLr2LaneIndex('29')).toBe(17);
  });

  test('PMS / 9 KEY — single-side; both layouts collapse onto slots 1..9', () => {
    // COMPAT
    expect(resolveLr2LaneIndex('11', '9')).toBe(1);
    expect(resolveLr2LaneIndex('17', '9')).toBe(7);
    expect(resolveLr2LaneIndex('19', '9')).toBe(9);
    // STD
    expect(resolveLr2LaneIndex('22', '9')).toBe(6);
    expect(resolveLr2LaneIndex('25', '9')).toBe(9);
  });
});

describe('resolveLaneChannels', () => {
  test('IIDX default — `17` and unsupported channels are filtered out', () => {
    const notes = [
      { channel: '11' },
      { channel: '15' },
      { channel: '17' }, // FREE ZONE on IIDX-side — should NOT participate
      { channel: '18' },
      { channel: '19' },
    ];
    expect(resolveLaneChannels(notes)).toEqual(['11', '15', '18', '19']);
  });

  test('PMS / 9 KEY — `17` is a lane note and joins the rendered set', () => {
    const notes = [
      { channel: '11' },
      { channel: '12' },
      { channel: '13' },
      { channel: '14' },
      { channel: '15' },
      { channel: '16' },
      { channel: '17' },
      { channel: '18' },
      { channel: '19' },
    ];
    // Order: 11..19 — the 9 lanes of the PMS-COMPAT layout in left-to-right rendering order.
    expect(resolveLaneChannels(notes, '9')).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19']);
  });

  test('PMS / 9 KEY (STD) — 22..25 join the 1P-side rendering set', () => {
    const notes = [{ channel: '11' }, { channel: '15' }, { channel: '22' }, { channel: '25' }];
    expect(resolveLaneChannels(notes, '9')).toEqual(['11', '15', '22', '25']);
  });
});

describe('lane mode `playVariant` host override (PlayerOptions.playVariant)', () => {
  test('forces 9-key bindings on a `.bme` chart authored with #PLAYER 1 + channels 16/17/18/19', () => {
    // BME-format POPN-9 charts that authored `#PLAYER 1` and used channels 16/17/18/19 fell
    // through the content-based heuristic to `7-key-sp`, dropping channel 17 from
    // `scorableNotes` (FREE ZONE clamp) and binding f/v to 18/19 only (no g/b). User-reported
    // symptom: 9 KEY laser and bomb sprites failed to appear. With the host's
    // `playVariant: '9'` override,
    // the engine routes those channels through POPN-9 bindings regardless of the heuristic.
    const channels = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
    const withOverride = createLaneBindings(channels, { player: 1, chartExtension: '.bme', playVariant: '9' });
    // POPN_9KEY_BME_BINDINGS — channels 16/17/18/19 map to f/v/g/b respectively.
    const ch16 = withOverride.find((b) => b.channel === '16');
    const ch17 = withOverride.find((b) => b.channel === '17');
    const ch18 = withOverride.find((b) => b.channel === '18');
    const ch19 = withOverride.find((b) => b.channel === '19');
    expect(ch16?.keyLabel).toBe('f');
    expect(ch17?.keyLabel).toBe('v');
    expect(ch18?.keyLabel).toBe('g');
    expect(ch19?.keyLabel).toBe('b');
    expect(ch16?.isScratch).toBe(false);

    // Without the override, the same chart hits the 7-key-sp fallback — channel 16 becomes
    // scratch and channels 17/18/19 lose the POPN-9 f/v/g/b bindings entirely.
    const withoutOverride = createLaneBindings(channels, { player: 1, chartExtension: '.bme' });
    const ch16NoOverride = withoutOverride.find((b) => b.channel === '16');
    expect(ch16NoOverride?.isScratch).toBe(true);
  });

  test('respects the override even when chart channels are inconsistent with the variant', () => {
    // A 9-key chart that happens to use only channels 11..15 (no 16/17/18/19) is still
    // 9-key per the host's classification; the override prevents the heuristic from
    // downgrading it to 5-key.
    const channels = ['11', '12', '13', '14', '15'];
    const mode = resolveLaneDisplayMode(channels, { player: 1, chartExtension: '.bms', playVariant: '9' });
    expect(mode).toContain('9 KEY');
  });

  test('host-provided override wins over the chart-extension heuristic', () => {
    // `.bms` chart with PLAYER 1 normally classifies as `5-key-sp`. With `playVariant: '7'`
    // the override re-routes to `7-key-sp`. (Use case: a host that wants to play a 5-key
    // chart with 7-key controls; rare, but the API supports it.)
    const channels = ['11', '12', '13', '14', '15'];
    const mode = resolveLaneDisplayMode(channels, { player: 1, chartExtension: '.bms', playVariant: '7' });
    expect(mode).toBe('7 KEY SP');
  });
});

describe('resolveSideRelativeLaneIndex', () => {
  test('IIDX — collapses to side-relative 0..7', () => {
    expect(resolveSideRelativeLaneIndex('11')).toBe(1);
    expect(resolveSideRelativeLaneIndex('21')).toBe(1);
    expect(resolveSideRelativeLaneIndex('19')).toBe(7);
    expect(resolveSideRelativeLaneIndex('29')).toBe(7);
  });

  test('PMS / 9 KEY — both layouts produce slots 1..9', () => {
    expect(resolveSideRelativeLaneIndex('17', '9')).toBe(7);
    expect(resolveSideRelativeLaneIndex('22', '9')).toBe(6);
    expect(resolveSideRelativeLaneIndex('25', '9')).toBe(9);
  });
});
