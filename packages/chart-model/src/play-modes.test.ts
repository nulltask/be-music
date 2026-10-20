import { describe, expect, test } from 'vite-plus/test';
import {
  BMSON_MODE_HINT_LAYOUTS,
  PLAY_MODE_LAYOUTS,
  findPlayModeLane,
  getPlayModeLayouts,
  resolveBmsonModeHintLayout,
  resolvePlayLaneChannels,
  type PlayModeLayoutId,
} from './index.ts';

const channelsOf = (id: PlayModeLayoutId): string[] => PLAY_MODE_LAYOUTS[id].lanes.map((lane) => lane.channel);
const xTable = (hint: keyof typeof BMSON_MODE_HINT_LAYOUTS): Array<[number, string]> => [
  ...BMSON_MODE_HINT_LAYOUTS[hint].channelByX,
];

describe('play-mode table', () => {
  test('lists every layout left to right, with the scratch / wheel on its side’s outer edge', () => {
    expect(channelsOf('5')).toEqual(['16', '11', '12', '13', '14', '15']);
    expect(channelsOf('7')).toEqual(['16', '11', '12', '13', '14', '15', '18', '19']);
    expect(channelsOf('10')).toEqual(['16', '11', '12', '13', '14', '15', '21', '22', '23', '24', '25', '26']);
    expect(channelsOf('14')).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '21',
      '22',
      '23',
      '24',
      '25',
      '28',
      '29',
      '26',
    ]);
    expect(channelsOf('9-pms')).toEqual(['11', '12', '13', '14', '15', '22', '23', '24', '25']);
    expect(channelsOf('9-bme')).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19']);
    expect(channelsOf('24')).toHaveLength(26);
    expect(channelsOf('24').slice(0, 4)).toEqual(['1P', '1Q', '11', '12']);
    expect(channelsOf('24').at(-1)).toBe('1O');
    expect(channelsOf('48')).toHaveLength(52);
    expect(channelsOf('48').slice(24, 30)).toEqual(['1N', '1O', '21', '22', '23', '24']);
    expect(channelsOf('48').slice(-2)).toEqual(['2P', '2Q']);
  });

  test('gives each lane its kind, side, slot and tone', () => {
    expect(findPlayModeLane('7', '16')).toMatchObject({ kind: 'scratch', side: '1P', slot: 0 });
    expect(findPlayModeLane('7', '16')?.tone).toBeUndefined();
    expect(findPlayModeLane('7', '18')).toMatchObject({ kind: 'key', side: '1P', slot: 6, tone: 'black' });
    expect(findPlayModeLane('14', '29')).toMatchObject({ kind: 'key', side: '2P', slot: 7, tone: 'white' });
    expect(findPlayModeLane('14', '26')).toMatchObject({ kind: 'scratch', side: '2P', slot: 0 });
    // PMS-STD: keys 6..9 are authored on the 2P bank but belong to the one player.
    expect(findPlayModeLane('9', '22')).toMatchObject({ kind: 'key', side: '1P', slot: 6, tone: 'black' });
    // The BME-type 9 KEY layout plays `16` as key 6, not a scratch.
    expect(findPlayModeLane('9', '16')).toMatchObject({ kind: 'key', slot: 6 });
    expect(findPlayModeLane('24', '1P')).toMatchObject({ kind: 'wheel-up', side: '1P', slot: 25 });
    expect(findPlayModeLane('48', '2Q')).toMatchObject({ kind: 'wheel-down', side: '2P', slot: 26 });
    // Piano colours repeat every octave: C white, C# black, …, B white, then C again.
    const tones = PLAY_MODE_LAYOUTS['24'].lanes.filter((lane) => lane.kind === 'key').map((lane) => lane.tone);
    expect(tones.slice(0, 13)).toEqual([
      'white',
      'black',
      'white',
      'black',
      'white',
      'white',
      'black',
      'white',
      'black',
      'white',
      'black',
      'white',
      'white',
    ]);
    expect(findPlayModeLane('24', '1p')?.channel).toBe('1P');
    expect(findPlayModeLane('24', '21')).toBeUndefined();
    expect(findPlayModeLane('5', '18')).toBeUndefined();
  });

  test('keeps the IIDX FREE ZONE on its side’s scratch', () => {
    expect(PLAY_MODE_LAYOUTS['7'].freeZones).toEqual([{ channel: '17', scratch: '16' }]);
    expect(PLAY_MODE_LAYOUTS['14'].freeZones).toEqual([
      { channel: '17', scratch: '16' },
      { channel: '27', scratch: '26' },
    ]);
    expect(PLAY_MODE_LAYOUTS['9-bme'].freeZones).toEqual([]);
  });

  test('groups the layouts by play variant', () => {
    expect(getPlayModeLayouts('9').map((layout) => layout.id)).toEqual(['9-pms', '9-bme']);
    expect(getPlayModeLayouts('10').map((layout) => layout.label)).toEqual(['5 KEY DP']);
  });

  test('resolvePlayLaneChannels gives a lane every BMS object family on its lane code', () => {
    expect(resolvePlayLaneChannels('16')).toEqual({ visible: '16', invisible: '36', longNote: '56', mine: 'D6' });
    expect(resolvePlayLaneChannels('2a')).toEqual({ visible: '2A', invisible: '4A', longNote: '6A', mine: 'EA' });
    expect(resolvePlayLaneChannels('2Q')).toEqual({ visible: '2Q', invisible: '4Q', longNote: '6Q', mine: 'EQ' });
    expect(resolvePlayLaneChannels('01')).toBeUndefined();
    expect(resolvePlayLaneChannels('10')).toBeUndefined();
    expect(PLAY_MODE_LAYOUTS['48'].lanes.at(-1)?.channels).toEqual({
      visible: '2Q',
      invisible: '4Q',
      longNote: '6Q',
      mine: 'EQ',
    });
  });
});

