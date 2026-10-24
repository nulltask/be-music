import type { ChartPlayVariant } from '@be-music/chart-model';
import { resolvePlayVariantLaneChannels } from '@be-music/player-engine/lanes';
import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicLaneFrame } from '../../../skin/be-music/types.ts';
import type { PlayfieldContext } from './context.ts';
import { renderLanes } from './lanes.ts';

/** The fade the fake skin gives every lane's key beam, in ms. */
const FADE_MS = 100;

/** The lanes of `playVariant`: every lane of its layout (the PMS one for 9 KEY when `pms`). */
const lanesOf = (playVariant: ChartPlayVariant, pms = false): string[] =>
  resolvePlayVariantLaneChannels(pms ? [{ channel: '22' }] : [], playVariant);

/**
 * The lanes the shared playfield hands a be-music skin for `channels` of `playVariant` (every lane of its layout by
 * default), with the play's key beams as `beams` sets them, at `nowMs` on the play clock.
 */
function drawLanes(
  playVariant: ChartPlayVariant,
  beams: {
    pressed?: readonly string[];
    on?: ReadonlyArray<[string, number]>;
    fading?: ReadonlyArray<[string, number]>;
  },
  nowMs = 0,
  channels: string[] = lanesOf(playVariant),
  covers?: { side: '1P' | '2P'; sudden: number; hidden: number; lift: number }[],
): BeMusicLaneFrame[] {
  let drawn: BeMusicLaneFrame[] = [];
  const ctx = {
    play: {
      laneChannels: channels,
      chartPlayVariant: playVariant,
      laneX: new Map(),
      resolveLaneCovers: () => covers ?? [],
      pressedChannels: new Set(beams.pressed ?? []),
      keyBeamStartedAt: new Map(beams.on ?? []),
      keyBeamFadeStartedAt: new Map(beams.fading ?? []),
      lanePressedAt: new Map(),
      laneReleasedAt: new Map(),
      longNotes: { isHolding: () => false, holdStartedAtMs: () => undefined },
      playClock: () => nowMs,
      currentSeconds: () => 0,
      currentBeat: () => 0,
      playState: { combo: 0 },
    },
    layoutMode: 'standard',
    drawsLift: covers !== undefined,
    beMusicStage: undefined,
    laneGeometryCache: undefined,
    playfieldSkin: { ownsLanes: false, laneRect: () => undefined, keyOnFadeMs: () => FADE_MS },
    laneLayer: { clear: () => undefined },
    skinBinding: {
      addLanes: (lanes: BeMusicLaneFrame[]) => {
        drawn = lanes;
      },
    },
    options: {},
    audioFrame: undefined,
  } as unknown as PlayfieldContext;
  renderLanes(ctx, 1280, 720);
  return drawn;
}

const beamOf = (lanes: readonly BeMusicLaneFrame[], channel: string): number | undefined =>
  lanes.find((lane) => lane.channel === channel)?.beam;

describe("the shared playfield's key beams", () => {
  test("raises each side's lanes and beams with its own LIFT", () => {
    const normal = drawLanes('14', { pressed: ['11', '21'] });
    const lifted = drawLanes('14', { pressed: ['11', '21'] }, 0, lanesOf('14'), [
      { side: '1P', sudden: 0, hidden: 0, lift: 0.25 },
      { side: '2P', sudden: 0, hidden: 0, lift: 0.5 },
    ]);
    for (let index = 0; index < normal.length; index++) {
      const lane = normal[index]!;
      const scale = lane.channel.startsWith('2') ? 0.5 : 0.75;
      expect(lifted[index]).toMatchObject({
        top: lane.top,
        bottom: lane.top + (lane.bottom - lane.top) * scale,
        beam: lane.beam,
      });
    }
  });

  test('light every 24 / 48 KEY lane held down, the keys past the seventh and the wheel included', () => {
    for (const playVariant of ['24', '48'] as const) {
      const channels = lanesOf(playVariant);
      expect(channels).toEqual(expect.arrayContaining(['18', '19', '1A', '1O', '1P', '1Q']));
      const lanes = drawLanes(playVariant, { pressed: channels });
      expect(lanes.map((lane) => lane.channel)).toEqual(channels);
      for (const lane of lanes)
        expect({ channel: lane.channel, beam: lane.beam }).toEqual({ channel: lane.channel, beam: 1 });
    }
    expect(beamOf(drawLanes('48', { pressed: ['2O', '2Q'] }), '2O')).toBe(1);
    expect(beamOf(drawLanes('48', { pressed: ['2O', '2Q'] }), '2Q')).toBe(1);
  });

  test("fade a keyboard mode's later keys and wheel out as they fade its first key", () => {
    const lanes = drawLanes(
      '24',
      {
        on: [
          ['11', 0],
          ['1O', 0],
          ['1P', 0],
        ],
        fading: [
          ['11', 200],
          ['1O', 200],
          ['1P', 200],
        ],
      },
      200 + FADE_MS / 2,
    );
    expect(beamOf(lanes, '11')).toBeCloseTo(0.5);
    expect(beamOf(lanes, '1O')).toBeCloseTo(0.5);
    expect(beamOf(lanes, '1P')).toBeCloseTo(0.5);
    expect(beamOf(lanes, '1A')).toBe(0);
  });

  test('light the scratch and every key of the 5, 7, 10 and 14 KEY lanes, and all nine 9 KEY lanes', () => {
    const cases: Array<[ChartPlayVariant, string[]]> = [
      ['5', lanesOf('5')],
      ['7', lanesOf('7')],
      ['10', lanesOf('10')],
      ['14', lanesOf('14')],
      ['9', lanesOf('9')],
      ['9', lanesOf('9', true)],
    ];
    for (const [playVariant, channels] of cases) {
      const lanes = drawLanes(playVariant, { pressed: channels }, 0, channels);
      expect(lanes.map((lane) => lane.channel)).toEqual(channels);
      for (const lane of lanes)
        expect({ channel: lane.channel, beam: lane.beam }).toEqual({ channel: lane.channel, beam: 1 });
    }
    expect(lanesOf('14')).toEqual(expect.arrayContaining(['16', '18', '19', '26', '28', '29']));
    expect(lanesOf('9', true)).toEqual(expect.arrayContaining(['22', '23', '24', '25']));
  });
});
