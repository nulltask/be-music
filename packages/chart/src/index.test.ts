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
  collectBmsExWavVolumeMultipliers,
  collectBmsWavCmdVolumeMultipliers,
  exWavVolumeCentibelsToLinearGain,
  parseBmsArgb,
  parseBmsBga,
  parseBmsDynamicVolumeGain,
  parseBmsExBmp,
  parseBmsExWav,
  parseBmsSwBga,
  parseBmsWavCmd,
  pickSwitchingBgaFrame,
  resolveBmsBmpArgb,
  wavCmdVolumeByteToLinearGain,
  parseBpmFrom03Token,
  resolveChartPlayVariant,
  resolveChartReferenceBpm,
  resolveBmsLongNotes,
  resolveLnobjLongNotes,
  sortEvents,
  usesMonophonicWavPlayback,
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
    // BMS spec — `#BASEBPM` (hitkey BMS Memo) is the chart-author -declared HS-fix reference BPM. When set,
    // scroll-speed calibration MUST honor it instead of the chart's initial `#BPM`, because that's the explicit author
    // intent for the scroll feel; `#BPM` is just where the chart starts ticking.
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

  test('resolveChartReferenceBpm honors the host fallback when nothing is declared', () => {
    // Charts that omit both `#BASEBPM` and `#BPM` are rare but legal — typically partial / WIP fixtures. The host can
    // pass a song-list-cached BPM hint.
    const json = createEmptyJson();
    json.metadata.bpm = 0;
    expect(resolveChartReferenceBpm(json, 120)).toBe(120);
  });

  test('resolveChartReferenceBpm rejects non-positive #BASEBPM values', () => {
    // Defensive: `#BASEBPM 0` / negative parses can leak through a malformed chart. We treat them as "unset" rather
    // than returning a divide-by-zero seed.
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

  test('parseBmsExWav parses the standard pvf flag layout', () => {
    // Hitkey BMS Memo: `#EXWAVxx [flags] params filename`. `pvf 1024,-200,48000 sample.wav` → pan=1024, vol=-200 cB (≈
    // −2 dB), freq=48 kHz, filename `sample.wav`.
    expect(parseBmsExWav('pvf 1024,-200,48000 sample.wav')).toEqual({
      pan: 1024,
      volumeCentibels: -200,
      frequencyHz: 48000,
      filename: 'sample.wav',
    });
  });

  test('parseBmsExWav matches each flag character to its positional param', () => {
    // Flags can appear in any order; the values follow positionally.
    expect(parseBmsExWav('vp -100,500 hat.wav')).toMatchObject({
      volumeCentibels: -100,
      pan: 500,
      filename: 'hat.wav',
    });
    const onlyVol = parseBmsExWav('v 0 only-vol.wav');
    expect(onlyVol?.volumeCentibels).toBe(0);
    // Absent flags must remain undefined so the consumer can distinguish "explicitly authored 0" from "not authored at
    // all" — pan: 0 = center, vol: 0 cB = unity.
    expect(onlyVol?.pan).toBeUndefined();
    expect(onlyVol?.frequencyHz).toBeUndefined();
  });

  test('parseBmsExWav joins multi-token filenames back together', () => {
    // Charts can ship Windows-path-style names with spaces.
    expect(parseBmsExWav('v 0 my sample.wav')?.filename).toBe('my sample.wav');
  });

  test('parseBmsExWav returns undefined for malformed input', () => {
    expect(parseBmsExWav('')).toBeUndefined();
    // Missing the params or the filename token.
    expect(parseBmsExWav('pvf')).toBeUndefined();
    expect(parseBmsExWav('pvf 100,200,300')).toBeUndefined();
  });

  test('exWavVolumeCentibelsToLinearGain treats 0 cB as unity', () => {
    expect(exWavVolumeCentibelsToLinearGain(0)).toBe(1);
  });

  test('exWavVolumeCentibelsToLinearGain attenuates negative cB and boosts positive cB', () => {
    // -600 cB = -6 dB → ≈ 0.501 linear gain.
    expect(exWavVolumeCentibelsToLinearGain(-600)).toBeCloseTo(0.501, 3);
    // -2000 cB = -20 dB → ≈ 0.1.
    expect(exWavVolumeCentibelsToLinearGain(-2000)).toBeCloseTo(0.1, 3);
    // +600 cB = +6 dB → ≈ 1.995 linear gain.
    expect(exWavVolumeCentibelsToLinearGain(600)).toBeCloseTo(1.995, 3);
  });

  test('exWavVolumeCentibelsToLinearGain clamps absurd inputs', () => {
    // Pathological boost should clamp at +18 dB linear (≈ 8x).
    expect(exWavVolumeCentibelsToLinearGain(10_000)).toBe(8);
    // Non-finite input falls back to unity (no surprise change).
    expect(exWavVolumeCentibelsToLinearGain(Number.NaN)).toBe(1);
  });

  test('collectBmsExWavVolumeMultipliers ignores entries without a v flag', () => {
    const map = collectBmsExWavVolumeMultipliers({
      // Only `v`, no pan / freq — should produce a multiplier.
      '01': 'v -600 attenuated.wav',
      // Pan-only — must NOT contribute (no volume to apply).
      '02': 'p 1024 panned.wav',
      // pvf with `v 0` — unity is still recorded so the consumer sees the slot was deliberately authored.
      '03': 'pvf 1024,0,48000 unity.wav',
    });
    expect(map.get('01')).toBeCloseTo(0.501, 3);
    expect(map.has('02')).toBe(false);
    expect(map.get('03')).toBeCloseTo(1, 6);
  });

  test('parseBmsSwBga decodes "fr:tot:lp:ARGB N1 N2 …" animation directives', () => {
    // Hitkey BMS Memo: `fr` is in 1/100 sec, so `fr=10` → 100ms per frame. The optional ARGB field round-trips as a raw
    // string for downstream `parseBmsArgb` use.
    const parsed = parseBmsSwBga('10:5:1:FF000000 02 03 04 05 06');
    expect(parsed).toEqual({
      frameIntervalMs: 100,
      totalFrames: 5,
      loop: true,
      argbRaw: 'FF000000',
      frames: ['02', '03', '04', '05', '06'],
    });
  });

  test('parseBmsSwBga treats lp=0 as no-loop and ARGB as optional', () => {
    const parsed = parseBmsSwBga('5:3:0 0a 0b 0c');
    expect(parsed?.loop).toBe(false);
    expect(parsed?.argbRaw).toBeUndefined();
    expect(parsed?.frames).toEqual(['0A', '0B', '0C']);
  });

  test('parseBmsSwBga rejects malformed / non-positive headers', () => {
    expect(parseBmsSwBga('')).toBeUndefined();
    // No frame list.
    expect(parseBmsSwBga('10:5:1')).toBeUndefined();
    // Header missing fields.
    expect(parseBmsSwBga('10 02 03')).toBeUndefined();
    // Non-positive `fr` would divide by zero downstream.
    expect(parseBmsSwBga('0:5:1 02 03')).toBeUndefined();
    // Non-positive `tot`.
    expect(parseBmsSwBga('10:0:1 02 03')).toBeUndefined();
  });

  test('pickSwitchingBgaFrame walks the frame list at the authored interval', () => {
    const swBga = parseBmsSwBga('10:5:1 02 03 04 05 06')!;
    expect(pickSwitchingBgaFrame(swBga, 0)).toBe('02');
    expect(pickSwitchingBgaFrame(swBga, 99)).toBe('02'); // 99 ms < 100 ms threshold
    expect(pickSwitchingBgaFrame(swBga, 100)).toBe('03');
    expect(pickSwitchingBgaFrame(swBga, 350)).toBe('05');
    // After totalFrames the loop wraps back to frame 0.
    expect(pickSwitchingBgaFrame(swBga, 500)).toBe('02');
  });

  test('pickSwitchingBgaFrame holds the last frame when lp=0', () => {
    // With looping disabled, an `elapsedMs` past the authored duration must hold the final frame instead of wrapping to
    // frame 0 (which would cause a visual glitch at end).
    const swBga = parseBmsSwBga('10:3:0 02 03 04')!;
    expect(pickSwitchingBgaFrame(swBga, 0)).toBe('02');
    expect(pickSwitchingBgaFrame(swBga, 250)).toBe('04');
    expect(pickSwitchingBgaFrame(swBga, 5000)).toBe('04');
  });

  test('pickSwitchingBgaFrame cycles a slot list shorter than totalFrames', () => {
    // Author shipped only two frames but advertised tot=4. The hitkey-style behavior is to cycle within the authored
    // slot list while honoring the total-frame loop boundary.
    const swBga = parseBmsSwBga('10:4:1 02 03')!;
    expect(pickSwitchingBgaFrame(swBga, 0)).toBe('02');
    expect(pickSwitchingBgaFrame(swBga, 100)).toBe('03');
    expect(pickSwitchingBgaFrame(swBga, 200)).toBe('02');
    expect(pickSwitchingBgaFrame(swBga, 300)).toBe('03');
    expect(pickSwitchingBgaFrame(swBga, 400)).toBe('02');
  });

  test('parseBmsBga decodes "YY x1 y1 x2 y2 dx dy" sub-region directives', () => {
    // Hitkey BMS Memo: `#BGAxx YY x1 y1 x2 y2 dx dy` aliases slot `xx` to a rectangle pulled out of `#BMPYY`. Consumers
    // use this to compose sprite-sheet style animations.
    expect(parseBmsBga('02 0 0 256 256 0 0')).toEqual({
      sourceBmp: '02',
      sx: 0,
      sy: 0,
      ex: 256,
      ey: 256,
      dx: 0,
      dy: 0,
    });
    expect(parseBmsBga('0a 64 32 192 160 16 8')).toMatchObject({
      sourceBmp: '0A',
      sx: 64,
      sy: 32,
      ex: 192,
      ey: 160,
      dx: 16,
      dy: 8,
    });
  });

  test('parseBmsBga preserves base-62 source slot case', () => {
    expect(parseBmsBga('0a 0 0 64 64 0 0', 62)?.sourceBmp).toBe('0a');
  });

  test('parseBmsBga rejects malformed / degenerate inputs', () => {
    // Too few tokens — missing dx / dy.
    expect(parseBmsBga('02 0 0 256 256 0')).toBeUndefined();
    // Inverted rectangle — `ex <= sx` would produce a zero-area frame and divide-by-zero downstream.
    expect(parseBmsBga('02 100 0 50 256 0 0')).toBeUndefined();
    expect(parseBmsBga('02 0 100 256 50 0 0')).toBeUndefined();
    // Non-integer coordinate.
    expect(parseBmsBga('02 0 zero 256 256 0 0')).toBeUndefined();
    // Empty source slot.
    expect(parseBmsBga(' 0 0 256 256 0 0')).toBeUndefined();
  });

  test('parseBmsExBmp decodes "a,r,g,b,filename" with the ARGB tint applied', () => {
    // Hitkey BMS Memo: `#EXBMPxx a,r,g,b,filename`. The ARGB tuple should round-trip via the same `parseBmsArgb` parser
    // that `#ARGBxx` uses (so consumers don't carry two code paths for "what is this slot's tint?").
    const parsed = parseBmsExBmp('255,0,0,0,backdrop.bmp');
    expect(parsed?.filename).toBe('backdrop.bmp');
    expect(parsed?.argb).toEqual({ a: 255, r: 0, g: 0, b: 0 });
  });

  test('parseBmsExBmp surfaces filename even when the ARGB fields are blank', () => {
    // Some chart authors ship `#EXBMP01 ,,,,foo.bmp` as a way to declare the slot without yet picking a tint — the
    // consumer should still know which file to load and just skip the tint.
    const parsed = parseBmsExBmp(',,,,foo.bmp');
    expect(parsed?.filename).toBe('foo.bmp');
    expect(parsed?.argb).toBeUndefined();
  });

  test('parseBmsExBmp returns undefined for inputs missing the filename or with too few commas', () => {
    expect(parseBmsExBmp('')).toBeUndefined();
    // Only four commas — no filename token at all.
    expect(parseBmsExBmp('255,0,0,0')).toBeUndefined();
    // Filename present but blank after trimming.
    expect(parseBmsExBmp('255,0,0,0,   ')).toBeUndefined();
  });

  test('resolveBmsBmpArgb prefers an explicit #ARGBxx value over the embedded #EXBMPxx tuple', () => {
    // Both directives can target the same slot. `#ARGBxx` is the newer, more flexible form so chart authors expect it
    // to win when both are present.
    const json = createEmptyJson();
    json.bms.argb['01'] = 'FF112233';
    json.bms.exBmp['01'] = '255,0,0,0,backdrop.bmp';
    expect(resolveBmsBmpArgb(json, '01')).toEqual({ a: 255, r: 0x11, g: 0x22, b: 0x33 });
  });

  test('resolveBmsBmpArgb falls back to the #EXBMPxx tuple when #ARGBxx is absent', () => {
    const json = createEmptyJson();
    json.bms.exBmp['02'] = '128,255,0,0,red-tint.bmp';
    expect(resolveBmsBmpArgb(json, '02')).toEqual({ a: 128, r: 255, g: 0, b: 0 });
  });

  test('resolveBmsBmpArgb returns undefined when neither directive applies to the slot', () => {
    const json = createEmptyJson();
    expect(resolveBmsBmpArgb(json, '03')).toBeUndefined();
  });

  test('parseBmsArgb decodes the AARRGGBB hex format the parser stores', () => {
    // Parser-level normalization lands `#ARGB01 FF000000` here as the bare hex string, since that's the dominant
    // in-the-wild format. AA = alpha (FF = fully opaque), then RR/GG/BB.
    expect(parseBmsArgb('FF000000')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsArgb('80a0b0c0')).toEqual({ a: 0x80, r: 0xa0, g: 0xb0, b: 0xc0 });
  });

  test('parseBmsArgb tolerates a leading "#" on hex inputs', () => {
    // Some chart authors write `#ARGB01 #FF000000` with a CSS-style prefix; treat the `#` as decorative.
    expect(parseBmsArgb('#FF112233')).toEqual({ a: 255, r: 0x11, g: 0x22, b: 0x33 });
  });

  test('parseBmsArgb decodes comma-separated decimal A,R,G,B', () => {
    // The spec also lists the decimal form. Whitespace inside the commas should be tolerated since chart authors
    // hand-edit these.
    expect(parseBmsArgb('255,0,0,0')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsArgb(' 128 , 32 , 64 , 96 ')).toEqual({ a: 128, r: 32, g: 64, b: 96 });
  });

  test('parseBmsArgb clamps decimal channel values to the byte range', () => {
    // Defensive — out-of-range inputs from a malformed chart shouldn't produce alpha = 1.18 or a wrap-around RGB tint.
    expect(parseBmsArgb('300,-5,9999,128')).toEqual({ a: 255, r: 0, g: 255, b: 128 });
  });

  test('parseBmsWavCmd parses volume / pitch / loop lines and normalizes the slot id', () => {
    // The trailing token is parsed as a base-10 integer (the spec gives the value in decimal even though the slot id is
    // base-36), so `64` here means literal 64 / 127 ≈ 50% volume.
    expect(parseBmsWavCmd('01 0a 64')).toEqual({ param: 'volume', slot: '0A', value: 64 });
    expect(parseBmsWavCmd('00 0A 2')).toEqual({ param: 'pitch', slot: '0A', value: 2 });
    // Loop point: 0 = no loop, otherwise the sample-frame index the player should jump to once the source reaches its
    // tail.
    expect(parseBmsWavCmd('02 ZZ 1024')).toEqual({ param: 'loop', slot: 'ZZ', value: 1024 });
  });

  test('parseBmsWavCmd preserves slot case under base-62 charts', () => {
    // `#BASE 62` opens up lowercase ids as a separate slot space, so a `#WAVCMD 01 0a 64` line must not be folded to
    // `0A`.
    expect(parseBmsWavCmd('01 0a 64', 62)).toMatchObject({ slot: '0a' });
    expect(parseBmsWavCmd('01 0A 64', 62)).toMatchObject({ slot: '0A' });
  });

  test('parseBmsWavCmd rejects unknown parameter bytes and malformed lines', () => {
    // Anything outside `00`/`01`/`02` is reserved by the spec — we'd rather skip than guess a meaning.
    expect(parseBmsWavCmd('99 01 100')).toBeUndefined();
    expect(parseBmsWavCmd('not even close')).toBeUndefined();
    expect(parseBmsWavCmd('01 01')).toBeUndefined();
    expect(parseBmsWavCmd('')).toBeUndefined();
  });

  test('wavCmdVolumeByteToLinearGain maps 0..127 to 0..1 with edge clamping', () => {
    expect(wavCmdVolumeByteToLinearGain(0)).toBe(0);
    expect(wavCmdVolumeByteToLinearGain(127)).toBe(1);
    expect(wavCmdVolumeByteToLinearGain(63.5)).toBeCloseTo(0.5);
    // Out-of-range bytes clamp to the byte range so a malformed `300` doesn't poison the gain stage.
    expect(wavCmdVolumeByteToLinearGain(-10)).toBe(0);
    expect(wavCmdVolumeByteToLinearGain(255)).toBe(1);
    // Non-finite inputs default to unity (no-op).
    expect(wavCmdVolumeByteToLinearGain(Number.NaN)).toBe(1);
  });

  test('collectBmsWavCmdVolumeMultipliers builds slot → gain map from volume lines only', () => {
    const map = collectBmsWavCmdVolumeMultipliers([
      '01 01 64', // WAV01 → volume 64/127
      '00 01 2', // pitch line for the same slot — must NOT
      // override the volume entry (different param).
      '01 02 0', // WAV02 → muted
      '02 03 1024', // loop line — skipped (not volume).
    ]);
    expect(map.get('01')).toBeCloseTo(64 / 127);
    expect(map.get('02')).toBe(0);
    expect(map.has('03')).toBe(false);
  });

  test('collectBmsWavCmdVolumeMultipliers honors later-overrides-earlier', () => {
    // Authors occasionally re-issue a #WAVCMD volume line. LR2 and beatoraja apply the LAST value, so we mirror that.
    const map = collectBmsWavCmdVolumeMultipliers(['01 01 32', '01 01 96']);
    expect(map.get('01')).toBeCloseTo(96 / 127);
  });

  test('parseBmsArgb returns undefined for unrecognized / empty input', () => {
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

  test('usesMonophonicWavPlayback is true only for BMS-sourced charts', () => {
    expect(usesMonophonicWavPlayback({ sourceFormat: 'bms' })).toBe(true);
    expect(usesMonophonicWavPlayback({ sourceFormat: 'bmson' })).toBe(false);
    expect(usesMonophonicWavPlayback({ sourceFormat: 'json' })).toBe(false);
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
    // PMS-STD content authored as `.bme` — uses any of `22..25` AND no traditional IIDX 2P channels
    // (`21`/`26..29`). Classified as `'9'` regardless of `.pms` extension so the engine picks up
    // POPN-9 bindings (`22..25` → lanes 6..9). Before this rule the chart fell through to the IIDX
    // 5K DP heuristic and the f/v/g/b lane bindings were lost.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '22', '23', '24', '25']))).toBe(
      '9',
    );
    // BME POPN-9 — full 1P keyboard (`11..19`) authored as `#PLAYER 1`. Before the content-based rule the
    // chart classified as `'7'` (saw `18`/`19`, didn't see `2X`) and the engine's 7-key SP bindings dropped
    // the POPN-9 `f/v/g/b` on `16/17/18/19`.
    expect(
      resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '16', '17', '18', '19'])),
    ).toBe('9');
    // PMS-STD hybrid with 1P scratch — non-standard but uses POPN-specific `22..25`. Routes to `'9'`
    // because `22..25` is the discriminator; the 1P-side scratch presence doesn't override it.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '16', '22', '23', '24', '25']))).toBe('9');
    // Sparse PMS-STD authoring — single `22` channel use without any `21`/`26..29`. Still routes to
    // `'9'` (a real IIDX 5K DP chart would have `21` and / or `26` for the leftmost 2P column / scratch).
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '15', '22']))).toBe('9');
    // Real IIDX 5K DP — has scratch on both sides AND `21`. Stays at `'10'` (presence of `21`/`26..29`
    // beats the PMS-STD signal).
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '15', '16', '21', '22', '25', '26']))).toBe('10');
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
    // Lowercase `aa` is a distinct ID from uppercase `AA` once the chart opts into base-62. The resolver must match
    // case-sensitively so events tagged `aa` only mark the LN end when the chart actually authored `#LNOBJ aa`.
    json.bms.lnObjs = ['aa'];
    const start: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const matchingLowerEnd: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'aa' };
    json.events = [start, matchingLowerEnd];

    const resolved = resolveLnobjLongNotes(json);
    expect(resolved.endEvents.has(matchingLowerEnd)).toBe(true);
    expect(resolved.startToEndBeat.get(start)).toBeCloseTo(1, 6);

    // And confirm an uppercase `AA` token does NOT close the LN when only lowercase `aa` was registered as a marker.
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