describe('bmson mode_hint lane tables', () => {
  test('beat-7k / beat-14k: keys on x 1..7, the scratch on x 8, the 2P side from x 9', () => {
    expect(xTable('beat-7k')).toEqual([
      [1, '11'],
      [2, '12'],
      [3, '13'],
      [4, '14'],
      [5, '15'],
      [6, '18'],
      [7, '19'],
      [8, '16'],
    ]);
    expect(xTable('beat-14k').slice(8)).toEqual([
      [9, '21'],
      [10, '22'],
      [11, '23'],
      [12, '24'],
      [13, '25'],
      [14, '28'],
      [15, '29'],
      [16, '26'],
    ]);
  });

  test('beat-5k / beat-10k: the scratch stays on x 8 / 16 and x 6 / 7 / 14 / 15 have no lane (bmson spec, beatoraja)', () => {
    // bmson spec `doc/index.rst` L825 / L827 and jbms-parser BMSONDecoder's `keyassign` ({0..4, -1, -1, 5, …}).
    expect(xTable('beat-5k')).toEqual([
      [1, '11'],
      [2, '12'],
      [3, '13'],
      [4, '14'],
      [5, '15'],
      [8, '16'],
    ]);
    expect(BMSON_MODE_HINT_LAYOUTS['beat-5k'].width).toBe(8);
    expect(xTable('beat-10k')).toEqual([
      [1, '11'],
      [2, '12'],
      [3, '13'],
      [4, '14'],
      [5, '15'],
      [8, '16'],
      [9, '21'],
      [10, '22'],
      [11, '23'],
      [12, '24'],
      [13, '25'],
      [16, '26'],
    ]);
    expect(BMSON_MODE_HINT_LAYOUTS['beat-10k'].width).toBe(16);
  });

  test('popn-5k / popn-9k use the PMS-STD lanes', () => {
    expect(xTable('popn-5k').map(([, channel]) => channel)).toEqual(['11', '12', '13', '14', '15']);
    expect(BMSON_MODE_HINT_LAYOUTS['popn-5k'].width).toBe(5);
    expect(xTable('popn-9k')).toEqual([
      [1, '11'],
      [2, '12'],
      [3, '13'],
      [4, '14'],
      [5, '15'],
      [6, '22'],
      [7, '23'],
      [8, '24'],
      [9, '25'],
    ]);
  });

  test('keyboard-24k(-double): keys on x 1..24, the wheel on 25 / 26, the 2P side from x 27', () => {
    const single = BMSON_MODE_HINT_LAYOUTS['keyboard-24k'];
    expect(single.width).toBe(26);
    expect([1, 9, 10, 24, 25, 26].map((x) => single.channelByX.get(x))).toEqual(['11', '19', '1A', '1O', '1P', '1Q']);
    const double = BMSON_MODE_HINT_LAYOUTS['keyboard-24k-double'];
    expect(double.width).toBe(52);
    expect([27, 40, 51, 52].map((x) => double.channelByX.get(x))).toEqual(['21', '2E', '2P', '2Q']);
    expect(double.xByChannel.get('2Q')).toBe(52);
  });

  test('xByChannel inverts channelByX for every hint', () => {
    for (const layout of Object.values(BMSON_MODE_HINT_LAYOUTS)) {
      for (const [x, channel] of layout.channelByX) {
        expect(layout.xByChannel.get(channel)).toBe(x);
      }
      expect(layout.xByChannel.size).toBe(layout.channelByX.size);
    }
  });

  test('every layout with a hint maps each of its lanes', () => {
    for (const layout of Object.values(PLAY_MODE_LAYOUTS)) {
      if (layout.bmsonModeHint === undefined) continue;
      const hint = BMSON_MODE_HINT_LAYOUTS[layout.bmsonModeHint];
      expect(layout.lanes.map((lane) => hint.xByChannel.has(lane.channel))).not.toContain(false);
    }
  });

  test('resolveBmsonModeHintLayout trims the hint and ignores hints without a table', () => {
    expect(resolveBmsonModeHintLayout(' beat-10k ')?.modeHint).toBe('beat-10k');
    expect(resolveBmsonModeHintLayout('keyboard-48k')).toBeUndefined();
    expect(resolveBmsonModeHintLayout('generic-6keys')).toBeUndefined();
    expect(resolveBmsonModeHintLayout('toString')).toBeUndefined();
    expect(resolveBmsonModeHintLayout(undefined)).toBeUndefined();
  });
});
