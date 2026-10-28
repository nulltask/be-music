import {
  createEmptyJSON,
  type BmsonMineChannelEntry,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';
import { countDistinctValues, createBmsonValueKeyTable, encodeBmsonKey, resolveBmsonKeyBase } from './bmson-keys.ts';
import { normalizeBmsonNoteLength, sortAndNormalizeEvents } from './event-utils.ts';
import {
  bmsPlayableChannelToInvisibleChannel,
  bmsPlayableChannelToLandmineChannel,
  buildBmsonLaneMap,
  createBmsonPositionResolver,
  createMeasureLengthsFromBmsonLines,
  type BmsonDocument,
  normalizeBmsonBPMEvents,
  normalizeBmsonBGAForIR,
  normalizeBmsonInfoForIR,
  normalizeBmsonKeyChannels,
  normalizeBmsonMineChannels,
  normalizeBmsonLines,
  normalizeBmsonScrollEvents,
  normalizeBmsonSoundChannels,
  normalizeBmsonStopEvents,
  resolveBmsonResolution,
} from './bmson.ts';

export function parseBmsonDocument(document: BmsonDocument): BeMusicJSON {
  const json = createEmptyJSON('bmson');

  const info = document.info ?? {};
  if (typeof document.version === 'string' && document.version.length > 0) {
    json.bmson.version = document.version;
  }

  const resolution = resolveBmsonResolution(document);
  json.bmson.info = normalizeBmsonInfoForIR(info, resolution);
  // Per spec, the difference between "lines missing" and "lines: []" matters: missing → assume 4/4 and generate a
  // barline every 4 quarter notes (the renderer's default derive-from-events path); explicit empty → no barlines at all
  // (the "100 % minimoo-G effect"). Detect the explicit- empty case here so the IR carries the suppress flag, since
  // both shapes collapse to `[]` after `normalizeBmsonLines`.
  const linesAuthoredEmpty = Array.isArray(document.lines) && document.lines.length === 0;
  if (linesAuthoredEmpty) {
    json.bmson.barlinesSuppressed = true;
  }
  const lines = normalizeBmsonLines(document.lines);
  const positionResolver = createBmsonPositionResolver(resolution, lines);
  if (lines.length > 0) {
    json.preservation.bmson.lines = lines;
  }
  json.bmson.bga = normalizeBmsonBGAForIR(document.bga);

  const measureLengths = createMeasureLengthsFromBmsonLines(lines, resolution);
  if (measureLengths.length > 0) {
    json.measures = measureLengths;
  }

  json.metadata.title = json.bmson.info.title;
  json.metadata.subtitle = json.bmson.info.subtitle;
  json.metadata.artist = json.bmson.info.artist;
  json.metadata.genre = json.bmson.info.genre;
  if (Number.isFinite(json.bmson.info.level)) {
    json.metadata.playLevel = json.bmson.info.level;
  }

  if (Number.isFinite(json.bmson.info.initBPM) && (json.bmson.info.initBPM ?? 0) > 0) {
    json.metadata.bpm = json.bmson.info.initBPM!;
  } else {
    // bmson 1.0.0 spec — "It is a fatal error if `info.init_bpm` is unspecified." A chart that omits / zeroes / negates
    // `init_bpm` has no anchor for tempo-driven timing, so every downstream calculation (note seconds, BGA cues, gauge
    // timing) silently falls back to whatever `metadata.bpm` was seeded with — typically the `DEFAULT_BPM = 130`
    // placeholder, which produces visibly wrong playback for any chart that wasn't authored at 130. Surface the
    // violation as a parse error so the loader surfaces a clear "broken chart" diagnostic rather than playing the chart
    // back at the wrong tempo.
    throw new Error('bmson: info.init_bpm is required (spec: "It is a fatal error if info.init_bpm is unspecified")');
  }
  if (Number.isFinite(json.bmson.info.judgeRank)) {
    json.metadata.rank = json.bmson.info.judgeRank;
  }
  if (Number.isFinite(json.bmson.info.total)) {
    json.metadata.total = json.bmson.info.total;
  } else {
    // bmson 1.0.0 spec — `info.total` default is 100. We pin that here (rather than letting the BMS-flavored
    // `LR2_GROOVE_GAUGE_DEFAULT_TOTAL = 160` fallback take over) so a bmson chart that omits `total` runs with the
    // gauge curve its author / the spec assumed.
    json.metadata.total = 100;
  }
  // Mirror bmson's `info.backImage` / `bannerImage` / `eyecatchImage` onto the unified `metadata` slots so consumers
  // (the select view's BACKBMP loader, rendered banner, etc.) don't need to branch on chart format.
  if (json.bmson.info.backImage) {
    json.metadata.backBMP = json.bmson.info.backImage;
  }
  if (json.bmson.info.bannerImage) {
    json.metadata.banner = json.bmson.info.bannerImage;
  }
  if (json.bmson.info.eyecatchImage && !json.metadata.stageFile) {
    json.metadata.stageFile = json.bmson.info.eyecatchImage;
  }
  if (json.bmson.info.titleImage) json.metadata.titleImage = json.bmson.info.titleImage;

  const soundChannels = normalizeBmsonSoundChannels(document.sound_channels);
  json.preservation.bmson.soundChannels = soundChannels;
  // Lane mapping honors `mode_hint` so canonical That-Which-Must-Not-Be-Named / Pop'n bmson dialects route the right keys onto the right BMS
  // channels — the legacy positional fallback would mis-route `beat-7k` x=6/7 onto scratch (`16`) / FREE ZONE (`17`)
  // because those channel digits come next in numeric order.
  // The positional fallback numbers every lane in use, so the beatoraja lane extensions (hidden notes and mines) count
  // too: a mine on a lane no playable note uses still gets that lane instead of being dropped.
  const keyChannels = normalizeBmsonKeyChannels(document.key_channels);
  const mineChannels = normalizeBmsonMineChannels(document.mine_channels);
  const laneMap = buildBmsonLaneMap([...soundChannels, ...keyChannels, ...mineChannels], json.bmson.info.modeHint);
  const bpmEvents = normalizeBmsonBPMEvents(document.bpm_events);
  const stopEvents = normalizeBmsonStopEvents(document.stop_events);
  // Spec: `stop_events.duration` is measured in **pulses** at the chart's `resolution`. The downstream timing resolver
  // reads `resources.stop[key]` through the BMS-style `(value / 192) × (240/bpm)` formula, which expects the value in
  // "1/192-of-a-measure" units (1 measure = 4 beats = 192 BMS-spec STOP units, so 1 beat = 48 BMS units). To keep the
  // BMS / bmson paths sharing one formula, convert bmson pulses into the equivalent 1/192-measure units at parse time:
  //
  // bms_units = pulses × 48 / resolution
  //
  // Default `resolution = 240` → 1 beat (`duration = 240`) becomes `48` BMS units, which the formula evaluates to
  // `(48 / 192) × (240/bpm) = 60/bpm` seconds — exactly one beat. Without this conversion bmson stops were ~5× longer
  // than authored at the default resolution.
  const stopUnits = stopEvents.map((stopEvent) => (stopEvent.duration * 48) / resolution);
  // Of several BPM changes on one pulse the last one in the list wins (jbms-parser sets the timeline's BPM event by
  // event). Collapse them here, since `08` events on one position are ordered by key, and keys go by value.
  const bpmByPulse = new Map<number, number>();
  for (const bpmEvent of bpmEvents) {
    bpmByPulse.delete(bpmEvent.y);
    bpmByPulse.set(bpmEvent.y, bpmEvent.bpm);
  }
  const bpmValues = [...bpmByPulse.values()];
  // beatoraja extension: `scroll_events` set the lane's scroll rate from `y` on, as BMS `#SCROLLxx` on channel `SC`,
  // and the rate holds until the next event, as in BMS. jbms-parser sets the rate on the timeline at `y`, so of several
  // events on one pulse the last one in the list wins; collapse them here, since `SC` events on one position are
  // ordered by key, not by the list.
  const scrollEvents = normalizeBmsonScrollEvents(document.scroll_events);
  const scrollRateByPulse = new Map<number, number>();
  for (const scrollEvent of scrollEvents) {
    scrollRateByPulse.delete(scrollEvent.y);
    scrollRateByPulse.set(scrollEvent.y, scrollEvent.rate);
  }
  const scrollRates = [...scrollRateByPulse.values()];
  // BPM / STOP get one key per distinct value (a gimmick chart with thousands of changes usually repeats a handful of
  // values) and every sound / key / mine channel its own WAV slot. A resource that still needs more than the 1,295
  // base-36 keys moves the chart to base-62 keys rather than letting a key wrap round onto an earlier value.
  const wavSlotCount = soundChannels.length + keyChannels.length + mineChannels.length;
  const keyBase = resolveBmsonKeyBase([
    wavSlotCount,
    countDistinctValues(bpmValues),
    countDistinctValues(stopUnits),
    countDistinctValues(scrollRates),
  ]);
  if (keyBase === 62) {
    json.bms.base = 62;
  }
  for (let index = 0; index < soundChannels.length; index += 1) {
    const soundChannel = soundChannels[index]!;
    const key = encodeBmsonKey(index + 1, keyBase);
    if (key === undefined) {
      // Past the 3,843 base-62 WAV slots: drop the channel rather than overwrite an earlier channel's sample.
      break;
    }
    json.resources.wav[key] = soundChannel.name;
    const notes = soundChannel.notes ?? [];
    const playableTicks = new Set<number>();
    const bgmCandidates: Array<{ pulse: number; event: BeMusicEvent }> = [];

    for (const note of notes) {
      if (!Number.isFinite(note.y)) {
        continue;
      }
      const pulse = Math.round(note.y);
      const lane = Number.isFinite(note.x) ? Math.floor(note.x!) : 0;
      // An `x` the lane map has no lane for (x <= 0, missing, or outside the hint's table) is a BGM note: the spec makes
      // x = 0 BGM, and beatoraja plays any x outside the hint's key table in the background too.
      const playableChannel = lane > 0 ? laneMap.get(lane) : undefined;
      const isBGMNote = playableChannel === undefined;
      if (!isBGMNote) {
        playableTicks.add(pulse);
      }

      const { measure, position } = positionResolver(note.y);
      const channel = playableChannel ?? '01';
      const event: BeMusicEvent = {
        measure,
        position,
        channel,
        value: key,
      };
      const noteLength = normalizeBmsonNoteLength(note.l);
      const noteContinue = typeof note.c === 'boolean' ? note.c : undefined;
      // beatoraja bmson extension — per-note long-note type, only meaningful on actual long notes (`l > 0`).
      const noteLongNoteType =
        (note.t === 1 || note.t === 2 || note.t === 3) && noteLength !== undefined && noteLength > 0
          ? note.t
          : undefined;
      if (
        noteLength !== undefined ||
        noteContinue !== undefined ||
        noteLongNoteType !== undefined ||
        typeof note.up === 'boolean'
      ) {
        event.bmson = {};
        if (typeof note.up === 'boolean') event.bmson.up = note.up;
        if (noteLength !== undefined) {
          event.bmson.l = noteLength;
        }
        if (noteContinue !== undefined) {
          event.bmson.c = noteContinue;
        }
        if (noteLongNoteType !== undefined) {
          event.bmson.t = noteLongNoteType;
        }
      }
      if (isBGMNote) {
        bgmCandidates.push({ pulse, event });
        continue;
      }
      json.events.push(event);
    }

    for (const candidate of bgmCandidates) {
      if (playableTicks.has(candidate.pulse)) {
        continue;
      }
      json.events.push(candidate.event);
    }
  }

  // beatoraja's two lane extensions, read as jbms-parser's BMSONDecoder does: `key_channels` are hidden notes (keysounds
  // that are never judged → BMS invisible `3x` / `4x`) and `mine_channels` are mines (→ BMS landmine `Dx` / `Ex`, each
  // keeping its gauge `damage` on `event.bmson.damage`). Both read only `x`, `y` (and `damage` on mines), go through
  // the same `mode_hint`-aware lane map as the playable notes, and drop a note without a lane. Their WAVs are
  // registered after the sound channels in beatoraja's order — `key_channels`, then `mine_channels` — so the WAV ID
  // space stays contiguous.
  let nextWAVIndex = soundChannels.length + 1;
  const pushBmsonExtensionNotes = (
    channels: readonly BmsonMineChannelEntry[],
    toChannel: (playableChannel: string) => string | undefined,
    keepDamage: boolean,
  ): void => {
    for (const extensionChannel of channels) {
      const wavKey = encodeBmsonKey(nextWAVIndex, keyBase);
      nextWAVIndex += 1;
      if (wavKey === undefined) {
        return;
      }
      json.resources.wav[wavKey] = extensionChannel.name;
      for (const note of extensionChannel.notes) {
        const lane = Number.isFinite(note.x) ? Math.floor(note.x!) : 0;
        const playableChannel = lane > 0 ? laneMap.get(lane) : undefined;
        const channel = playableChannel ? toChannel(playableChannel) : undefined;
        if (!channel) {
          continue;
        }
        const { measure, position } = positionResolver(note.y);
        const event: BeMusicEvent = { measure, position, channel, value: wavKey };
        if (keepDamage && note.damage !== undefined) {
          event.bmson = { damage: note.damage };
        }
        json.events.push(event);
      }
    }
  };
  pushBmsonExtensionNotes(keyChannels, bmsPlayableChannelToInvisibleChannel, false);
  pushBmsonExtensionNotes(mineChannels, bmsPlayableChannelToLandmineChannel, true);

  json.preservation.bmson.bpmEvents = bpmEvents;
  const bpmKeys = createBmsonValueKeyTable(bpmValues, keyBase);
  Object.assign(json.resources.bpm, bpmKeys.table);
  [...bpmByPulse.keys()].forEach((y, index) => {
    const { measure, position } = positionResolver(y);
    json.events.push({ measure, position, channel: '08', value: bpmKeys.keys[index]! });
  });

  // STOPs on one pulse add up (bmson spec), so their order on the pulse does not matter.
  json.preservation.bmson.stopEvents = stopEvents;
  const stopKeys = createBmsonValueKeyTable(stopUnits, keyBase);
  Object.assign(json.resources.stop, stopKeys.table);
  stopEvents.forEach((stopEvent, index) => {
    const { measure, position } = positionResolver(stopEvent.y);
    json.events.push({ measure, position, channel: '09', value: stopKeys.keys[index]! });
  });

  if (scrollEvents.length > 0) {
    json.preservation.bmson.scrollEvents = scrollEvents;
  }
  const scrollKeys = createBmsonValueKeyTable(scrollRates, keyBase);
  Object.assign(json.bms.scroll, scrollKeys.table);
  [...scrollRateByPulse.keys()].forEach((y, index) => {
    const { measure, position } = positionResolver(y);
    json.events.push({ measure, position, channel: 'SC', value: scrollKeys.keys[index]! });
  });

  json.events = sortAndNormalizeEvents(json.events, keyBase);
  return json;
}
