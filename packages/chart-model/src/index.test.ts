import { describe, expect, test } from 'vite-plus/test';
import {
  collectLNOBJEndEvents,
  createBeatResolver,
  eventToBeat,
  getMeasureBeats,
  isBmsBGMVolumeChangeChannel,
  isBMSDynamicVolumeChangeChannel,
  isBMSKeyVolumeChangeChannel,
  isBMSLongNoteChannel,
  isLandmineChannel,
  isPlayableChannel,
  isPlayLaneSoundChannel,
  isSampleTriggerChannel,
  isScrollChannel,
  isStopChannel,
  isTempoChannel,
  mapBMSLongNoteChannelToPlayable,
  measureToBeat,
  collectBMSExWAVVolumeMultipliers,
  collectBmsWAVCmdVolumeMultipliers,
  exWAVVolumeCentibelsToLinearGain,
  parseBmsARGB,
  parseBmsBGA,
  parseBMSDynamicVolumeGain,
  parseBMSExBMP,
  parseBMSExWAV,
  parseBMSSwBGA,
  parseBmsWAVCmd,
  pickSwitchingBGAFrame,
  resolveBmsBmpARGB,
  wavCmdVolumeByteToLinearGain,
  parseBPMFrom03Token,
  resolveChartPlayVariant,
  resolveChartReferenceBPM,
  resolveBMSLongNotes,
  resolveLNOBJLongNotes,
  sortEvents,
  usesMonophonicWAVPlayback,
  volWAVToLinearGain,
} from './index.ts';
import { createEmptyJSON, type BeMusicEvent } from '../../chart-source/src/index.ts';

