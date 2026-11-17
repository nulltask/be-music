// What a Bemuse music server says about a song beyond its chart files — its preview audio, its background video, its
// loading and back images and its ReplayGain — laid onto the song's parsed charts, the way Bemuse's own player uses them.
// None of it reaches the chart fingerprint (docs/fingerprint-spec.md: BGA, video, preview and volume are excluded), and
// the chart files stay as served, so file hashes and records are those of the same chart read from disk.
import { createTimingResolver, volWAVToLinearGain } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';

/** Where the files Be-Music adds for a song live, inside its folder. */
export const BEMUSE_EXTRAS_FOLDER = '__bemuse__';

/** A song's extras. Paths are relative to the song folder. */
export interface BemuseSongExtras {
  /** Bemuse's preview audio: the select screen plays it for a chart that names no preview of its own. */
  previewPath?: string;
  /** Bemuse's background video and the chart second it starts at (`video_offset`). */
  video?: { path: string; offsetSeconds: number };
  /** `eyecatch_image_url`, shown while the song loads: the chart's `#STAGEFILE` when it has none. */
  stageFilePath?: string;
  /** `back_image_url`, shown behind the play: the chart's `#BACKBMP` when it has none. */
  backImagePath?: string;
  /** The linear gain of the song's ReplayGain (`bemuseReplayGainLinear`). */
  gain: number;
}

const IMAGE_OR_VIDEO_EXTENSIONS = [
  'bmp',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'tga',
  'mp4',
  'webm',
  'm4v',
  'mpg',
  'avi',
];

function stem(path: string): string {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const name = normalized.split('/').at(-1) ?? normalized;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Whether a BGA file the chart names is among `songFiles` (lower-cased, relative to the song folder) as named or under
 * another image or video extension, as the library resolves images.
 */
function bgaFileServed(path: string, songFiles: ReadonlySet<string>): boolean {
  const name = path.replaceAll('\\', '/').toLowerCase().split('/').at(-1) ?? '';
  const base = stem(path);
  for (const file of songFiles) {
    const fileName = file.split('/').at(-1) ?? file;
    if (fileName === name) return true;
    const extension = fileName.slice(fileName.lastIndexOf('.') + 1);
    if (stem(fileName) === base && IMAGE_OR_VIDEO_EXTENSIONS.includes(extension)) return true;
  }
  return false;
}

/** Whether the chart has a BGA of its own that the song serves: Be-Music then shows it instead of Bemuse's video. */
export function chartHasServedBGA(chart: BeMusicJSON, songFiles: ReadonlySet<string>): boolean {
  const named = [...Object.values(chart.resources.bmp), ...chart.bmson.bga.header.map((entry) => entry.name)].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
  return named.some((path) => bgaFileServed(path, songFiles));
}

/**
 * The beat `seconds` into the chart falls on: the first beat whose time reaches it, found by bisection over the chart's
 * timing (BPM changes and STOPs). A chart that never reaches it returns the beat its timing ends on.
 */
export function beatAtSeconds(chart: BeMusicJSON, seconds: number): number {
  if (!(seconds > 0)) return 0;
  const resolver = createTimingResolver(chart);
  let high = 4;
  for (let step = 0; step < 40 && resolver.beatToSeconds(high) < seconds; step++) high *= 2;
  let low = 0;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (resolver.beatToSeconds(middle) < seconds) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * Lays a song's extras onto one of its parsed charts, filling only what the chart leaves out:
 *
 * - the preview audio, when the chart names no `#PREVIEW` / `preview_music`;
 * - the loading and back images, when the chart names no `#STAGEFILE` / `#BACKBMP`;
 * - the background video, as a BGA cue at `video_offset`, when the chart has no BGA the song serves (Bemuse itself
 *   shows only the video, never a chart's BGA images);
 * - the ReplayGain, multiplied into the chart's `#VOLWAV` gain (kept inside the `0 < n < 200` range it is read in).
 *
 * `songFiles` are the song's file paths, lower-cased and relative to the song folder.
 */
export function applyBemuseSongExtras(
  chart: BeMusicJSON,
  extras: BemuseSongExtras,
  songFiles: ReadonlySet<string>,
): void {
  if (extras.previewPath !== undefined && !chart.bms.preview && !chart.bmson.info?.previewMusic) {
    chart.bms.preview = extras.previewPath;
  }
  if (extras.stageFilePath !== undefined && !chart.metadata.stageFile) chart.metadata.stageFile = extras.stageFilePath;
  if (extras.backImagePath !== undefined && !chart.metadata.backBMP) chart.metadata.backBMP = extras.backImagePath;
  if (extras.video !== undefined && !chartHasServedBGA(chart, songFiles)) {
    const bga = chart.bmson.bga;
    const id = bga.header.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    const resolution =
      chart.bmson.info?.resolution && chart.bmson.info.resolution > 0 ? chart.bmson.info.resolution : 240;
    bga.header.push({ id, name: extras.video.path });
    bga.events.push({ y: Math.round(beatAtSeconds(chart, extras.video.offsetSeconds) * resolution), id });
    bga.events.sort((left, right) => left.y - right.y);
  }
  if (Number.isFinite(extras.gain) && extras.gain > 0 && extras.gain !== 1) {
    const percent = volWAVToLinearGain(chart.bms.volWAV) * extras.gain * 100;
    chart.bms.volWAV = Math.min(199.99, Math.max(0.01, percent));
  }
}

/** A song of a Bemuse server: its folder in the library, its files (lower-cased, relative to it) and its extras. */
export interface BemuseSongEntry {
  folder: string;
  files: ReadonlySet<string>;
  extras: BemuseSongExtras;
}

/**
 * The Bemuse songs loaded into the library, by folder, laying each song's extras onto its charts once. A chart is
 * matched by the song folder its path starts with (`<server folder>/<song folder>/…`); a chart object already given
 * its extras is left alone, so laying them again after another load does not apply a gain twice.
 */
export class BemuseSongExtrasRegistry {
  private readonly songs = new Map<string, BemuseSongEntry>();
  private readonly applied = new WeakSet<BeMusicJSON>();

  remember(songs: readonly BemuseSongEntry[]): void {
    for (const song of songs) this.songs.set(song.folder, song);
  }

  apply(charts: ReadonlyArray<{ chartPath: string; chart: BeMusicJSON }>): void {
    if (this.songs.size === 0) return;
    for (const { chartPath, chart } of charts) {
      if (this.applied.has(chart)) continue;
      const song = this.songs.get(chartPath.split('/').slice(0, 2).join('/'));
      if (song === undefined) continue;
      applyBemuseSongExtras(chart, song.extras, song.files);
      this.applied.add(chart);
    }
  }
}
