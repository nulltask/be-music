import { compareEvents, sortEvents } from '@be-music/chart';
import {
  normalizeChannel,
  resolveBmsBase,
  type BmsObjectLineEntry,
  type BmsonBpmEventEntry,
  type BmsonScrollEventEntry,
  type BmsonSoundChannelEntry,
  type BmsonStopEventEntry,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';

export function areEventBmsonExtensionsEqual(left: BeMusicEvent['bmson'], right: BeMusicEvent['bmson']): boolean {
  return left?.l === right?.l && left?.c === right?.c;
}

export function areBmsChartsEquivalent(left: BeMusicJson, right: BeMusicJson): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBmsExtensionsEqual(left.bms, right.bms) &&
    areBmsPreservationEqual(left.preservation.bms, right.preservation.bms)
  );
}

export function areBmsonChartsEquivalent(left: BeMusicJson, right: BeMusicJson): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBmsonExtensionsEqual(left.bmson, right.bmson) &&
    // bmson `scroll_events` live in the BMS `#SCROLL` table, and many keys move the chart to base-62 IDs.
    resolveBmsBase(left) === resolveBmsBase(right) &&
    areNumberMapsEqual(left.bms.scroll, right.bms.scroll) &&
    areBmsonPreservationEqual(left.preservation.bmson, right.preservation.bmson)
  );
}

function areMetadataEqual(left: BeMusicJson['metadata'], right: BeMusicJson['metadata']): boolean {
  return (
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artist === right.artist &&
    left.genre === right.genre &&
    left.comment === right.comment &&
    left.stageFile === right.stageFile &&
    left.playLevel === right.playLevel &&
    left.rank === right.rank &&
    left.total === right.total &&
    left.difficulty === right.difficulty &&
    left.bpm === right.bpm &&
    areStringMapsEqual(left.extras, right.extras)
  );
}

function areResourcesEqual(left: BeMusicJson['resources'], right: BeMusicJson['resources']): boolean {
  return (
    areStringMapsEqual(left.wav, right.wav) &&
    areStringMapsEqual(left.bmp, right.bmp) &&
    areNumberMapsEqual(left.bpm, right.bpm) &&
    areNumberMapsEqual(left.stop, right.stop) &&
    areStringMapsEqual(left.text, right.text)
  );
}

function areMeasuresEqual(left: BeMusicJson['measures'], right: BeMusicJson['measures']): boolean {
  const sortedLeft = [...left].sort((a, b) => a.index - b.index);
  const sortedRight = [...right].sort((a, b) => a.index - b.index);
  if (sortedLeft.length !== sortedRight.length) {
    return false;
  }
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (
      sortedLeft[index]!.index !== sortedRight[index]!.index ||
      sortedLeft[index]!.length !== sortedRight[index]!.length
    ) {
      return false;
    }
  }
  return true;
}

function areEventsEqual(left: BeMusicEvent[], right: BeMusicEvent[]): boolean {
  const sortedLeft = sortEvents(left);
  const sortedRight = sortEvents(right);
  if (sortedLeft.length !== sortedRight.length) {
    return false;
  }
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (compareEvents(sortedLeft[index]!, sortedRight[index]!) !== 0) {
      return false;
    }
    if (!areEventBmsonExtensionsEqual(sortedLeft[index]!.bmson, sortedRight[index]!.bmson)) {
      return false;
    }
  }
  return true;
}

function areBmsExtensionsEqual(left: BeMusicJson['bms'], right: BeMusicJson['bms']): boolean {
  return (
    areControlFlowEntriesEqual(left.controlFlow, right.controlFlow) &&
    left.preview === right.preview &&
    left.lnType === right.lnType &&
    left.lnMode === right.lnMode &&
    areStringArraysEqual(left.lnObjs, right.lnObjs) &&
    left.volWav === right.volWav &&
    left.defExRank === right.defExRank &&
    areStringMapsEqual(left.exRank, right.exRank) &&
    areStringMapsEqual(left.argb, right.argb) &&
    left.player === right.player &&
    left.pathWav === right.pathWav &&
    left.baseBpm === right.baseBpm &&
    areStringArraysEqual(left.stp, right.stp) &&
    left.option === right.option &&
    areStringMapsEqual(left.changeOption, right.changeOption) &&
    left.wavCmd === right.wavCmd &&
    areStringArraysEqual(left.wavCmds, right.wavCmds) &&
    areStringMapsEqual(left.exWav, right.exWav) &&
    areStringMapsEqual(left.exBmp, right.exBmp) &&
    areStringMapsEqual(left.bga, right.bga) &&
    areNumberMapsEqual(left.scroll, right.scroll) &&
    areNumberMapsEqual(left.speed, right.speed) &&
    left.poorBga === right.poorBga &&
    areStringMapsEqual(left.swBga, right.swBga) &&
    left.videoFile === right.videoFile &&
    left.midiFile === right.midiFile &&
    left.materials === right.materials &&
    left.divideProp === right.divideProp &&
    left.charset === right.charset
  );
}

function areBmsonExtensionsEqual(left: BeMusicJson['bmson'], right: BeMusicJson['bmson']): boolean {
  return (
    left.version === right.version && areBmsonInfoEqual(left.info, right.info) && areBmsonBgaEqual(left.bga, right.bga)
  );
}

function areBmsPreservationEqual(
  left: BeMusicJson['preservation']['bms'],
  right: BeMusicJson['preservation']['bms'],
): boolean {
  return (
    areControlFlowEntriesEqual(left.sourceLines, right.sourceLines) &&
    areBmsObjectLinesEqual(left.objectLines, right.objectLines)
  );
}