describe('chart', () => {
  test('parseBPMFrom03Token decodes hexadecimal BPM tokens', () => {
    expect(parseBPMFrom03Token('7F')).toBe(127);
    expect(parseBPMFrom03Token('GG')).toBe(0);
  });

  test('getMeasureBeats returns the beat count for a measure length multiplier', () => {
    expect(getMeasureBeats(0.75)).toBe(3);
  });

  test('measureToBeat and eventToBeat reflect measure lengths', () => {
    const json = createEmptyJSON();
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
    const json = createEmptyJSON();
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
    const json = createEmptyJSON();
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

  test('resolveChartReferenceBPM prefers #BASEBPM over the chart #BPM', () => {
    // BMS spec — `#BASEBPM` (hitkey BMS Memo) is the chart-author -declared HS-fix reference BPM. When set,
    // scroll-speed calibration MUST honor it instead of the chart's initial `#BPM`, because that's the explicit author
    // intent for the scroll feel; `#BPM` is just where the chart starts ticking.
    const json = createEmptyJSON();
    json.metadata.bpm = 200;
    json.bms.baseBPM = 130;
    expect(resolveChartReferenceBPM(json)).toBe(130);
  });

  test('resolveChartReferenceBPM falls back to metadata.bpm when #BASEBPM is absent', () => {
    const json = createEmptyJSON();
    json.metadata.bpm = 145;
    expect(resolveChartReferenceBPM(json)).toBe(145);
  });

  test('resolveChartReferenceBPM honors the host fallback when nothing is declared', () => {
    // Charts that omit both `#BASEBPM` and `#BPM` are rare but legal — typically partial / WIP fixtures. The host can
    // pass a song-list-cached BPM hint.
    const json = createEmptyJSON();
    json.metadata.bpm = 0;
    expect(resolveChartReferenceBPM(json, 120)).toBe(120);
  });

  test('resolveChartReferenceBPM rejects non-positive #BASEBPM values', () => {
    // Defensive: `#BASEBPM 0` / negative parses can leak through a malformed chart. We treat them as "unset" rather
    // than returning a divide-by-zero seed.
    const json = createEmptyJSON();
    json.metadata.bpm = 140;
    json.bms.baseBPM = 0;
    expect(resolveChartReferenceBPM(json)).toBe(140);
    json.bms.baseBPM = -10;
    expect(resolveChartReferenceBPM(json)).toBe(140);
  });

  test('resolveChartReferenceBPM returns undefined when nothing positive is available', () => {
    const json = createEmptyJSON();
    json.metadata.bpm = 0;
    expect(resolveChartReferenceBPM(json)).toBeUndefined();
  });

  test('parseBMSExWAV parses the standard pvf flag layout', () => {
    // Hitkey BMS Memo: `#EXWAVxx [flags] params filename`. `pvf 1024,-200,48000 sample.wav` → pan=1024, vol=-200 cB (≈
    // −2 dB), freq=48 kHz, filename `sample.wav`.
    expect(parseBMSExWAV('pvf 1024,-200,48000 sample.wav')).toEqual({
      pan: 1024,
      volumeCentibels: -200,
      frequencyHz: 48000,
      filename: 'sample.wav',
    });
  });

  test('parseBMSExWAV matches each flag character to its positional param', () => {
    // Flags can appear in any order; the values follow positionally.
    expect(parseBMSExWAV('vp -100,500 hat.wav')).toMatchObject({
      volumeCentibels: -100,
      pan: 500,
      filename: 'hat.wav',
    });
    const onlyVol = parseBMSExWAV('v 0 only-vol.wav');
    expect(onlyVol?.volumeCentibels).toBe(0);
    // Absent flags must remain undefined so the consumer can distinguish "explicitly authored 0" from "not authored at
    // all" — pan: 0 = center, vol: 0 cB = unity.
    expect(onlyVol?.pan).toBeUndefined();
    expect(onlyVol?.frequencyHz).toBeUndefined();
  });

  test('parseBMSExWAV joins multi-token filenames back together', () => {
    // Charts can ship Windows-path-style names with spaces.
    expect(parseBMSExWAV('v 0 my sample.wav')?.filename).toBe('my sample.wav');
  });

  test('parseBMSExWAV returns undefined for malformed input', () => {
    expect(parseBMSExWAV('')).toBeUndefined();
    // Missing the params or the filename token.
    expect(parseBMSExWAV('pvf')).toBeUndefined();
    expect(parseBMSExWAV('pvf 100,200,300')).toBeUndefined();
  });

  test("volWAVToLinearGain scales by n / 100 inside beatoraja's 0 < n < 200 range", () => {
    expect(volWAVToLinearGain(100)).toBe(1);
    expect(volWAVToLinearGain(50)).toBe(0.5);
    expect(volWAVToLinearGain(150)).toBe(1.5);
    expect(volWAVToLinearGain(199)).toBeCloseTo(1.99, 10);
  });

  test('volWAVToLinearGain plays a missing or out-of-range #VOLWAV at unity, as beatoraja does', () => {
    expect(volWAVToLinearGain(undefined)).toBe(1);
    expect(volWAVToLinearGain(0)).toBe(1);
    expect(volWAVToLinearGain(200)).toBe(1);
    expect(volWAVToLinearGain(500)).toBe(1);
    expect(volWAVToLinearGain(-20)).toBe(1);
    expect(volWAVToLinearGain(Number.NaN)).toBe(1);
  });

  test('exWAVVolumeCentibelsToLinearGain treats 0 cB as unity', () => {
    expect(exWAVVolumeCentibelsToLinearGain(0)).toBe(1);
  });

  test('exWAVVolumeCentibelsToLinearGain attenuates negative cB and boosts positive cB', () => {
    // -600 cB = -6 dB → ≈ 0.501 linear gain.
    expect(exWAVVolumeCentibelsToLinearGain(-600)).toBeCloseTo(0.501, 3);
    // -2000 cB = -20 dB → ≈ 0.1.
    expect(exWAVVolumeCentibelsToLinearGain(-2000)).toBeCloseTo(0.1, 3);
    // +600 cB = +6 dB → ≈ 1.995 linear gain.
    expect(exWAVVolumeCentibelsToLinearGain(600)).toBeCloseTo(1.995, 3);
  });

  test('exWAVVolumeCentibelsToLinearGain clamps absurd inputs', () => {
    // Pathological boost should clamp at +18 dB linear (≈ 8x).
    expect(exWAVVolumeCentibelsToLinearGain(10_000)).toBe(8);
    // Non-finite input falls back to unity (no surprise change).
    expect(exWAVVolumeCentibelsToLinearGain(Number.NaN)).toBe(1);
  });

  test('collectBMSExWAVVolumeMultipliers ignores entries without a v flag', () => {
    const map = collectBMSExWAVVolumeMultipliers({
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

  test('parseBMSSwBGA decodes "fr:tot:lp:ARGB N1 N2 …" animation directives', () => {
    // Hitkey BMS Memo: `fr` is in 1/100 sec, so `fr=10` → 100ms per frame. The optional ARGB field round-trips as a raw
    // string for downstream `parseBmsARGB` use.
    const parsed = parseBMSSwBGA('10:5:1:FF000000 02 03 04 05 06');
    expect(parsed).toEqual({
      frameIntervalMs: 100,
      totalFrames: 5,
      loop: true,
      argbRaw: 'FF000000',
      frames: ['02', '03', '04', '05', '06'],
    });
  });

  test('parseBMSSwBGA treats lp=0 as no-loop and ARGB as optional', () => {
    const parsed = parseBMSSwBGA('5:3:0 0a 0b 0c');
    expect(parsed?.loop).toBe(false);
    expect(parsed?.argbRaw).toBeUndefined();
    expect(parsed?.frames).toEqual(['0A', '0B', '0C']);
  });

  test('parseBMSSwBGA rejects malformed / non-positive headers', () => {
    expect(parseBMSSwBGA('')).toBeUndefined();
    // No frame list.
    expect(parseBMSSwBGA('10:5:1')).toBeUndefined();
    // Header missing fields.
    expect(parseBMSSwBGA('10 02 03')).toBeUndefined();
    // Non-positive `fr` would divide by zero downstream.
    expect(parseBMSSwBGA('0:5:1 02 03')).toBeUndefined();
    // Non-positive `tot`.
    expect(parseBMSSwBGA('10:0:1 02 03')).toBeUndefined();
  });

  test('pickSwitchingBGAFrame walks the frame list at the authored interval', () => {
    const swBGA = parseBMSSwBGA('10:5:1 02 03 04 05 06')!;
    expect(pickSwitchingBGAFrame(swBGA, 0)).toBe('02');
    expect(pickSwitchingBGAFrame(swBGA, 99)).toBe('02'); // 99 ms < 100 ms threshold
    expect(pickSwitchingBGAFrame(swBGA, 100)).toBe('03');
    expect(pickSwitchingBGAFrame(swBGA, 350)).toBe('05');
    // After totalFrames the loop wraps back to frame 0.
    expect(pickSwitchingBGAFrame(swBGA, 500)).toBe('02');
  });

  test('pickSwitchingBGAFrame holds the last frame when lp=0', () => {
    // With looping disabled, an `elapsedMs` past the authored duration must hold the final frame instead of wrapping to
    // frame 0 (which would cause a visual glitch at end).
    const swBGA = parseBMSSwBGA('10:3:0 02 03 04')!;
    expect(pickSwitchingBGAFrame(swBGA, 0)).toBe('02');
    expect(pickSwitchingBGAFrame(swBGA, 250)).toBe('04');
    expect(pickSwitchingBGAFrame(swBGA, 5000)).toBe('04');
  });

  test('pickSwitchingBGAFrame cycles a slot list shorter than totalFrames', () => {
    // Author shipped only two frames but advertised tot=4. The hitkey-style behavior is to cycle within the authored
    // slot list while honoring the total-frame loop boundary.
    const swBGA = parseBMSSwBGA('10:4:1 02 03')!;
    expect(pickSwitchingBGAFrame(swBGA, 0)).toBe('02');
    expect(pickSwitchingBGAFrame(swBGA, 100)).toBe('03');
    expect(pickSwitchingBGAFrame(swBGA, 200)).toBe('02');
    expect(pickSwitchingBGAFrame(swBGA, 300)).toBe('03');
    expect(pickSwitchingBGAFrame(swBGA, 400)).toBe('02');
  });

  test('parseBmsBGA decodes "YY x1 y1 x2 y2 dx dy" sub-region directives', () => {
    // Hitkey BMS Memo: `#BGAxx YY x1 y1 x2 y2 dx dy` aliases slot `xx` to a rectangle pulled out of `#BMPYY`. Consumers
    // use this to compose sprite-sheet style animations.
    expect(parseBmsBGA('02 0 0 256 256 0 0')).toEqual({
      sourceBMP: '02',
      sx: 0,
      sy: 0,
      ex: 256,
      ey: 256,
      dx: 0,
      dy: 0,
    });
    expect(parseBmsBGA('0a 64 32 192 160 16 8')).toMatchObject({
      sourceBMP: '0A',
      sx: 64,
      sy: 32,
      ex: 192,
      ey: 160,
      dx: 16,
      dy: 8,
    });
  });

  test('parseBmsBGA preserves base-62 source slot case', () => {
    expect(parseBmsBGA('0a 0 0 64 64 0 0', 62)?.sourceBMP).toBe('0a');
  });

  test('parseBmsBGA rejects malformed / degenerate inputs', () => {
    // Too few tokens — missing dx / dy.
    expect(parseBmsBGA('02 0 0 256 256 0')).toBeUndefined();
    // Inverted rectangle — `ex <= sx` would produce a zero-area frame and divide-by-zero downstream.
    expect(parseBmsBGA('02 100 0 50 256 0 0')).toBeUndefined();
    expect(parseBmsBGA('02 0 100 256 50 0 0')).toBeUndefined();
    // Non-integer coordinate.
    expect(parseBmsBGA('02 0 zero 256 256 0 0')).toBeUndefined();
    // Empty source slot.
    expect(parseBmsBGA(' 0 0 256 256 0 0')).toBeUndefined();
  });

  test('parseBmsBGA retains long internal resource ids only when explicitly enabled', () => {
    expect(parseBmsBGA('100 0 0 64 64 0 0', 62)?.sourceBMP).toBe('10');
    expect(parseBmsBGA('100 0 0 64 64 0 0', 62, true)?.sourceBMP).toBe('100');
  });

  test.each(['255,0,0,0 backdrop.bmp', '255,0,0,0,backdrop.bmp'])(
    'parseBMSExBMP decodes the resource and color fields (%s)',
    (definition) => {
      const parsed = parseBMSExBMP(definition);
      expect(parsed?.filename).toBe('backdrop.bmp');
      expect(parsed?.argb).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    },
  );

  test.each([' 128, 20, 30, 40\timages/my file,01.png ', '128,20,30,40,images/my file,01.png'])(
    'parseBMSExBMP preserves spaces and commas in filenames (%s)',
    (definition) => {
      expect(parseBMSExBMP(definition)).toMatchObject({
        filename: 'images/my file,01.png',
        argb: { a: 128, r: 20, g: 30, b: 40 },
      });
    },
  );

  test('parseBMSExBMP retains a filename with malformed color fields', () => {
    expect(parseBMSExBMP('bad,0,0,0 image.png')).toMatchObject({ filename: 'image.png', argb: undefined });
    expect(parseBMSExBMP('255,0,0,0   ')).toBeUndefined();
  });

  test('parseBMSExBMP surfaces filename even when the ARGB fields are blank', () => {
    // Some chart authors ship `#EXBMP01 ,,,,foo.bmp` as a way to declare the slot without yet picking a tint — the
    // consumer should still know which file to load and just skip the tint.
    const parsed = parseBMSExBMP(',,,,foo.bmp');
    expect(parsed?.filename).toBe('foo.bmp');
    expect(parsed?.argb).toBeUndefined();
  });

  test('parseBMSExBMP returns undefined for inputs missing the filename or with too few commas', () => {
    expect(parseBMSExBMP('')).toBeUndefined();
    // Only four commas — no filename token at all.
    expect(parseBMSExBMP('255,0,0,0')).toBeUndefined();
    // Filename present but blank after trimming.
    expect(parseBMSExBMP('255,0,0,0,   ')).toBeUndefined();
  });

  test('resolveBmsBmpARGB prefers an explicit #ARGBxx value over the embedded #EXBMPxx tuple', () => {
    // Both directives can target the same slot. `#ARGBxx` is the newer, more flexible form so chart authors expect it
    // to win when both are present.
    const json = createEmptyJSON();
    json.bms.argb['01'] = 'FF112233';
    json.bms.exBMP['01'] = '255,0,0,0,backdrop.bmp';
    expect(resolveBmsBmpARGB(json, '01')).toEqual({ a: 255, r: 0x11, g: 0x22, b: 0x33 });
  });

  test('resolveBmsBmpARGB falls back to the #EXBMPxx tuple when #ARGBxx is absent', () => {
    const json = createEmptyJSON();
    json.bms.exBMP['02'] = '128,255,0,0,red-tint.bmp';
    expect(resolveBmsBmpARGB(json, '02')).toEqual({ a: 128, r: 255, g: 0, b: 0 });
  });

  test('resolveBmsBmpARGB returns undefined when neither directive applies to the slot', () => {
    const json = createEmptyJSON();
    expect(resolveBmsBmpARGB(json, '03')).toBeUndefined();
  });

  test('parseBmsARGB decodes the AARRGGBB hex format the parser stores', () => {
    // Parser-level normalization lands `#ARGB01 FF000000` here as the bare hex string, since that's the dominant
    // in-the-wild format. AA = alpha (FF = fully opaque), then RR/GG/BB.
    expect(parseBmsARGB('FF000000')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsARGB('80a0b0c0')).toEqual({ a: 0x80, r: 0xa0, g: 0xb0, b: 0xc0 });
  });

  test('parseBmsARGB tolerates a leading "#" on hex inputs', () => {
    // Some chart authors write `#ARGB01 #FF000000` with a CSS-style prefix; treat the `#` as decorative.
    expect(parseBmsARGB('#FF112233')).toEqual({ a: 255, r: 0x11, g: 0x22, b: 0x33 });
  });

  test('parseBmsARGB decodes comma-separated decimal A,R,G,B', () => {
    // The spec also lists the decimal form. Whitespace inside the commas should be tolerated since chart authors
    // hand-edit these.
    expect(parseBmsARGB('255,0,0,0')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsARGB(' 128 , 32 , 64 , 96 ')).toEqual({ a: 128, r: 32, g: 64, b: 96 });
  });

  test('parseBmsARGB clamps decimal channel values to the byte range', () => {
    // Defensive — out-of-range inputs from a malformed chart shouldn't produce alpha = 1.18 or a wrap-around RGB tint.
    expect(parseBmsARGB('300,-5,9999,128')).toEqual({ a: 255, r: 0, g: 255, b: 128 });
  });

  test('parseBmsWAVCmd parses volume / pitch / duration lines and normalizes the slot id', () => {
    // The trailing token is parsed as a base-10 integer (the spec gives the value in decimal even though the slot id is
    // base-36), so `64` here means literal 64 / 100 = 64% volume.
    expect(parseBmsWAVCmd('01 0a 64')).toEqual({ param: 'volume', slot: '0A', value: 64 });
    expect(parseBmsWAVCmd('00 0A 2')).toEqual({ param: 'pitch', slot: '0A', value: 2 });
    // Duration: 0 plays to the original end; a positive value is in 0.5 ms units.
    expect(parseBmsWAVCmd('02 ZZ 1024')).toEqual({ param: 'duration', slot: 'ZZ', value: 1024 });
  });

  test('parseBmsWAVCmd preserves slot case under base-62 charts', () => {
    // `#BASE 62` opens up lowercase ids as a separate slot space, so a `#WAVCMD 01 0a 64` line must not be folded to
    // `0A`.
    expect(parseBmsWAVCmd('01 0a 64', 62)).toMatchObject({ slot: '0a' });
    expect(parseBmsWAVCmd('01 0A 64', 62)).toMatchObject({ slot: '0A' });
  });

  test('parseBmsWAVCmd rejects unknown parameter bytes and malformed lines', () => {
    // Anything outside `00`/`01`/`02` is reserved by the spec — we'd rather skip than guess a meaning.
    expect(parseBmsWAVCmd('99 01 100')).toBeUndefined();
    expect(parseBmsWAVCmd('not even close')).toBeUndefined();
    expect(parseBmsWAVCmd('01 01')).toBeUndefined();
    expect(parseBmsWAVCmd('')).toBeUndefined();
  });

  test('legacy volume helper follows the corrected percentage semantics', () => {
    expect(wavCmdVolumeByteToLinearGain(0)).toBe(0);
    expect(wavCmdVolumeByteToLinearGain(127)).toBe(1.27);
    expect(wavCmdVolumeByteToLinearGain(50)).toBeCloseTo(0.5);
    // Negative volume mutes; positive amplification is allowed by MacBeat.
    expect(wavCmdVolumeByteToLinearGain(-10)).toBe(0);
    expect(wavCmdVolumeByteToLinearGain(255)).toBe(2.55);
    // Non-finite inputs default to unity (no-op).
    expect(wavCmdVolumeByteToLinearGain(Number.NaN)).toBe(1);
  });

  test('collectBmsWAVCmdVolumeMultipliers builds slot → gain map from volume lines only', () => {
    const map = collectBmsWAVCmdVolumeMultipliers([
      '01 01 64', // WAV01 → volume 64/100
      '00 01 2', // pitch line for the same slot — must NOT
      // override the volume entry (different param).
      '01 02 0', // WAV02 → muted
      '02 03 1024', // duration line — skipped (not volume).
    ]);
    expect(map.get('01')).toBeCloseTo(64 / 100);
    expect(map.get('02')).toBe(0);
    expect(map.has('03')).toBe(false);
  });

  test('collectBmsWAVCmdVolumeMultipliers honors later-overrides-earlier', () => {
    // Be-Music resolves duplicate commands with the last value for each parameter.
    const map = collectBmsWAVCmdVolumeMultipliers(['01 01 32', '01 01 96']);
    expect(map.get('01')).toBeCloseTo(96 / 100);
  });

  test('parseBmsARGB returns undefined for unrecognized / empty input', () => {
    expect(parseBmsARGB('')).toBeUndefined();
    expect(parseBmsARGB('   ')).toBeUndefined();
    expect(parseBmsARGB('not-an-argb')).toBeUndefined();
    // Hex of the wrong length isn't AARRGGBB.
    expect(parseBmsARGB('FFF')).toBeUndefined();
    expect(parseBmsARGB('FFFFFFFFFF')).toBeUndefined();
    // Wrong number of comma-separated channels.
    expect(parseBmsARGB('255,0,0')).toBeUndefined();
    expect(parseBmsARGB('1,2,3,4,5')).toBeUndefined();
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
    expect(isLandmineChannel('DA')).toBe(true);
    expect(isLandmineChannel('EO')).toBe(true);
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
    // Extended 24-key (Keyboardmania) lane columns — `1A`..`1O` / `2A`..`2O` carry lanes 10..24.
    expect(isPlayableChannel('1A')).toBe(true);
    expect(isPlayableChannel('1O')).toBe(true);
    expect(isPlayableChannel('2A')).toBe(true);
    expect(isPlayableChannel('1a')).toBe(true);
    expect(isPlayableChannel('10')).toBe(false);

    expect(isPlayLaneSoundChannel('11')).toBe(true);
    expect(isPlayLaneSoundChannel('29')).toBe(true);
    expect(isPlayLaneSoundChannel('31')).toBe(true);
    expect(isPlayLaneSoundChannel('48')).toBe(true);
    expect(isPlayLaneSoundChannel('51')).toBe(true);
    expect(isPlayLaneSoundChannel('61')).toBe(true);
    expect(isPlayLaneSoundChannel('1A')).toBe(true);
    expect(isPlayLaneSoundChannel('4O')).toBe(true);
    expect(isPlayLaneSoundChannel('01')).toBe(false);
    expect(isPlayLaneSoundChannel('A1')).toBe(false);

    expect(isBMSLongNoteChannel('51')).toBe(true);
    expect(isBMSLongNoteChannel('6a')).toBe(true);
    expect(isBMSLongNoteChannel('69')).toBe(true);
    expect(isBMSLongNoteChannel('5A')).toBe(true);
    expect(isBMSLongNoteChannel('50')).toBe(false);
    expect(isBMSLongNoteChannel('11')).toBe(false);
    expect(mapBMSLongNoteChannelToPlayable('51')).toBe('11');
    expect(mapBMSLongNoteChannelToPlayable('61')).toBe('21');
    expect(mapBMSLongNoteChannelToPlayable('69')).toBe('29');
    expect(mapBMSLongNoteChannelToPlayable('5A')).toBe('1A');
    expect(mapBMSLongNoteChannelToPlayable('6o')).toBe('2O');
    expect(mapBMSLongNoteChannelToPlayable('50')).toBeUndefined();

    expect(isBmsBGMVolumeChangeChannel('97')).toBe(true);
    expect(isBmsBGMVolumeChangeChannel('98')).toBe(false);
    expect(isBMSKeyVolumeChangeChannel('98')).toBe(true);
    expect(isBMSKeyVolumeChangeChannel('97')).toBe(false);
    expect(isBMSDynamicVolumeChangeChannel('97')).toBe(true);
    expect(isBMSDynamicVolumeChangeChannel('98')).toBe(true);
    expect(isBMSDynamicVolumeChangeChannel('11')).toBe(false);
    expect(parseBMSDynamicVolumeGain('80')).toBeCloseTo(0x80 / 0xff, 9);
    expect(parseBMSDynamicVolumeGain('00')).toBeUndefined();
    expect(parseBMSDynamicVolumeGain('GG')).toBeUndefined();
  });

  test('usesMonophonicWAVPlayback is true only for BMS-sourced charts', () => {
    expect(usesMonophonicWAVPlayback({ sourceFormat: 'bms' })).toBe(true);
    expect(usesMonophonicWAVPlayback({ sourceFormat: 'bmson' })).toBe(false);
    expect(usesMonophonicWAVPlayback({ sourceFormat: 'json' })).toBe(false);
  });

  test('classifies normalized fallback inputs after trimming and case normalization', () => {
    expect(isScrollChannel(' sc ')).toBe(true);
    expect(isStopChannel(' 09 ')).toBe(true);
    expect(isPlayableChannel(' 11 ')).toBe(true);
    expect(isBMSLongNoteChannel(' 69 ')).toBe(true);
    expect(isSampleTriggerChannel(' a0 ')).toBe(false);
    expect(isBMSDynamicVolumeChangeChannel(' 98 ')).toBe(true);
    expect(mapBMSLongNoteChannelToPlayable(' 61 ')).toBe('21');
  });

  test('resolveChartPlayVariant classifies That-Which-Must-Not-Be-Named and PMS chart families', () => {
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
    // PMS-STD content authored as `.bme` — uses any of `22..25` AND no traditional That-Which-Must-Not-Be-Named 2P channels
    // (`21`/`26..29`). Classified as `'9'` regardless of `.pms` extension so the engine picks up
    // POPN-9 bindings (`22..25` → lanes 6..9). Before this rule the chart fell through to the That-Which-Must-Not-Be-Named
    // 5K DP heuristic and the f/v/g/b lane bindings were lost.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '22', '23', '24', '25']))).toBe(
      '9',
    );
    // BME POPN-9 — full 1P keyboard (`11..19`) authored as `#PLAYER 1`. Before the content-based rule the
    // chart classified as `'7'` (saw `18`/`19`, didn't see `2X`) and the engine's 7-key SP bindings dropped
    // the POPN-9 `f/v/g/b` on `16/17/18/19`.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '16', '17', '18', '19']))).toBe(
      '9',
    );
    // PMS-STD hybrid with 1P scratch — non-standard but uses POPN-specific `22..25`. Routes to `'9'`
    // because `22..25` is the discriminator; the 1P-side scratch presence doesn't override it.
    expect(
      resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '16', '22', '23', '24', '25'])),
    ).toBe('9');
    // Sparse PMS-STD authoring — single `22` channel use without any `21`/`26..29`. Still routes to
    // `'9'` (a real That-Which-Must-Not-Be-Named 5K DP chart would have `21` and / or `26` for the leftmost 2P column / scratch).
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '15', '22']))).toBe('9');
    // Real That-Which-Must-Not-Be-Named 5K DP — has scratch on both sides AND `21`. Stays at `'10'` (presence of `21`/`26..29`
    // beats the PMS-STD signal).
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '15', '16', '21', '22', '25', '26']))).toBe('10');
  });

  test('resolveChartPlayVariant counts long-note channels on the lanes they map to', () => {
    const chart = (chartPath: string, channels: string[], player?: number) => ({
      chartPath,
      events: channels.map((channel) => ({ channel })),
      bms: { player },
    });

    // `#LNTYPE 1` long notes on `58` sit on lane `18` exactly like an `#LNOBJ` long note authored on `18`, so both
    // notations of the same chart resolve to the same lane mode.
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '18']))).toBe('7');
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '58']))).toBe('7');
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '61']))).toBe('10');
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '61', '69']))).toBe('14');
    expect(resolveChartPlayVariant(chart('main.bms', ['5a']))).toBe('24');
    // Mines (`D*` / `E*`) and invisible objects (`3*` / `4*`) are not lanes the player presses, so they never
    // decide the lane mode.
    expect(resolveChartPlayVariant(chart('main.bms', ['11', 'D8', '39', 'E1', '41']))).toBe('5');
  });

  test('resolveChartPlayVariant takes 5 / 10 KEY vs 7 / 14 KEY from the lanes in use, not the `.bme` extension', () => {
    const chart = (chartPath: string | undefined, channels: string[], player?: number) => ({
      chartPath,
      events: channels.map((channel) => ({ channel })),
      bms: { player },
    });

    // beatoraja decides the mode from the lanes the chart uses; a `.bme` chart without a 6 / 7 key column is 5 / 10
    // KEY exactly like its `.bms` twin.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '16']))).toBe('5');
    expect(resolveChartPlayVariant(chart('Song.dir/MAIN.BME', ['11', '16']))).toBe('5');
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '21', '26']))).toBe('10');
    expect(resolveChartPlayVariant(chart('.bme', ['11']))).toBe('5');
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '16']))).toBe('5');
    expect(resolveChartPlayVariant(chart(undefined, ['11', '16']))).toBe('5');
    // A 6 / 7 key column still decides 7 / 14 KEY whatever the extension.
    expect(resolveChartPlayVariant(chart('main.bms', ['11', '19']))).toBe('7');
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '21', '28']))).toBe('14');
    // PMS-STD content in a `.bme` file stays POPN-9.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '22']))).toBe('9');
    // A dotted directory name is not the chart's extension.
    expect(resolveChartPlayVariant(chart('Song.pms/main', ['11']))).toBe('5');
    expect(resolveChartPlayVariant(chart('.pms', ['11']))).toBe('9');
  });

  test('resolveChartPlayVariant keeps `#PLAYER 3` double-play charts with a FREE ZONE on `17` as That-Which-Must-Not-Be-Named DP', () => {
    const chart = (channels: string[]) => ({
      chartPath: 'main.bms',
      events: channels.map((channel) => ({ channel })),
      bms: { player: 3 },
    });

    expect(resolveChartPlayVariant(chart(['11', '17', '21', '26']))).toBe('10');
    expect(resolveChartPlayVariant(chart(['11', '17', '18', '21', '28']))).toBe('14');
    // Without the That-Which-Must-Not-Be-Named 2P side `#PLAYER 3` + `17` is still POPN-9.
    expect(resolveChartPlayVariant(chart(['11', '17']))).toBe('9');
  });

  test('resolveChartPlayVariant classifies the 24-key keyboard families from extended lane channels', () => {
    const chart = (chartPath: string, channels: string[], player?: number) => ({
      chartPath,
      events: channels.map((channel) => ({ channel })),
      bms: { player },
    });

    // A single extended lane column (`1A` = lane 10) is enough — 1P only → `'24'`.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '18', '1A']))).toBe('24');
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '1O']))).toBe('24');
    // Any 2P channel alongside the extended bank → `'48'`.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '1A', '21', '2A']))).toBe('48');
    // Extended lanes win over the BME POPN-9 rule: a 24-key chart fills all nine classic 1P columns too,
    // which rule 3 would otherwise claim for `'9'`.
    expect(
      resolveChartPlayVariant(chart('main.bme', ['11', '12', '13', '14', '15', '16', '17', '18', '19', '1A'])),
    ).toBe('24');
    // …and over the `#PLAYER 3` + `17` POPN-9 rule, which every 48-key DP chart would otherwise trip.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '17', '1A', '21', '2A'], 3))).toBe('48');
    // …and over the `.pms` extension, so a mis-named keyboard chart still classifies by its lanes.
    expect(resolveChartPlayVariant(chart('main.pms', ['11', '1A']))).toBe('24');
    // Lowercase authoring normalizes to the same columns.
    expect(resolveChartPlayVariant(chart('main.bme', ['11', '1a']))).toBe('24');
  });

  test('resolveChartPlayVariant reads the BMS wheel channels 1P / 1Q / 2P / 2Q as keyboard lanes', () => {
    const chart = (channels: string[]) => ({ chartPath: 'main.bme', events: channels.map((channel) => ({ channel })) });

    expect(resolveChartPlayVariant(chart(['11', '1P']))).toBe('24');
    expect(resolveChartPlayVariant(chart(['11', '1Q']))).toBe('24');
    expect(resolveChartPlayVariant(chart(['11', '1A', '2Q']))).toBe('48');
  });

  test('resolveChartPlayVariant takes the bmson keyboard mode_hint as authoritative', () => {
    const bmson = (modeHint: string | undefined, channels: string[]) => ({
      chartPath: 'song.bmson',
      events: channels.map((channel) => ({ channel })),
      bmson: { info: { modeHint } },
    });

    // A keyboard-24k chart that only touches x ≤ 9 lands on `11..19` alone, which the lane rules read as 9 KEY / 7 KEY.
    expect(resolveChartPlayVariant(bmson('keyboard-24k', ['11', '12', '13', '14', '15', '16', '17', '18', '19']))).toBe(
      '24',
    );
    expect(resolveChartPlayVariant(bmson('keyboard-24k', ['11', '18']))).toBe('24');
    expect(resolveChartPlayVariant(bmson(' keyboard-24k ', ['11']))).toBe('24');
    expect(resolveChartPlayVariant(bmson('keyboard-24k-double', ['11', '18']))).toBe('48');
    expect(resolveChartPlayVariant(bmson('keyboard-24k-double', []))).toBe('48');
    // Other hints are not authoritative: the lanes decide.
    expect(resolveChartPlayVariant(bmson('beat-7k', ['11', '12', '13', '14', '15', '16', '17', '18', '19']))).toBe('9');
    expect(resolveChartPlayVariant(bmson('keyboard-48k', ['11', '18']))).toBe('7');
    expect(resolveChartPlayVariant(bmson('constructor', ['11']))).toBe('5');
    expect(resolveChartPlayVariant(bmson(undefined, ['11', '1A']))).toBe('24');
  });

  test('resolve long note helpers return empty results for non-BMS charts and missing LNOBJ markers', () => {
    const nonBMS = createEmptyJSON('json');
    const nonBMSLongNotes = resolveBMSLongNotes(nonBMS);
    const nonBmsLNOBJ = resolveLNOBJLongNotes(nonBMS);
    expect(nonBMSLongNotes.notes).toEqual([]);
    expect(nonBMSLongNotes.suppressedTriggerEvents.size).toBe(0);
    expect(nonBmsLNOBJ.startToEndBeat.size).toBe(0);
    expect(nonBmsLNOBJ.endEvents.size).toBe(0);

    const bms = createEmptyJSON('bms');
    bms.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const missingLNOBJ = resolveLNOBJLongNotes(bms);
    expect(missingLNOBJ.startToEndBeat.size).toBe(0);
    expect(missingLNOBJ.endEvents.size).toBe(0);

    const noLongNoteChannels = resolveBMSLongNotes(bms);
    expect(noLongNoteChannels.notes).toEqual([]);
    expect(noLongNoteChannels.suppressedTriggerEvents.size).toBe(0);
  });

  test('collectLNOBJEndEvents returns only paired LNOBJ end markers', () => {
    const json = createEmptyJSON('bms');
    json.bms.lnObjs = ['AA'];
    const startA: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const endA: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'AA' };
    const sameBeatLNOBJ: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: 'AA' };
    const startB: BeMusicEvent = { measure: 0, channel: '12', position: [1, 2], value: '02' };
    const endB: BeMusicEvent = { measure: 0, channel: '12', position: [3, 4], value: 'AA' };
    const invisibleLNOBJ: BeMusicEvent = { measure: 0, channel: '31', position: [1, 1], value: 'AA' };
    json.events = [startA, endA, sameBeatLNOBJ, startB, endB, invisibleLNOBJ];

    const endEvents = collectLNOBJEndEvents(json);
    expect(endEvents.size).toBe(2);
    expect(endEvents.has(endA)).toBe(true);
    expect(endEvents.has(endB)).toBe(true);
    expect(endEvents.has(sameBeatLNOBJ)).toBe(false);
    expect(endEvents.has(invisibleLNOBJ)).toBe(false);
  });

  test('resolveLNOBJLongNotes accepts multiple LNOBJ declarations', () => {
    const json = createEmptyJSON('bms');
    json.bms.lnObjs = ['AA', 'BB'];
    const startA: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const endA: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'AA' };
    const startB: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: '02' };
    const endB: BeMusicEvent = { measure: 0, channel: '12', position: [1, 4], value: 'BB' };
    json.events = [startA, endA, startB, endB];

    const resolved = resolveLNOBJLongNotes(json);
    expect(resolved.endEvents.has(endA)).toBe(true);
    expect(resolved.endEvents.has(endB)).toBe(true);
    expect(resolved.startToEndBeat.get(startA)).toBeCloseTo(1, 6);
    expect(resolved.startToEndBeat.get(startB)).toBeCloseTo(1, 6);
  });

  test('resolveLNOBJLongNotes treats `#BASE 62` LN-end IDs case-sensitively', () => {
    const json = createEmptyJSON('bms');
    json.bms.base = 62;
    // Lowercase `aa` is a distinct ID from uppercase `AA` once the chart opts into base-62. The resolver must match
    // case-sensitively so events tagged `aa` only mark the LN end when the chart actually authored `#LNOBJ aa`.
    json.bms.lnObjs = ['aa'];
    const start: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const matchingLowerEnd: BeMusicEvent = { measure: 0, channel: '11', position: [1, 4], value: 'aa' };
    json.events = [start, matchingLowerEnd];

    const resolved = resolveLNOBJLongNotes(json);
    expect(resolved.endEvents.has(matchingLowerEnd)).toBe(true);
    expect(resolved.startToEndBeat.get(start)).toBeCloseTo(1, 6);

    // And confirm an uppercase `AA` token does NOT close the LN when only lowercase `aa` was registered as a marker.
    const startB: BeMusicEvent = { measure: 0, channel: '12', position: [0, 1], value: '02' };
    const wrongCaseEnd: BeMusicEvent = { measure: 0, channel: '12', position: [1, 4], value: 'AA' };
    json.events = [start, matchingLowerEnd, startB, wrongCaseEnd];
    const resolvedAgain = resolveLNOBJLongNotes(json);
    expect(resolvedAgain.endEvents.has(wrongCaseEnd)).toBe(false);
    expect(resolvedAgain.startToEndBeat.get(startB)).toBeUndefined();
  });

  test('resolveLNOBJLongNotes prioritizes 51-69 objects over LNOBJ at the same tick', () => {
    const json = createEmptyJSON('bms');
    json.bms.lnObjs = ['AA'];
    const start: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
    const lnobjEnd: BeMusicEvent = { measure: 0, channel: '11', position: [2, 4], value: 'AA' };
    const legacyLongNote: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
    json.events = [start, lnobjEnd, legacyLongNote];

    const resolved = resolveLNOBJLongNotes(json);
    expect(resolved.endEvents.has(lnobjEnd)).toBe(false);
    expect(resolved.startToEndBeat.get(start)).toBeUndefined();
  });

  test('resolveBMSLongNotes pairs 51-59 and 61-69 in LNTYPE=1 and suppresses end triggers', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 1;
    const startA: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const endA: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
    const orphanA: BeMusicEvent = { measure: 0, channel: '51', position: [3, 4], value: '03' };
    const startB: BeMusicEvent = { measure: 0, channel: '61', position: [1, 4], value: '04' };
    const endB: BeMusicEvent = { measure: 1, channel: '61', position: [1, 4], value: '05' };
    json.events = [startA, endA, orphanA, startB, endB];

    const resolved = resolveBMSLongNotes(json);
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

  test('resolveBMSLongNotes defaults to LNTYPE=1 when #LNTYPE is omitted', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    const start: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const end: BeMusicEvent = { measure: 0, channel: '51', position: [2, 4], value: '02' };
    json.events = [start, end];

    const resolved = resolveBMSLongNotes(json);
    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]).toMatchObject({
      event: start,
      channel: '11',
      beat: 0,
    });
    expect(resolved.notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(resolved.suppressedTriggerEvents.has(end)).toBe(true);
  });

  test('resolveBMSLongNotes expands continuous tokens in LNTYPE=2 and suppresses continuation triggers', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 2;
    const runStart: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const runContinue: BeMusicEvent = { measure: 0, channel: '51', position: [1, 4], value: '01' };
    const secondRun: BeMusicEvent = { measure: 0, channel: '51', position: [3, 4], value: '01' };
    const crossStart: BeMusicEvent = { measure: 1, channel: '61', position: [3, 4], value: '02' };
    const crossContinue: BeMusicEvent = { measure: 2, channel: '61', position: [0, 4], value: '02' };
    json.events = [runStart, runContinue, secondRun, crossStart, crossContinue];

    const resolved = resolveBMSLongNotes(json);
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

  test('resolveBMSLongNotes can infer LNTYPE=2 when #LNTYPE is omitted', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    const start: BeMusicEvent = { measure: 0, channel: '61', position: [0, 4], value: '01' };
    const contA: BeMusicEvent = { measure: 0, channel: '61', position: [1, 4], value: '01' };
    const contB: BeMusicEvent = { measure: 0, channel: '61', position: [2, 4], value: '01' };
    json.events = [start, contA, contB];

    const defaultResolved = resolveBMSLongNotes(json);
    expect(defaultResolved.notes).toHaveLength(2);
    expect(defaultResolved.notes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(defaultResolved.notes[1]?.endBeat).toBeUndefined();

    const inferredResolved = resolveBMSLongNotes(json, { inferLNTypeWhenMissing: true });
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

  test('resolveBMSLongNotes keeps LNTYPE=1 inference when events are not a type-2 continuation run', () => {
    const json = createEmptyJSON('bms');
    const start: BeMusicEvent = { measure: 0, channel: '51', position: [0, 4], value: '01' };
    const later: BeMusicEvent = { measure: 1, channel: '51', position: [1, 4], value: '01' };
    json.events = [start, later];

    const resolved = resolveBMSLongNotes(json, { inferLNTypeWhenMissing: true });
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

  test('resolveBMSLongNotes keeps LNTYPE=1 inference for a two-event same-value pair', () => {
    const json = createEmptyJSON('bms');
    const start: BeMusicEvent = { measure: 0, channel: '55', position: [0, 4], value: 'AA' };
    const end: BeMusicEvent = { measure: 0, channel: '55', position: [1, 4], value: 'AA' };
    json.events = [start, end];

    const resolved = resolveBMSLongNotes(json, { inferLNTypeWhenMissing: true });

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

  test('resolveBMSLongNotes keeps LNTYPE=1 inference for a cross-measure same-value pair', () => {
    const json = createEmptyJSON('bms');
    const start: BeMusicEvent = { measure: 0, channel: '55', position: [3, 4], value: 'AA' };
    const end: BeMusicEvent = { measure: 1, channel: '55', position: [0, 4], value: 'AA' };
    json.events = [start, end];

    const resolved = resolveBMSLongNotes(json, { inferLNTypeWhenMissing: true });

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
