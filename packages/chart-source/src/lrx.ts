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
   * The lane (BMS channel) of a lane note that plays in the background: a chain note, which chart-model ties to the
   * lane's preceding judged note (without one it plays at its own time), or a hidden (`dmg="0"`) note, which also
   * becomes the lane's keysound once it plays, as an invisible note does.
   */
  lane?: string;
  /**
   * A background sound plugout plays at the keysound volume: its mixer puts every note in the key group but those on
   * the BGM columns (`c` 100–199) that keep a non-zero `dmg` (`plugout4.exe` 0x43b455, 0x43b640). Set on the events of
   * channel `01` that it covers: chain notes, hidden lane notes and the other background columns.
   */
  keyVolume?: boolean;
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
  /**
   * `rev="1"`, the editor's "Reverse". plugout plays nothing reversed: a chain note's queued playback keeps the flag
   * (`plugout4.exe` 0x4dc7f0), but the queue never passes it on (0x4dd5b6). Kept as written; no player reads it.
   */
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
  /**
   * Every BGA note of the chart (`c` 200–204 and 299) with its transform, kept when one of them uses what the BMS BGA
   * channels cannot carry: a source or destination rectangle, a keyframe chain, or layer 203 / 204. Absent otherwise:
   * the BGA plays from its BMS channels alone.
   */
  bga?: LRXBGACue[];
}

/**
 * One LRX BGA note (`plugout4.exe` reads them at 0x4656c2 and draws them at 0x4442c0). Rectangles are in plugout's
 * 1280×720 screen and the image's pixels; each field is absent where the note leaves it out.
 */
export interface LRXBGACue {
  /** 0 the base (`c="200"`), 1–4 the layers (`c` 201–204), 5 the POOR image (`c="299"`). */
  slot: number;
  /** `s`, in LRX ticks. */
  tick: number;
  /** `e` when later than `s`: where a keyframe chain's motion ends. */
  endTick?: number;
  /** `p`, the image id. */
  image: number;
  /** The image's BMP key, as the BGA channels name it. */
  key: string;
  /** `cn="1"`: a keyframe that continues the slot's previous note. */
  chain?: true;
  /** `sx` `sy` `sw` `sh`: the part of the image drawn (present when `sx` is). */
  src?: [number, number, number, number];
  /** `dx` `dy` `dw` `dh`: where it is drawn (present when `dx` is). */
  dst?: [number, number, number, number];
  /** `a` `r` `g` `b`, 0–255, read only with `dx` (255 each when left out). */
  color?: [number, number, number, number];
  /** `bld`: 0 alpha, 1 add, 2 subtract, 3 multiply. Read only with `dx`. */
  blend?: number;
  /** `rot`, in degrees. Read only with `dx`. */
  rotation?: number;
  /** `ctr`: the rotation centre, 0 the middle, else the numeric keypad's layout (7 top left … 3 bottom right). */
  center?: number;
  /** `acc`: how a keyframe chain eases from this note, 0 linear, 1 accelerating, 2 decelerating. */
  accel?: number;
}

export function cloneLRXExtensions(lrx: LRXExtensions): LRXExtensions {
  return {
    ...lrx,
    ...(lrx.barTicks !== undefined ? { barTicks: [...lrx.barTicks] } : {}),
    ...(lrx.bga !== undefined ? { bga: lrx.bga.map(cloneLRXBGACue) } : {}),
  };
}

function cloneLRXBGACue(cue: LRXBGACue): LRXBGACue {
  return {
    ...cue,
    ...(cue.src !== undefined ? { src: [...cue.src] } : {}),
    ...(cue.dst !== undefined ? { dst: [...cue.dst] } : {}),
    ...(cue.color !== undefined ? { color: [...cue.color] } : {}),
  };
}
