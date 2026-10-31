import { compareEvents, sortEvents } from '@be-music/chart-model';
import {
  normalizeChannel,
  resolveBMSBase,
  type BMSObjectLineEntry,
  type BmsonBPMEventEntry,
  type BmsonScrollEventEntry,
  type BmsonSoundChannelEntry,
  type BmsonStopEventEntry,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';

export function areEventBmsonExtensionsEqual(left: BeMusicEvent['bmson'], right: BeMusicEvent['bmson']): boolean {
  return (
    left?.l === right?.l &&
    left?.c === right?.c &&
    left?.up === right?.up &&
    left?.t === right?.t &&
    areJSONValuesEqual(left?.extraFields, right?.extraFields)
  );
}

export function areBMSChartsEquivalent(left: BeMusicJSON, right: BeMusicJSON): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBMSExtensionsEqual(left.bms, right.bms) &&
    areBMSPreservationEqual(left.preservation.bms, right.preservation.bms)
  );
}

export function areBmsonChartsEquivalent(left: BeMusicJSON, right: BeMusicJSON): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBmsonExtensionsEqual(left.bmson, right.bmson) &&
    // bmson `scroll_events` live in the BMS `#SCROLL` table, and many keys move the chart to base-62 IDs.
    resolveBMSBase(left) === resolveBMSBase(right) &&
    areNumberMapsEqual(left.bms.scroll, right.bms.scroll) &&
    areBmsonPreservationEqual(left.preservation.bmson, right.preservation.bmson)
  );
}

function areMetadataEqual(left: BeMusicJSON['metadata'], right: BeMusicJSON['metadata']): boolean {
  return (
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artist === right.artist &&
    left.genre === right.genre &&
    left.comment === right.comment &&
    left.stageFile === right.stageFile &&
    left.titleImage === right.titleImage &&
    left.playLevel === right.playLevel &&
    left.rank === right.rank &&
    left.total === right.total &&
    left.difficulty === right.difficulty &&
    left.bpm === right.bpm &&
    areStringMapsEqual(left.extras, right.extras)
  );
}

function areResourcesEqual(left: BeMusicJSON['resources'], right: BeMusicJSON['resources']): boolean {
  return (
    areStringMapsEqual(left.wav, right.wav) &&
    areStringMapsEqual(left.bmp, right.bmp) &&
    areNumberMapsEqual(left.bpm, right.bpm) &&
    areNumberMapsEqual(left.stop, right.stop) &&
    areStringMapsEqual(left.text, right.text)
  );
}

function areMeasuresEqual(left: BeMusicJSON['measures'], right: BeMusicJSON['measures']): boolean {
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

function areBMSExtensionsEqual(left: BeMusicJSON['bms'], right: BeMusicJSON['bms']): boolean {
  return (
    areControlFlowEntriesEqual(left.controlFlow, right.controlFlow) &&
    left.preview === right.preview &&
    left.lnType === right.lnType &&
    left.lnMode === right.lnMode &&
    areStringArraysEqual(left.lnObjs, right.lnObjs) &&
    left.volWAV === right.volWAV &&
    left.defExRank === right.defExRank &&
    areStringMapsEqual(left.exRank, right.exRank) &&
    areStringMapsEqual(left.argb, right.argb) &&
    left.player === right.player &&
    left.pathWAV === right.pathWAV &&
    left.baseBPM === right.baseBPM &&
    areStringArraysEqual(left.stp, right.stp) &&
    areStringArraysEqual(
      left.options ?? (left.option ? [left.option] : []),
      right.options ?? (right.option ? [right.option] : []),
    ) &&
    left.optionHeadersInControlFlow === right.optionHeadersInControlFlow &&
    areStringMapsEqual(left.changeOption, right.changeOption) &&
    left.wavCmd === right.wavCmd &&
    areStringArraysEqual(left.wavCmds, right.wavCmds) &&
    areStringMapsEqual(left.exWAV, right.exWAV) &&
    areStringMapsEqual(left.exBMP, right.exBMP) &&
    areStringMapsEqual(left.bga, right.bga) &&
    areNumberMapsEqual(left.scroll, right.scroll) &&
    areNumberMapsEqual(left.speed, right.speed) &&
    left.poorBGA === right.poorBGA &&
    areStringMapsEqual(left.swBGA, right.swBGA) &&
    left.videoFile === right.videoFile &&
    left.midiFile === right.midiFile &&
    left.materials === right.materials &&
    left.divideProp === right.divideProp &&
    left.charset === right.charset
  );
}

function areBmsonExtensionsEqual(left: BeMusicJSON['bmson'], right: BeMusicJSON['bmson']): boolean {
  return (
    left.version === right.version &&
    areJSONValuesEqual(left.extraFields, right.extraFields) &&
    areJSONValuesEqual(left.channelExtraFields, right.channelExtraFields) &&
    areJSONValuesEqual(left.channelKinds, right.channelKinds) &&
    areJSONValuesEqual(left.lineExtraFields, right.lineExtraFields) &&
    areBmsonInfoEqual(left.info, right.info) &&
    areBmsonBGAEqual(left.bga, right.bga)
  );
}

function areBMSPreservationEqual(
  left: BeMusicJSON['preservation']['bms'],
  right: BeMusicJSON['preservation']['bms'],
): boolean {
  return (
    areControlFlowEntriesEqual(left.sourceLines, right.sourceLines) &&
    areBMSObjectLinesEqual(left.objectLines, right.objectLines)
  );
}

function areBmsonPreservationEqual(
  left: BeMusicJSON['preservation']['bmson'],
  right: BeMusicJSON['preservation']['bmson'],
): boolean {
  return (
    areNumberArraysEqual(left.lines, right.lines) &&
    areBmsonBPMEventsEqual(left.bpmEvents, right.bpmEvents) &&
    areBmsonStopEventsEqual(left.stopEvents, right.stopEvents) &&
    areBmsonScrollEventsEqual(left.scrollEvents ?? [], right.scrollEvents ?? []) &&
    areBmsonSoundChannelsEqual(left.soundChannels, right.soundChannels)
  );
}

function areControlFlowEntriesEqual(
  left: BeMusicJSON['bms']['controlFlow'],
  right: BeMusicJSON['bms']['controlFlow'],
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
    if (!areBMSObjectLineEqual(leftEntry, rightEntry)) {
      return false;
    }
  }
  return true;
}