function areBmsonPreservationEqual(
  left: BeMusicJson['preservation']['bmson'],
  right: BeMusicJson['preservation']['bmson'],
): boolean {
  return (
    areNumberArraysEqual(left.lines, right.lines) &&
    areBmsonBpmEventsEqual(left.bpmEvents, right.bpmEvents) &&
    areBmsonStopEventsEqual(left.stopEvents, right.stopEvents) &&
    areBmsonScrollEventsEqual(left.scrollEvents ?? [], right.scrollEvents ?? []) &&
    areBmsonSoundChannelsEqual(left.soundChannels, right.soundChannels)
  );
}

function areControlFlowEntriesEqual(
  left: BeMusicJson['bms']['controlFlow'],
  right: BeMusicJson['bms']['controlFlow'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index]!;
    const rightEntry = right[index]!;
    if (leftEntry.kind !== rightEntry.kind) {
      return false;
    }
    if (leftEntry.kind === 'directive' && rightEntry.kind === 'directive') {
      if (leftEntry.command !== rightEntry.command || leftEntry.value !== rightEntry.value) {
        return false;
      }
      continue;
    }
    if (leftEntry.kind === 'header' && rightEntry.kind === 'header') {
      if (
        leftEntry.command !== rightEntry.command ||
        leftEntry.value !== rightEntry.value ||
        (leftEntry.overriddenByLaterHeader === true) !== (rightEntry.overriddenByLaterHeader === true)
      ) {
        return false;
      }
      continue;
    }
    if (leftEntry.kind !== 'object' || rightEntry.kind !== 'object') {
      return false;
    }
    if (!areBmsObjectLineEqual(leftEntry, rightEntry)) {
      return false;
    }
  }
  return true;
}

function areBmsObjectLinesEqual(left: BmsObjectLineEntry[], right: BmsObjectLineEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areBmsObjectLineEqual(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

function areBmsObjectLineEqual(left: BmsObjectLineEntry, right: BmsObjectLineEntry): boolean {
  return (
    left.measure === right.measure &&
    normalizeChannel(left.channel) === normalizeChannel(right.channel) &&
    left.measureLength === right.measureLength &&
    areEventsEqual(left.events, right.events)
  );
}

function areBmsonInfoEqual(left: BeMusicJson['bmson']['info'], right: BeMusicJson['bmson']['info']): boolean {
  return (
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artist === right.artist &&
    left.genre === right.genre &&
    areStringArraysEqual(left.subartists, right.subartists) &&
    left.chartName === right.chartName &&
    left.level === right.level &&
    left.initBpm === right.initBpm &&
    left.resolution === right.resolution &&
    left.modeHint === right.modeHint &&
    left.judgeRank === right.judgeRank &&
    left.total === right.total &&
    left.backImage === right.backImage &&
    left.eyecatchImage === right.eyecatchImage &&
    left.bannerImage === right.bannerImage &&
    left.previewMusic === right.previewMusic
  );
}

function areBmsonBgaEqual(left: BeMusicJson['bmson']['bga'], right: BeMusicJson['bmson']['bga']): boolean {
  return (
    areBmsonBgaHeadersEqual(left.header, right.header) &&
    areBmsonBgaEventsEqual(left.events, right.events) &&
    areBmsonBgaEventsEqual(left.layerEvents, right.layerEvents) &&
    areBmsonBgaEventsEqual(left.poorEvents, right.poorEvents)
  );
}

function areBmsonBgaHeadersEqual(
  left: BeMusicJson['bmson']['bga']['header'],
  right: BeMusicJson['bmson']['bga']['header'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.id !== right[index]!.id || left[index]!.name !== right[index]!.name) {
      return false;
    }
  }
  return true;
}

function areBmsonBgaEventsEqual(
  left: BeMusicJson['bmson']['bga']['events'],
  right: BeMusicJson['bmson']['bga']['events'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.id !== right[index]!.id) {
      return false;
    }
  }
  return true;
}

function areBmsonBpmEventsEqual(left: BmsonBpmEventEntry[], right: BmsonBpmEventEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.bpm !== right[index]!.bpm) {
      return false;
    }
  }
  return true;
}

function areBmsonStopEventsEqual(left: BmsonStopEventEntry[], right: BmsonStopEventEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.duration !== right[index]!.duration) {
      return false;
    }
  }
  return true;
}

function areBmsonScrollEventsEqual(left: BmsonScrollEventEntry[], right: BmsonScrollEventEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.rate !== right[index]!.rate) {
      return false;
    }
  }
  return true;
}

function areBmsonSoundChannelsEqual(left: BmsonSoundChannelEntry[], right: BmsonSoundChannelEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.name !== right[index]!.name || !areBmsonSoundNotesEqual(left[index]!.notes, right[index]!.notes)) {
      return false;
    }
  }
  return true;
}

function areBmsonSoundNotesEqual(
  left: BmsonSoundChannelEntry['notes'],
  right: BmsonSoundChannelEntry['notes'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]!.x !== right[index]!.x ||
      left[index]!.y !== right[index]!.y ||
      left[index]!.l !== right[index]!.l ||
      left[index]!.c !== right[index]!.c
    ) {
      return false;
    }
  }
  return true;
}

function areStringMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let index = 0; index < leftEntries.length; index += 1) {
    if (leftEntries[index]![0] !== rightEntries[index]![0] || leftEntries[index]![1] !== rightEntries[index]![1]) {
      return false;
    }
  }
  return true;
}

function areNumberMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let index = 0; index < leftEntries.length; index += 1) {
    if (leftEntries[index]![0] !== rightEntries[index]![0] || leftEntries[index]![1] !== rightEntries[index]![1]) {
      return false;
    }
  }
  return true;
}

function areStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false;
    }
  }
  return true;
}

function areNumberArraysEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
