import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// The engine writes to a mocked Node audio sink (shared state in test-support/player-fixtures.ts).
vi.mock('./audio-sink.ts', async () => (await import('./test-support/player-fixtures.ts')).mockAudioSinkModule());

import { createEmptyJSON } from '../../json/src/index.ts';
import { parseChart } from '../../parser/src/index.ts';
import { type AudioSession, autoPlay, type CreateAudioSessionContext, manualPlay } from './index.ts';
import { preparePlaybackChartData } from './core/bootstrap.ts';
import {
  extractInvisiblePlayableNotes,
  extractLandmineNotes,
  extractPlayableNotes,
  extractTimedNotes,
} from './display.ts';
import {
  resetAudioSinkState,
  audioSinkState,
  createLNOBJLongNoteChart,
  createLandmineOnlyChart,
  HELD_LANDMINE_INPUT,
  createScheduledInputRuntime,
  hasAnyNonSilentAudioWrite,
} from './test-support/player-fixtures.ts';

beforeEach(resetAudioSinkState);

describe('player', () => {
  test('player: LR2 negative BPM freezes autoplay judging and audio at the reversal', async () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.resources.bpm['02'] = -240;
    json.resources.wav = { '01': 'a.wav', '02': 'b.wav', '03': 'bgm.wav' };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '01', position: [0, 1] as const, value: '03' },
      { measure: 2, channel: '08', position: [0, 1] as const, value: '02' },
      { measure: 3, channel: '11', position: [0, 1] as const, value: '02' },
      { measure: 3, channel: '01', position: [0, 1] as const, value: '03' },
    ];

    const triggeredEvents: string[] = [];
    const summary = await autoPlay(json, {
      speed: 4,
      leadInMs: 0,
      audio: true,
      tui: false,
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([]),
    });

    // Pre-reversal note keysound + BGM fired; nothing behind the reversal did (including the epilogue flush).
    expect(triggeredEvents).toContain('01');
    expect(triggeredEvents.filter((value) => value === '03')).toHaveLength(1);
    expect(triggeredEvents).not.toContain('02');
    // Autoplay PGREATs the pre-reversal note; the post-reversal note stays unjudged.
    expect(summary.perfect).toBe(1);
    expect(summary.poor).toBe(0);
    expect(summary.total).toBe(2);
    // LR2's HP-zeroing on exit does not care about autoplay: a note left outstanding fails the run.
    expect(summary.gauge?.current).toBe(0);
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: LR2 negative BPM orders the reversal tick by op — BGM fires, the lane note freezes', async () => {
    // BPM 240 → measure = 1 s. The reversal (#BPM02 -240 via channel 08), a note, and a BGM share measure 2 [0,1]
    // (chart 2 s exactly). LR2 sorts same-tick events by op (`CMP_NotesByRealTimingOp`): the BGM (op 1) fires before
    // the negative BPM (op 8), the lane note (op 11) after it — so the BGM sounds and the boundary note neither
    // sounds nor judges, exactly like a note strictly behind the reversal.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.resources.bpm['02'] = -240;
    json.resources.wav = { '01': 'a.wav', '02': 'b.wav', '03': 'bgm.wav' };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 2, channel: '08', position: [0, 1] as const, value: '02' },
      { measure: 2, channel: '11', position: [0, 1] as const, value: '02' },
      { measure: 2, channel: '01', position: [0, 1] as const, value: '03' },
    ];

    const triggeredEvents: string[] = [];
    const summary = await autoPlay(json, {
      speed: 4,
      leadInMs: 0,
      audio: true,
      tui: false,
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([]),
    });

    // The 1 s note's keysound and the boundary BGM fired; the boundary note's keysound never did.
    expect(triggeredEvents).toContain('01');
    expect(triggeredEvents).toContain('03');
    expect(triggeredEvents).not.toContain('02');
    // Autoplay PGREATs the pre-reversal note only; the boundary note ends the run unjudged (total still counts it).
    expect(summary.perfect).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.perfect + summary.great + summary.good + summary.bad + summary.poor).toBe(1);
    // The outstanding boundary note fails the run (LR2 zeroes HP on leaving with notes unjudged).
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: an LN held across the LR2 reversal is never judged (no POOR) and fails the run', async () => {
    // BPM 240 → measure = 1 s. A legacy LNOBJ long note spans the reversal: head at 1 s, `#BPM02 -240` via
    // channel 08 at 2 s, tail at 3 s (|−240| keeps one measure per second). Past the reversal LR2 judges the hold on
    // the mirrored clock t' = 2R - now, which never reaches the tail, so a hold that is never released is never
    // judged: no tail judgment, no POOR, and the run still completes. Replay input keeps the press deterministic
    // (exact chart microseconds) and, with no matching `up`, holds the lane's kitty press state through the end.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.metadata.rank = 2;
    json.bms.lnObjs = ['AA'];
    json.resources.bpm['02'] = -240;
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 2, channel: '08', position: [0, 1] as const, value: '02' },
      { measure: 3, channel: '11', position: [0, 1] as const, value: 'AA' },
    ];

    const summary = await manualPlay(json, {
      speed: 4,
      leadInMs: 0,
      audio: false,
      tui: false,
      replayInputs: [{ seq: 0, timeUs: 1_000_000, action: 'down', channels: ['11'] }],
    });

    // The spanning hold neither POORs nor BADs, and the run completed (manualPlay resolved without interrupt).
    expect(summary.total).toBe(1);
    expect(summary.poor).toBe(0);
    expect(summary.bad).toBe(0);
    // The hold gets no judgment at all — not even the head's verdict at the tail (that would be the normal
    // completion path, which the mirrored clock never reaches).
    expect(summary.perfect + summary.great + summary.good + summary.bad + summary.poor).toBe(0);
    // The open hold is an outstanding note, though: like LR2 (HP = 0 on leaving with notes unjudged), the run is
    // FAILED with the gauge at 0.
    expect(summary.gauge?.current).toBe(0);
    expect(summary.gauge?.cleared).toBe(false);
  });

  test('player: routes audio through createAudioSession factory when supplied', async () => {
    // Phase 1 of the web-engine integration plan exposes a `createAudioSession` factory option so the browser
    // runtime can plug in a Web Audio backend without forking the engine. The factory's returned `AudioSession`
    // must short-circuit the bundled Node sink path entirely — verified here by asserting the Node sink mock
    // never received a `write()` call while the custom factory's `start` / `triggerEvent` / `finish` did.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];
    json.resources.wav = { '01': 'mock.wav' };

    audioSinkState.writes.length = 0;
    const triggeredEvents: string[] = [];
    let started = false;
    let finished = false;
    const customSession: AudioSession = {
      backendLabel: 'mock-web-audio',
      chartStartDelayMs: 0,
      start: () => {
        started = true;
      },
      pause: () => undefined,
      resume: () => undefined,
      finish: async () => {
        finished = true;
      },
      dispose: async () => undefined,
      triggerEvent: (event) => {
        triggeredEvents.push(event.value);
      },
      stopChannel: () => undefined,
    };
    const seenContexts: CreateAudioSessionContext[] = [];

    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      tui: false,
      writeOutput: () => undefined,
      createAudioSession: async (context) => {
        seenContexts.push(context);
        return customSession;
      },
    });

    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]?.mode).toBe('auto');
    // The factory receives the post-#RANDOM-resolution clone, not the caller's input. The clone preserves the
    // chart's identifying fields (bpm / events / resources) so a backend can re-derive everything it needs.
    expect(seenContexts[0]?.json.metadata.bpm).toBe(120);
    expect(seenContexts[0]?.json.events).toHaveLength(1);
    expect(started).toBe(true);
    expect(finished).toBe(true);
    expect(triggeredEvents).toContain('01');
    // The Node sink mock from the file's top-level `vi.mock` registers a `write` push for every audio chunk; the
    // factory short-circuit means it should remain untouched.
    expect(audioSinkState.writes.length).toBe(0);
  });

  test('player: falls back to the bundled Node sink when createAudioSession returns undefined', async () => {
    // Returning `undefined` from the factory must be treated as "no opinion" so a runtime can probe optional
    // backends without forfeiting the default sink. The Node sink mock should still receive writes in this path.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '11', position: [0, 1] as const, value: '01' }];

    audioSinkState.writes.length = 0;
    let factoryCalls = 0;
    await autoPlay(json, {
      auto: true,
      speed: 240,
      leadInMs: 0,
      audio: true,
      tui: false,
      writeOutput: () => undefined,
      createAudioSession: async () => {
        factoryCalls += 1;
        return undefined;
      },
    });

    expect(factoryCalls).toBe(1);
    expect(audioSinkState.writes.length).toBeGreaterThan(0);
  });

  test('player: manual landmine hit sounds #WAV00 when audio is enabled', async () => {
    // `explode.wav` doesn't exist on disk, so the audible assertion opts into the debug fallback tone — the
    // spec-compliant default for a missing sample is silence (covered by the companion test below).
    await manualPlay(createLandmineOnlyChart(), {
      speed: 1,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      limiter: false,
      tui: false,
      missingSampleToneSeconds: 0.06,
      writeOutput: () => undefined,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(true);
  });

  test.each(['D1', 'DA', 'EO'])('player: a mine on lane %s preloads #WAV00', async (channel) => {
    const json = createLandmineOnlyChart();
    json.events = [
      { measure: 0, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel, position: [0, 1] as const, value: '10' },
    ];
    const details: Array<string | undefined> = [];
    await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      tui: false,
      writeOutput: () => undefined,
      onLoadProgress: (progress) => {
        details.push(progress.detail);
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 50, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(details).toContain('explode.wav');
  });

  test('player: missing #WAVxx files are silent by default (no fallback tone)', async () => {
    await manualPlay(createLandmineOnlyChart(), {
      speed: 1,
      leadInMs: 0,
      audio: true,
      audioHeadPaddingMs: 0,
      audioLeadMs: 0,
      audioLeadMaxMs: 0,
      limiter: false,
      tui: false,
      writeOutput: () => undefined,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(hasAnyNonSilentAudioWrite()).toBe(false);
  });

  test('player: derives long-note end beat from bmson notes.l', () => {
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.bmson.info.resolution = 240;
    json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240 } }];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(1);
    expect(notes[0].beat).toBe(0);
    expect(notes[0].endBeat).toBeCloseTo(1, 6);
    // beatoraja bmson extension: unspecified `info.ln_type` / note `t` falls back to the LR2-aligned default LN
    // (mode 1, no tail release judgment) — the same default the BMS side uses for a missing #LNMODE.
    expect(notes[0].longNoteMode).toBe(1);
  });

  test('player: bmson note t overrides info.ln_type, which overrides the LN default', () => {
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.bmson.info.resolution = 240;
    json.bmson.info.lnType = 2;
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240, t: 3 } },
      { measure: 1, channel: '12', position: [0, 1], value: '02', bmson: { l: 240 } },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(2);
    expect(notes[0].longNoteMode).toBe(3); // per-note t wins
    expect(notes[1].longNoteMode).toBe(2); // chart-level info.ln_type
  });

  test('player: derives long-note end beat from bms #LNOBJ', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    json.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 4], value: 'AA' },
      { measure: 0, channel: '11', position: [2, 4], value: '02' },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(2);
    expect(notes[0].beat).toBe(0);
    expect(notes[0].endBeat).toBeCloseTo(1, 6);
    expect(notes[0].endSeconds).toBeCloseTo(0.5, 6);
    expect(notes[0].longNoteMode).toBe(1);
    expect(notes.some((note) => note.event.value === 'AA')).toBe(false);
    expect(notes[1].endBeat).toBeUndefined();
  });

  test('player: derives long-note end beat from multiple #LNOBJ declarations', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA', 'BB'];
    const startA = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const endA = { measure: 0, channel: '11', position: [1, 4] as const, value: 'AA' };
    const startB = { measure: 0, channel: '12', position: [0, 1] as const, value: '02' };
    const endB = { measure: 0, channel: '12', position: [1, 4] as const, value: 'BB' };
    json.events = [startA, endA, startB, endB];

    const notes = extractPlayableNotes(json);
    expect(notes.find((note) => note.event === startA)?.endBeat).toBeCloseTo(1, 6);
    expect(notes.find((note) => note.event === startB)?.endBeat).toBeCloseTo(1, 6);
  });

  test('player: prioritizes 51-69 over LNOBJ when the same lane tick conflicts', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    const start = { measure: 0, channel: '11', position: [0, 1] as const, value: '01' };
    const lnobjEnd = { measure: 0, channel: '11', position: [2, 4] as const, value: 'AA' };
    const legacy = { measure: 0, channel: '51', position: [2, 4] as const, value: '02' };
    json.events = [start, lnobjEnd, legacy];

    const notes = extractPlayableNotes(json);
    expect(notes.find((note) => note.event === start)?.endBeat).toBeUndefined();
  });

  test('player: derives long-note end beat from bms LNTYPE=1 channels 51-59/61-69', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 1;
    json.events = [
      { measure: 0, channel: '51', position: [0, 4], value: '01' },
      { measure: 0, channel: '51', position: [2, 4], value: '02' },
      { measure: 0, channel: '61', position: [1, 4], value: '03' },
      { measure: 1, channel: '61', position: [1, 4], value: '04' },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      channel: '11',
      beat: 0,
    });
    expect(notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(notes[1]).toMatchObject({
      channel: '21',
      beat: 1,
    });
    expect(notes[1]?.endBeat).toBeCloseTo(5, 6);
  });

  test('player: derives long-note span from bms LNTYPE=2 continuity channels', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnType = 2;
    json.events = [
      { measure: 0, channel: '51', position: [0, 4], value: '01' },
      { measure: 0, channel: '51', position: [1, 4], value: '01' },
      { measure: 0, channel: '51', position: [3, 4], value: '01' },
      { measure: 1, channel: '61', position: [3, 4], value: '02' },
      { measure: 2, channel: '61', position: [0, 4], value: '02' },
    ];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatchObject({
      channel: '11',
      beat: 0,
    });
    expect(notes[0]?.endBeat).toBeCloseTo(2, 6);
    expect(notes[1]).toMatchObject({
      channel: '11',
      beat: 3,
    });
    expect(notes[1]?.endBeat).toBeCloseTo(4, 6);
    expect(notes[2]).toMatchObject({
      channel: '21',
      beat: 7,
    });
    expect(notes[2]?.endBeat).toBeCloseTo(9, 6);
  });

  test('player: can opt-in to infer LNTYPE=2 when #LNTYPE is omitted', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '61', position: [0, 4], value: '01' },
      { measure: 0, channel: '61', position: [1, 4], value: '01' },
      { measure: 0, channel: '61', position: [2, 4], value: '01' },
    ];

    const defaultNotes = extractPlayableNotes(json);
    expect(defaultNotes).toHaveLength(2);
    expect(defaultNotes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(defaultNotes[1]?.endBeat).toBeUndefined();

    const inferredNotes = extractPlayableNotes(json, {
      inferBmsLNTypeWhenMissing: true,
    });
    expect(inferredNotes).toHaveLength(1);
    expect(inferredNotes[0]?.channel).toBe('21');
    expect(inferredNotes[0]?.beat).toBe(0);
    expect(inferredNotes[0]?.endBeat).toBeCloseTo(3, 6);
  });

  test('player: keeps a two-event same-value legacy LN pair as LNTYPE=1 when auto inference is enabled', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '55', position: [0, 4], value: 'AA' },
      { measure: 0, channel: '55', position: [1, 4], value: 'AA' },
    ];

    const notes = extractPlayableNotes(json, { inferBmsLNTypeWhenMissing: true });

    expect(notes).toHaveLength(1);
    expect(notes[0]?.channel).toBe('15');
    expect(notes[0]?.beat).toBe(0);
    expect(notes[0]?.endBeat).toBeCloseTo(1, 6);
  });

  test('player: extracts landmine objects and maps them to playable lanes', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: 'D1', position: [0, 1], value: '10' },
      { measure: 1, channel: 'E6', position: [0, 1], value: '20' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
    ];

    const landmines = extractLandmineNotes(json);
    expect(landmines).toHaveLength(2);
    expect(landmines[0]?.channel).toBe('11');
    expect(landmines[1]?.channel).toBe('26');
    expect(landmines[0]?.mine).toBe(true);
  });

  test('player: extracts invisible channels and maps them to playable lanes', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '31', position: [0, 1], value: '10' },
      { measure: 1, channel: '44', position: [0, 1], value: '20' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
    ];

    const invisible = extractInvisiblePlayableNotes(json);
    expect(invisible).toHaveLength(2);
    expect(invisible[0]?.channel).toBe('11');
    expect(invisible[1]?.channel).toBe('24');
    expect(invisible[0]?.invisible).toBe(true);
  });

  test('player: extracts extended 24-key lane channels as playable notes, LNs, mines and invisibles', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['AA'];
    json.events = [
      // Extended playable columns — `1A` is lane 10 of the 1P bank, `2O` lane 24 of the 2P bank.
      { measure: 0, channel: '1A', position: [0, 1], value: '01' },
      { measure: 0, channel: '2O', position: [0, 1], value: '01' },
      // Legacy long note on an extended column (`5X` / `6X` map back onto `1X` / `2X`).
      { measure: 1, channel: '5B', position: [0, 1], value: '01' },
      { measure: 1, channel: '5B', position: [2, 4], value: '01' },
      // `#LNOBJ` long note on another extended column.
      { measure: 2, channel: '1C', position: [0, 1], value: '01' },
      { measure: 2, channel: '1C', position: [2, 4], value: 'AA' },
      // Landmine + invisible object on extended columns.
      { measure: 3, channel: 'DD', position: [0, 1], value: '10' },
      { measure: 3, channel: '3E', position: [0, 1], value: '01' },
    ];

    const timed = extractTimedNotes(json, { includeLandmine: true, includeInvisible: true });
    expect(timed.playableNotes.map((note) => note.channel)).toEqual(['1A', '2O', '1B', '1C']);
    // Both long notes survive with a tail; the `#LNOBJ` terminator is consumed rather than counted.
    expect(timed.playableNotes.filter((note) => note.endBeat !== undefined).map((note) => note.channel)).toEqual([
      '1B',
      '1C',
    ]);
    expect(timed.landmineNotes.map((note) => note.channel)).toEqual(['1D']);
    expect(timed.invisibleNotes.map((note) => note.channel)).toEqual(['1E']);
  });

  test('player: two notes on one lane and position become one judged note; the other keysound is shadowed', () => {
    const json = parseChart(['#BPM 120', '#WAV01 a.wav', '#WAV02 b.wav', '#00111:01', '#00111:02', ''].join('\n'));

    const timed = extractTimedNotes(json);
    expect(timed.playableNotes.map((note) => [note.channel, note.event.value])).toEqual([['11', '01']]);
    expect(timed.shadowedNotes.map((note) => [note.channel, note.event.value])).toEqual([['11', '02']]);
    expect(extractPlayableNotes(json)).toHaveLength(1);
  });

  test('player: a duplicate with the same keysound is dropped without a shadowed sound', () => {
    const json = parseChart(['#BPM 120', '#WAV01 a.wav', '#00111:0101', '#00111:01', ''].join('\n'));

    const timed = extractTimedNotes(json);
    expect(timed.playableNotes.map((note) => note.event.position)).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(timed.shadowedNotes).toEqual([]);
  });

  test('player: a long note wins over a tap on the same lane and position (5x and #LNOBJ)', () => {
    const legacy = parseChart(
      ['#BPM 120', '#WAV01 a.wav', '#WAV02 b.wav', '#00111:02', '#00151:01', '#00251:01', ''].join('\n'),
    );
    const legacyTimed = extractTimedNotes(legacy);
    expect(legacyTimed.playableNotes).toHaveLength(1);
    expect(legacyTimed.playableNotes[0]?.event.value).toBe('01');
    expect(legacyTimed.playableNotes[0]?.endBeat).toBeCloseTo(8, 6);
    expect(legacyTimed.shadowedNotes.map((note) => note.event.value)).toEqual(['02']);

    const lnobj = parseChart(
      ['#BPM 120', '#LNOBJ ZZ', '#WAV01 a.wav', '#WAV02 b.wav', '#00111:01', '#00111:02', '#00211:ZZ', ''].join('\n'),
    );
    const lnobjTimed = extractTimedNotes(lnobj);
    expect(lnobjTimed.playableNotes).toHaveLength(1);
    expect(lnobjTimed.playableNotes[0]?.endBeat).toBeCloseTo(8, 6);
    expect(lnobjTimed.shadowedNotes).toHaveLength(1);
    expect(lnobjTimed.shadowedNotes[0]?.event.value).not.toBe(lnobjTimed.playableNotes[0]?.event.value);
  });

  test('player: layered bmson notes on one x and y are one judged note, the first sound channel', () => {
    const json = parseChart(
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
        sound_channels: [
          { name: 'piano.wav', notes: [{ x: 1, y: 0 }] },
          { name: 'bass.wav', notes: [{ x: 1, y: 0 }] },
          { name: 'pad.wav', notes: [{ x: 2, y: 0 }] },
        ],
      }),
      'bmson',
    );

    const timed = extractTimedNotes(json);
    expect(timed.playableNotes.map((note) => [note.channel, note.event.value])).toEqual([
      ['11', '01'],
      ['12', '03'],
    ]);
    expect(timed.shadowedNotes.map((note) => [note.channel, note.event.value])).toEqual([['11', '02']]);
  });

  test('player: mines and invisible objects on a duplicated note position are untouched', () => {
    const json = parseChart(
      ['#BPM 120', '#WAV01 a.wav', '#WAV02 b.wav', '#00111:01', '#00111:02', '#00131:01', '#001D1:10', ''].join('\n'),
    );

    const timed = extractTimedNotes(json, { includeLandmine: true, includeInvisible: true });
    expect(timed.playableNotes).toHaveLength(1);
    expect(timed.invisibleNotes.map((note) => note.channel)).toEqual(['11']);
    expect(timed.landmineNotes.map((note) => note.channel)).toEqual(['11']);
  });

  test('player: manual play sounds a shadowed duplicate keysound as background and judges one note', async () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.resources.wav = { '01': 'a.wav', '02': 'b.wav' };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '11', position: [0, 1] as const, value: '02' },
    ];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.scorableNotes).toHaveLength(1);

    const triggeredEvents: string[] = [];
    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeWindowMs: 50,
      preparedChart,
      writeOutput: () => undefined,
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1000, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1150, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect([...triggeredEvents].sort()).toEqual(['01', '02']);
    expect(summary.total).toBe(1);
  });

  test('player: FREE ZONE (17 / 27) only applies to the IIDX families', () => {
    const createChart = (channels: string[]) => {
      const json = createEmptyJSON('bms');
      json.metadata.bpm = 120;
      json.events = channels.map((channel) => ({ measure: 0, channel, position: [0, 1] as const, value: '01' }));
      return json;
    };

    // IIDX 7 KEY — `17` keeps the quarter-note FREE ZONE tail.
    const iidx = extractPlayableNotes(createChart(['11', '17', '18']));
    expect(iidx.find((note) => note.channel === '17')?.endBeat).toBeCloseTo(1, 6);

    // 24 KEY — `17` is lane 7 of the keyboard bank, so it stays an ordinary tap. Classified from the
    // chart's own extended lane channel, without the host passing a variant.
    const keyboard = extractPlayableNotes(createChart(['11', '17', '1A']));
    expect(keyboard.find((note) => note.channel === '17')?.endBeat).toBeUndefined();

    // Same result when the host supplies the variant instead of letting the chart be classified.
    const overridden = extractPlayableNotes(createChart(['11', '17', '18']), { playVariant: '9' });
    expect(overridden.find((note) => note.channel === '17')?.endBeat).toBeUndefined();
  });

  test('player: extractTimedNotes matches the individual extraction helpers', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [
      { measure: 0, channel: '31', position: [0, 4], value: '10' },
      { measure: 0, channel: '11', position: [1, 4], value: '01' },
      { measure: 1, channel: 'D2', position: [0, 1], value: '20' },
      { measure: 2, channel: '44', position: [0, 1], value: '30' },
    ];

    const timed = extractTimedNotes(json, {
      includeLandmine: true,
      includeInvisible: true,
    });
    const snapshot = {
      playableNotes: timed.playableNotes.map((note) => ({
        channel: note.channel,
        beat: note.beat,
        endBeat: note.endBeat,
        invisible: note.invisible,
        mine: (note as { mine?: boolean }).mine,
      })),
      landmineNotes: timed.landmineNotes.map((note) => ({
        channel: note.channel,
        beat: note.beat,
        mine: note.mine,
      })),
      invisibleNotes: timed.invisibleNotes.map((note) => ({
        channel: note.channel,
        beat: note.beat,
        invisible: note.invisible,
      })),
    };

    expect(snapshot.playableNotes).toEqual(
      extractPlayableNotes(json).map((note) => ({
        channel: note.channel,
        beat: note.beat,
        endBeat: note.endBeat,
        invisible: note.invisible,
        mine: (note as { mine?: boolean }).mine,
      })),
    );
    expect(snapshot.landmineNotes).toEqual(
      extractLandmineNotes(json).map((note) => ({
        channel: note.channel,
        beat: note.beat,
        mine: note.mine,
      })),
    );
    expect(snapshot.invisibleNotes).toEqual(
      extractInvisiblePlayableNotes(json).map((note) => ({
        channel: note.channel,
        beat: note.beat,
        invisible: note.invisible,
      })),
    );
  });

  test('player: assigns quarter-note length to free-zone notes', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 0, channel: '17', position: [0, 1], value: '01' }];

    const notes = extractPlayableNotes(json);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.channel).toBe('17');
    expect(notes[0]?.beat).toBeCloseTo(0, 6);
    expect(notes[0]?.endBeat).toBeCloseTo(1, 6);
    expect(notes[0]?.endSeconds).toBeCloseTo(0.5, 6);
  });

  test('player: defaults BMS long notes to LNMODE=1 in manual play', async () => {
    const summary = await manualPlay(createLNOBJLongNoteChart(), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(summary.perfect + summary.great + summary.good).toBe(1);
  });
});
