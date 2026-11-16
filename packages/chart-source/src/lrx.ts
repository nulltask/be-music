/**
 * The parts of an LRX chart (plugout4 -ARCADE EDITION-, `.lrs` + `.lrh` + `.lrm`) that the BMS-shaped event list
 * cannot carry. See docs/format-compat.md, "LRX".
 */

/** LRX ticks per beat: an LRX `s` / `e` of 1,920 is one 4/4 measure. */
export const LRX_TICKS_PER_BEAT = 480;

/**
 * Per-note values of an LRX `<n>` element. Each field is omitted when the note leaves it at the format's default
 * (`vol` 127, `pan` 64, `frq` 44100, `atk` / `rls` / `ost` 0, `len` −1, `dmg` / `rcv` 100, `rev` / `cn` off).
 */
export interface LRXEventExtensions {
  /** Long-note length in LRX ticks (`e − s` of a lane note); absent for a normal note. */
  length?: number;
  /**
   * `cn="1"`, a chain note: never judged or counted. When a press sounds the lane's preceding note, plugout plays the
   * chain note after it, as far after the press as it is after that note in the chart. The event itself sits on the
   * background channel `01`.
   */
  chain?: boolean;
  /**
   * The lane (BMS channel) a chain note sits on. chart-model links it to the lane's preceding judged note; without
   * one it plays in the background at its own time.
   */
  chainLane?: string;
  /** `vol`, 0..127: the note plays at `volume / 127` of full gain. */
  volume?: number;
  /** `pan`, 0..127: 64 is centre, the position is `(pan − 64) / 64`. */
  pan?: number;
  /** `frq` in Hz: the sample plays at `frequency / 44100` of its rate. */
  frequency?: number;
  /** `atk`: fade-in length in milliseconds. */
  attackMs?: number;
  /** `rls`: fade-out length in milliseconds after `lengthMs`. */
  releaseMs?: number;
  /** `ost`: where in the sample playback starts, in milliseconds. */
  offsetMs?: number;
  /** `len`: how long the sample plays, in milliseconds (absent = to its end). */
  lengthMs?: number;
  /** `rev="1"`: the sample plays reversed. */
  reverse?: boolean;
  /** `dmg` as written (a lane note with `dmg="0"` is an autoplayed background note). */
  damage?: number;
  /** `rcv` as written. plugout reads it but nothing uses it. */
  recover?: number;
}

/** The `.lrh` header fields and LRS values with no BMS counterpart, kept as written. */
export interface LRXExtensions {
  /** `.lrh` `lanetype`: 0 = 7 keys, 1 = 5 keys, 2 = 14 keys, 3 = 10 keys, 4 = 9 keys, 5 / 6 = 5 / 7 keys + both scratches. */
  laneType?: number;
  /** `.lrh` `category`: 0..4 official easy / normal / hard / lunatic / extra, 5 / 6 edit (extra), 7 / 8 remix (extra). */
  category?: number;
  /** `.lrh` `lrslevel`, the native level (also `metadata.playLevel`). */
  level?: number;
  /** `.lrh` `bmslevel`, the level on the BMS scale. */
  bmsLevel?: number;
  /** `.lrh` `sequencetitle`: the chart's own name. */
  sequenceTitle?: string;
  /** `.lrh` `artist_sequence`: who wrote the chart. */
  sequenceArtist?: string;
  /** `.lrm` `artist_movie`. */
  movieArtist?: string;
  /** `.lrh` `minbpm` / `maxbpm` / `basebpm` / `startbpm`: the display BPMs (timing uses the BPM notes). */
  minBPM?: number;
  maxBPM?: number;
  baseBPM?: number;
  startBPM?: number;
  /** `.lrh` `labelimage`. */
  labelImage?: string;
  /** `.lrh` `phase`, `unlock` and `songid`, as plugout stores them for its own song list. */
  phase?: number;
  unlock?: number;
  songId?: number;
  /** The BGA file read (`.lrh` `moviepath`, else the `.lrs` one, else `_movie.lrm`). */
  moviePath?: string;
  /** The tick of the end-of-song note (`c="309"`), which sets the play length in plugout. */
  endTick?: number;
  /** The ticks the measures start at: the bar lines (`c="300"`) in order, after a 0 when the first is later. */
  barTicks?: number[];
}

export function cloneLRXExtensions(lrx: LRXExtensions): LRXExtensions {
  return { ...lrx, ...(lrx.barTicks !== undefined ? { barTicks: [...lrx.barTicks] } : {}) };
}