function areBMSObjectLinesEqual(left: BMSObjectLineEntry[], right: BMSObjectLineEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areBMSObjectLineEqual(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

function areBMSObjectLineEqual(left: BMSObjectLineEntry, right: BMSObjectLineEntry): boolean {
  return (
    left.measure === right.measure &&
    normalizeChannel(left.channel) === normalizeChannel(right.channel) &&
    left.measureLength === right.measureLength &&
    areEventsEqual(left.events, right.events)
  );
}

function areBmsonInfoEqual(left: BeMusicJSON['bmson']['info'], right: BeMusicJSON['bmson']['info']): boolean {
  return (
    areJSONValuesEqual(left.extraFields, right.extraFields) &&
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artist === right.artist &&
    left.genre === right.genre &&
    areStringArraysEqual(left.subartists, right.subartists) &&
    left.chartName === right.chartName &&
    left.level === right.level &&
    left.initBPM === right.initBPM &&
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

function areBmsonBGAEqual(left: BeMusicJSON['bmson']['bga'], right: BeMusicJSON['bmson']['bga']): boolean {
  return (
    areJSONValuesEqual(left.extraFields, right.extraFields) &&
    areJSONValuesEqual(left.sequences ?? [], right.sequences ?? []) &&
    areBmsonBGAHeadersEqual(left.header, right.header) &&
    areBmsonBGAEventsEqual(left.events, right.events) &&
    areBmsonBGAEventsEqual(left.layerEvents, right.layerEvents) &&
    areBmsonBGAEventsEqual(left.poorEvents, right.poorEvents)
  );
}

function areBmsonBGAHeadersEqual(
  left: BeMusicJSON['bmson']['bga']['header'],
  right: BeMusicJSON['bmson']['bga']['header'],
): boolean {
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
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

function areBmsonBGAEventsEqual(
  left: BeMusicJSON['bmson']['bga']['events'],
  right: BeMusicJSON['bmson']['bga']['events'],
): boolean {
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]!.y !== right[index]!.y ||
      left[index]!.id !== right[index]!.id ||
      left[index]!.condition !== right[index]!.condition ||
      left[index]!.interval !== right[index]!.interval ||
      JSON.stringify(left[index]!.idSet) !== JSON.stringify(right[index]!.idSet)
    ) {
      return false;
    }
  }
  return true;
}

function areBmsonBPMEventsEqual(left: BmsonBPMEventEntry[], right: BmsonBPMEventEntry[]): boolean {
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
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
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
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
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
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
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
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
  if (
    !areJSONValuesEqual(
      left.map((item) => item.extraFields),
      right.map((item) => item.extraFields),
    )
  )
    return false;
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]!.x !== right[index]!.x ||
      left[index]!.y !== right[index]!.y ||
      left[index]!.l !== right[index]!.l ||
      left[index]!.c !== right[index]!.c ||
      left[index]!.up !== right[index]!.up ||
      left[index]!.t !== right[index]!.t
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

/** Object order is immaterial; array order and all opaque values remain significant. */
function areJSONValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areJSONValuesEqual(value, right[index]))
    );
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && areJSONValuesEqual(a[key], b[key]))
  );
}
