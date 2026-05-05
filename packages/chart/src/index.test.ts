import { describe, expect, test } from 'vitest';
import {
  collectLnobjEndEvents,
  createBeatResolver,
  eventToBeat,
  getMeasureBeats,
  isBmsBgmVolumeChangeChannel,
  isBmsDynamicVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isBmsLongNoteChannel,
  isLandmineChannel,
  isPlayableChannel,
  isPlayLaneSoundChannel,
  isSampleTriggerChannel,
  isScrollChannel,
  isStopChannel,
  isTempoChannel,
  mapBmsLongNoteChannelToPlayable,
  measureToBeat,
  parseBmsArgb,
  parseBmsDynamicVolumeGain,
  parseBpmFrom03Token,
  resolveChartPlayVariant,
  resolveChartReferenceBpm,
  resolveBmsLongNotes,
  resolveLnobjLongNotes,
  sortEvents,
} from './index.ts';
import { createEmptyJson, type BeMusicEvent } from '../../json/src/index.ts';

describe('chart', () => {
  test('parseBpmFrom03Token decodes hexadecimal BPM tokens', () => {
    expect(parseBpmFrom03Token('7F')).toBe(127);
    expect(parseBpmFrom03Token('GG')).toBe(0);
  });

  test('getMeasureBeats returns the beat count for a measure length multiplier', () => {
    expect(getMeasureBeats(0.75)).toBe(3);
  });

  test('measureToBeat and eventToBeat reflect measure lengths', () => {
    const json = createEmptyJson();
    json.measures = [
      { index: 0, length: 1 },
      { index: 1, length: 0.5 },
    ];

    expect(measureToBeat(json, 0, 0)).toBe(0);
    expect(measureToBeat(json, 1, 0)).toBe(4);
    expect(measureToBeat(json, 1, 0.5)).toBe(5);
    expect(measureToBeat(json, 1, -1)).toBe(4);
    expect(measureToBeat(json, 1, 1)).toBeCloseTo(5.999999998, 9);

    const event: BeMusicEvent = {
      measure: 1,
      channel: '11',
      position: [1, 2],
      value: '01',
    };
    expect(eventToBeat(json, event)).toBe(5);
  });

  test('createBeatResolver resolves measureToBeat and eventToBeat efficiently', () => {
    const json = createEmptyJson();
    json.measures = [
      { index: 0, length: 1 },
      { index: 1, length: 0.5 },
      { index: 3, length: 2 },
    ];
    const resolver = createBeatResolver(json);

    expect(resolver.measureToBeat(1, 0.5)).toBe(5);
    expect(resolver.measureToBeat(5, 0)).toBe(22);
    expect(resolver.measureToBeat(-4, 0.5)).toBe(2);

    const event: BeMusicEvent = {
      measure: 3.9,
      channel: '11',
      position: [1, 4],
      value: '01',
    };
    expect(resolver.eventToBeat(event)).toBe(12);
  });

  test('createBeatResolver handles charts without explicit measure lengths', () => {
    const json = createEmptyJson();
    const resolver = createBeatResolver(json);

    expect(resolver.measureToBeat(3, 0.5)).toBe(14);
    expect(
      resolver.eventToBeat({
        measure: 2,
        channel: '11',
        position: [1, 4],
        value: '01',
      }),
    ).toBe(9);
  });

  test('sortEvents stabilizes by measure/position/channel/value order', () => {
    const events: BeMusicEvent[] = [
      { measure: 1, channel: '12', position: [1, 3], value: '02' },
      { measure: 0, channel: '11', position: [1, 2], value: '02' },
      { measure: 0, channel: '11', position: [1, 2], value: '01' },
      { measure: 0, channel: '12', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 3], value: '01' },
    ];

    const sorted = sortEvents(events);
    expect(
      sorted.map(
        (event) => `${event.measure}:${event.channel}:${event.position[0]}/${event.position[1]}:${event.value}`,
      ),
    ).toEqual(['0:12:0/1:01', '0:11:1/3:01', '0:11:1/2:01', '0:11:1/2:02', '1:12:1/3:02']);
  });

  test('sortEvents compares large denominators via the BigInt path', () => {
    const events: BeMusicEvent[] = [
      { measure: 0, channel: '11', position: [1, Number.MAX_SAFE_INTEGER], value: '01' },
      { measure: 0, channel: '11', position: [1, Number.MAX_SAFE_INTEGER - 1], value: '02' },
    ];
    const sorted = sortEvents(events);
    expect(sorted[0].value).toBe('01');
    expect(sorted[1].value).toBe('02');
  });

  test('resolveChartReferenceBpm prefers #BASEBPM over the chart #BPM', () => {
    // BMS spec — `#BASEBPM` (hitkey BMS Memo) is the chart-author
    // -declared HS-fix reference BPM. When set, scroll-speed
    // calibration MUST honour it instead of the chart's initial
    // `#BPM`, because that's the explicit author intent for the
    // scroll feel; `#BPM` is just where the chart starts ticking.
    const json = createEmptyJson();
    json.metadata.bpm = 200;
    json.bms.baseBpm = 130;
    expect(resolveChartReferenceBpm(json)).toBe(130);
  });

  test('resolveChartReferenceBpm falls back to metadata.bpm when #BASEBPM is absent', () => {
    const json = createEmptyJson();
    json.metadata.bpm = 145;
    expect(resolveChartReferenceBpm(json)).toBe(145);
  });

  test('resolveChartReferenceBpm honours the host fallback when nothing is declared', () => {
    // Charts that omit both `#BASEBPM` and `#BPM` are rare but
    // legal — typically partial / WIP fixtures. The host can
    // pass a song-list-cached BPM hint.
    const json = createEmptyJson();
    json.metadata.bpm = 0;
    expect(resolveChartReferenceBpm(json, 120)).toBe(120);
  });

  test('resolveChartReferenceBpm rejects non-positive #BASEBPM values', () => {
    // Defensive: `#BASEBPM 0` / negative parses can leak through
    // a malformed chart. We treat them as "unset" rather than
    // returning a divide-by-zero seed.
    const json = createEmptyJson();
    json.metadata.bpm = 140;
    json.bms.baseBpm = 0;
    expect(resolveChartReferenceBpm(json)).toBe(140);
    json.bms.baseBpm = -10;
    expect(resolveChartReferenceBpm(json)).toBe(140);
  });

  test('resolveChartReferenceBpm returns undefined when nothing positive is available', () => {
    const json = createEmptyJson();
    json.metadata.bpm = 0;
    expect(resolveChartReferenceBpm(json)).toBeUndefined();
  });

  test('parseBmsArgb decodes the AARRGGBB hex format the parser stores', () => {
    // Parser-level normalisation lands `#ARGB01 FF000000` here as
    // the bare hex string, since that's the dominant in-the-wild
    // format. AA = alpha (FF = fully opaque), then RR/GG/BB.
    expect(parseBmsArgb('FF000000')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsArgb('80a0b0c0')).toEqual({ a: 0x80, r: 0xa0, g: 0xb0, b: 0xc0 });
  });

  test('parseBmsArgb tolerates a leading "#" on hex inputs', () => {
    // Some chart authors write `#ARGB01 #FF000000` with a CSS-style
    // prefix; treat the `#` as decorative.
    expect(parseBmsArgb('#FF112233')).toEqual({ a: 255, r: 0x11, g: 0x22, b: 0x33 });
  });

  test('parseBmsArgb decodes comma-separated decimal A,R,G,B', () => {
    // The spec also lists the decimal form. Whitespace inside the
    // commas should be tolerated since chart authors hand-edit
    // these.
    expect(parseBmsArgb('255,0,0,0')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsArgb(' 128 , 32 , 64 , 96 ')).toEqual({ a: 128, r: 32, g: 64, b: 96 });
  });

  test('parseBmsArgb clamps decimal channel values to the byte range', () => {
    // Defensive — out-of-range inputs from a malformed chart shouldn't
    // produce alpha = 1.18 or a wrap-around RGB tint.
    expect(parseBmsArgb('300,-5,9999,128')).toEqual({ a: 255, r: 0, g: 255, b: 128 });
  });

  test('parseBmsArgb returns undefined for unrecognised / empty input', () => {
    expect(parseBmsArgb('')).toBeUndefined();
    expect(parseBmsArgb('   ')).toBeUndefined();
    expect(parseBmsArgb('not-an-argb')).toBeUndefined();
    // Hex of the wrong length isn't AARRGGBB.
    expect(parseBmsArgb('FFF')).toBeUndefined();
    expect(parseBmsArgb('FFFFFFFFFF')).toBeUndefined();
    // Wrong number of comma-separated channels.
    expect(parseBmsArgb('255,0,0')).toBeUndefined();
    expect(parseBmsArgb('1,2,3,4,5')).toBeUndefined();
  });

  test('classifies channel types', () => {
    expect(isTempoChannel('03')).toBe(true);
    expect(isTempoChannel('08')).toBe(true);
    expect(isTempoChannel('sc')).toBe(false);
    expect(isTempoChannel('11')).toBe(false);

    expect(isStopChannel('09')).toBe(true);
    expect(isStopChannel('19')).toBe(false);

    expect(isScrollChannel('SC')).toBe(true);
    expect(isScrollChannel('sc')).toBe(true);
    expect(isScrollChannel('11')).toBe(false);

    expect(isLandmineChannel('D1')).toBe(true);
    expect(isLandmineChannel('E9')).toBe(true);
    expect(isLandmineChannel('11')).toBe(false);
    expect(isLandmineChannel('D0')).toBe(false);

    expect(isSampleTriggerChannel('01')).toBe(true);
    expect(isSampleTriggerChannel('00')).toBe(false);
    expect(isSampleTriggerChannel('03')).toBe(false);
    expect(isSampleTriggerChannel('09')).toBe(false);
    expect(isSampleTriggerChannel('97')).toBe(false);
    expect(isSampleTriggerChannel('98')).toBe(false);
    expect(isSampleTriggerChannel('A0')).toBe(false);
    expect(isSampleTriggerChannel('SC')).toBe(false);
    expect(isSampleTriggerChannel('SP')).toBe(false);
    expect(isSampleTriggerChannel('11')).toBe(true);

    expect(isPlayableChannel('11')).toBe(true);
    expect(isPlayableChannel('21')).toBe(true);
    expect(isPlayableChannel('31')).toBe(false);
    expect(isPlayableChannel('01')).toBe(false);

    expect(isPlayLaneSoundChannel('11')).toBe(true);
    expect(isPlayLaneSoundChannel('29')).toBe(true);
    expect(isPlayLaneSoundChannel('31')).toBe(true);
    expect(isPlayLaneSoundChannel('48')).toBe(true);
    expect(isPlayLaneSoundChannel('51')).toBe(true);
    expect(isPlayLaneSoundChannel('61')).toBe(true);
    expect(isPlayLaneSoundChannel('01')).toBe(false);
    expect(isPlayLaneSoundChannel('A1')).toBe(false);

    expect(isBmsLongNoteChannel('51')).toBe(true);
    expect(isBmsLongNoteChannel('6a')).toBe(false);
    expect(isBmsLongNoteChannel('69')).toBe(true);
    expect(isBmsLongNoteChannel('5A')).toBe(false);
    expect(isBmsLongNoteChannel('11')).toBe(false);
    expect(mapBmsLongNoteChannelToPlayable('51')).toBe('11');
    expect(mapBmsLongNoteChannelToPlayable('61')).toBe('21');
    expect(mapBmsLongNoteChannelToPlayable('69')).toBe('29');
    expect(mapBmsLongNoteChannelToPlayable('5A')).toBeUndefined();

    expect(isBmsBgmVolumeChangeChannel('97')).toBe(true);
    expect(isBmsBgmVolumeChangeChannel('98')).toBe(false);
    expect(isBmsKeyVolumeChangeChannel('98')).toBe(true);
    expect(isBmsKeyVolumeChangeChannel('97')).toBe(false);
    expect(isBmsDynamicVolumeChangeChannel('97')).toBe(true);
    expect(isBmsDynamicVolumeChangeChannel('98')).toBe(true);
    expect(isBmsDynamicVolumeChangeChannel('11')).toBe(false);
    expect(parseBmsDynamicVolumeGain('80')).toBeCloseTo(0x80 / 0xff, 9);
    expect(parseBmsDynamicVolumeGain('00')).toBeUndefined();
    expect(parseBmsDynamicVolumeGain('GG')).toBeUndefined();
  });

  test('classifies normalized fallback inputs after trimming and case normalization', () => {
    expect(isScrollChannel(' sc ')).toBe(true);
    expect(isStopChannel(' 09 ')).toBe(true);
    expect(isPlayableChannel(' 11 ')).toBe(true);
    expect(isBmsLongNoteChannel(' 69 ')).toBe(true);
    expect(isSampleTriggerChannel(' a0 ')).toBe(false);
    expect(isBmsDynamicVolumeChangeChannel(' 98 ')).toBe(true);
    expect(mapBmsLongNoteChannelToPlayable(' 61 ')).toBe('21');
  });

  test('resolveChartPlayVariant classifies IIDX and PMS chart families', () => {
    const chart = (chartPath: string, channels: string[], player?: number) => ({
      chartPath,
      events: channels.map((channel) => ({ channel })),
      bms: { player },
    });

    expect(resolveChartPlayVariant(chart('main.bms', ['11', '12', '15']))).toBe('5');
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '15', '18', '19']))).toBe('7');
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '21', '25']))).toBe('10');
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '18', '21', '28']))).toBe('14');
    expect(resolveChartPlayVariant(chart('main.pms', ['11', '15', '22', '23', '24', '25']))).toBe('9');
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '15', '17', '18', '19'], 3))).toBe('9');
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '22', '23', '24', '25']))).toBe(
      '10',
    );
  });

  test('resolve long note helpers return empty results for non-BMS charts and missing LNOBJ markers', () => {
    const nonBms = createEmptyJson('json');
    const nonBmsLongNotes = resolveBmsLongNotes(nonBms);
    const nonBmsLnobj = resolveLnobjLongNotes(nonBms);
    expect(nonBmsLongNotes.notes).toEqual([]);
    expect(nonBmsLongNotes.suppressedTriggerEvents.size).toBe(0);
    expect(nonBmsLnobj.startToEndBeat.size).toBe(0);
    expect(nonBmsLnobj.endEvents.size).toBe(0);

    const bms = createEmptyJson('bms');
    bms.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const missingLnobj = resolveLnobjLongNotes(bms);
    expect(missingLnobj.startToEndBeat.size).toBe(0);
    expect(missingLnobj.endEvents.size).toBe(0);

    const noLongNoteChannels = resolveBmsLongNotes(bms);
    expect(noLongNoteChannels.notes).toEqual([]);
    expect(noLongNoteChannels.suppressedTriggerEvents.size).toBe(0);
  });

  test('collectLnobjEndEvents returns only paired LNOBJ end markers', () => {
    const json = createEmptyJson('bms');
    json.bms.lnObjs = ['AA'];
    const startA: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const endA: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'AA' };
    const sameBeatLnobj: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: 'AA' };
    const startB: BeMusicEvent = { measure: 0, channel: '12', position: [1, 2], value: '02' };
    const endB: BeMusicEvent = { measure: 0, channel: '12', position: [3, 4], value: 'AA' };
    const invisibleLnobj: BeMusicEvent = { measure: 0, channel: '31', position: [1, 1], value: 'AA' };
    json.events = [startA, endA, sameBeatLnobj, startB, endB, invisibleLnobj];

    const endEvents = collectLnobjEndEvents(json);
    expect(endEvents.size).toBe(2);
    expect(endEvents.has(endA)).toBe(true);
    expect(endEvents.has(endB)).toBe(true);
    expect(endEvents.has(sameBeatLnobj)).toBe(false);
    expect(endEvents.has(invisibleLnobj)).toBe(false);
  });

  test('resolveLnobjLongNotes accepts multiple LNOBJ declarations', () => {
    const json = createEmptyJson('bms');
    json.bms.lnObjs = ['AA', 'BB'];
    const startA: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const endA: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'AA' };
    const startB: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: '02' };
    const endB: BeMusicEvent = { measure: 0, channel: '12', position: [1, 4], value: 'BB' };
    json.events = [startA, endA, startB, endB];

    const resolved = resolveLnobjLongNotes(json);
    expect(resolved.endEvents.has(endA)).toBe(true);
    expect(resolved.endEvents.has(endB)).toBe(true);
    expect(resolved.startToEndBeat.get(startA)).toBeCloseTo(1, 6);
    expect(resolved.startToEndBeat.get(startB)).toBeCloseTo(1, 6);
  });

  test('resolveLnobjLongNotes treats `#BASE 62` LN-end IDs case-sensitively', () => {
    const json = createEmptyJson('bms');
    json.bms.base = 62;
    // Lowercase `aa` is a distinct ID from uppercase `AA` once the
    // chart opts into base-62. The resolver must match
    // case-sensitively so events tagged `aa` only mark the LN end
    // when the chart actually authored `#LNOBJ aa`.
    json.bms.lnObjs = ['aa'];
    const start: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const matchingLowerEnd: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'aa' };
    json.events = [start, matchingLowerEnd];

    const resolved = resolveLnobjLongNotes(json);
    expect(resolved.endEvents.has(matchingLowerEnd)).toBe(true);
    expect(resolved.startToEndBeat.get(start)).toBeCloseTo(1, 6);

    // And confirm an uppercase `AA` token does NOT close the LN
    // when only lowercase `aa` was registered as a marker.
    const startB: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: '02' };
    const wrongCaseEnd: BeMusicEvent = { measure: 0, channel: '12', position: [1, 4], value: 'AA' };
    json.events = [start, matchingLowerEnd, startB, wrongCaseEnd];
    const resolvedAgain = resolveLnobjLongNotes(json);
    expect(resolvedAgain.endEvents.has(wrongCaseEnd)).toBe(false);
    expect(resolvedAgain.startToEndBeat.get(startB)).toBeUndefined();
  });

  test('resolveLnobjLongNotes prioritizes 51-69 objects over LNOBJ at the same tick', () => {
    const json = createEmptyJson('bms');
    json.bms.lnObjs = ['AA'];
    const start: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const lnobjEnd: BeMusicEvent = { measure: 0, channel: '11', position: [2, 4], value: 'AA' };
    const legacyLongNote: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
    json.events = [start, lnobjEnd, legacyLongNote];

    const resolved = resolveLnobjLongNotes(json);
    expect(resolved.endEvents.has(lnobjEnd)).toBe(false);
    expect(resolved.startToEndBeat.get(start)).toBeUndefined();
  });

  test('resolveBmsLongNotes pairs 51-59 and 61-69 in LNTYPE=1 and suppresses end triggers', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 1;
    const startA: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const endA: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
    const orphanA: BeMusicEvent = { measure: 0, channel: '51', position: [3, 4], value: '03' };
    const startB: BeMusicEvent = { measure: 0, channel: '61', position: [1, 4], value: '04' };
    const endB: BeMusicEvent = { measure: 1, channel: '61', position: [1, 4], value: '05' };
    json.events = [startA, endA, orphanA, startB, endB];

    const resolved = resolveBmsLongNotes(json);
    expect(resolved.notes).toHaveLength(3);
    expect(resolved.notes[0]).toMatchObject({
      event: startA,
      sourceChannel: '51',
      channel: '11',
      beat: 0,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(resolved.notes[1]).toMatchObject({
      event: startB,
      sourceChannel: '61',
      channel: '21',
      beat: 1,
    });
    expect(resolved.notes[1]?.endBeat).toBeCloseTo(5, 6);
    expect(resolved.notes[2]).toMatchObject({
      event: orphanA,
      sourceChannel: '51',
      channel: '11',
      beat: 3,
    });
    expect(resolved.notes[2]?.endBeat).toBeUndefined();
    expect(resolved.suppressedTriggerEvents.has(endA)).toBe(true);
    expect(resolved.suppressedTriggerEvents.has(endB)).toBe(true);
    expect(resolved.suppressedTriggerEvents.has(startA)).toBe(false);
  });

  test('resolveBmsLongNotes defaults to LNTYPE=1 when #LNTYPE is omitted', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    const start: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const end: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
    json.events = [start, end];

    const resolved = resolveBmsLongNotes(json);
    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]).toMatchObject({
      event: start,
      channel: '11',
      beat: 0,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(resolved.suppressedTriggerEvents.has(end)).toBe(true);
  });

  test('resolveBmsLongNotes expands continuous tokens in LNTYPE=2 and suppresses continuation triggers', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 2;
    const runStart: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const runContinue: BeMusicEvent = { measure: 0, channel: '51', position: [1, 4], value: '01' };
    const secondRun: BeMusicEvent = { measure: 0, channel: '51', position: [3, 4], value: '01' };
    const crossStart: BeMusicEvent = { measure: 1, channel: '61', position: [3, 4], value: '02' };
    const crossContinue: BeMusicEvent = { measure: 2, channel: '61', position: [0, 4], value: '02' };
    json.events = [runStart, runContinue, secondRun, crossStart, crossContinue];

    const resolved = resolveBmsLongNotes(json);
    expect(resolved.notes).toHaveLength(3);
    expect(resolved.notes[0]).toMatchObject({
      event: runStart,
      sourceChannel: '51',
      channel: '11',
      beat: 0,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(resolved.notes[1]).toMatchObject({
      event: secondRun,
      sourceChannel: '51',
      channel: '11',
      beat: 3,
    });
    expect(resolved.notes[1]?.endBeat).toBeCloseTo(4, 6);
    expect(resolved.notes[2]).toMatchObject({
      event: crossStart,
      sourceChannel: '61',
      channel: '21',
      beat: 7,
    });
    expect(resolved.notes[2]?.endBeat).toBeCloseTo(9, 6);

    expect(resolved.suppressedTriggerEvents.has(runContinue)).toBe(true);
    expect(resolved.suppressedTriggerEvents.has(crossContinue)).toBe(true);
    expect(resolved.suppressedTriggerEvents.has(runStart)).toBe(false);
    expect(resolved.suppressedTriggerEvents.has(secondRun)).toBe(false);
  });

  test('resolveBmsLongNotes can infer LNTYPE=2 when #LNTYPE is omitted', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    const start: BeMusicEvent = { measure: 0, channel: '61', position: [0, 4], value: '01' };
    const contA: BeMusicEvent = { measure: 0, channel: '61', position: [1, 4], value: '01' };
    const contB: BeMusicEvent = { measure: 0, channel: '61', position: [2, 4], value: '01' };
    json.events = [start, contA, contB];

    const defaultResolved = resolveBmsLongNotes(json);
    expect(defaultResolved.notes).toHaveLength(2);
    expect(defaultResolved.notes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(defaultResolved.notes[1]?.endBeat).toBeUndefined();

    const inferredResolved = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });
    expect(inferredResolved.notes).toHaveLength(1);
    expect(inferredResolved.notes[0]).toMatchObject({
      event: start,
      sourceChannel: '61',
      channel: '21',
      beat: 0,
    });
    expect(inferredResolved.notes[0]?.endBeat).toBeCloseTo(3, 6);
    expect(inferredResolved.suppressedTriggerEvents.has(contA)).toBe(true);
    expect(inferredResolved.suppressedTriggerEvents.has(contB)).toBe(true);
  });

  test('resolveBmsLongNotes keeps LNTYPE=1 inference when events are not a type-2 continuation run', () => {
    const json = createEmptyJson('bms');
    const start: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const later: BeMusicEvent = { measure: 1, channel: '51', position: [1, 4], value: '01' };
    json.events = [start, later];

    const resolved = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });
    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]).toMatchObject({
      event: start,
      sourceChannel: '51',
      channel: '11',
      beat: 0,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(5, 6);
    expect(resolved.suppressedTriggerEvents.has(later)).toBe(true);
  });

  test('resolveBmsLongNotes keeps LNTYPE=1 inference for a two-event same-value pair', () => {
    const json = createEmptyJson('bms');
    const start: BeMusicEvent = { measure: 0, channel: '55', position: [0, 4], value: 'AA' };
    const end: BeMusicEvent = { measure: 0, channel: '55', position: [1, 4], value: 'AA' };
    json.events = [start, end];

    const resolved = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });

    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]).toMatchObject({
      event: start,
      sourceChannel: '55',
      channel: '15',
      beat: 0,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(resolved.suppressedTriggerEvents.has(end)).toBe(true);
  });

  test('resolveBmsLongNotes keeps LNTYPE=1 inference for a cross-measure same-value pair', () => {
    const json = createEmptyJson('bms');
    const start: BeMusicEvent = { measure: 0, channel: '55', position: [3, 4], value: 'AA' };
    const end: BeMusicEvent = { measure: 1, channel: '55', position: [0, 4], value: 'AA' };
    json.events = [start, end];

    const resolved = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });

    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]).toMatchObject({
      event: start,
      sourceChannel: '55',
      channel: '15',
      beat: 3,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(4, 6);
    expect(resolved.suppressedTriggerEvents.has(end)).toBe(true);
  });
});
