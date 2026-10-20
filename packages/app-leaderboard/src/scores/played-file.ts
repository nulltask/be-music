import type { BeMusicReplay } from '@be-music/player-engine/replay';

/**
 * What a replay says about the play beyond its judgments: which chart file it came from, how long it ran, and the
 * lane arrangement it used.
 */
export interface PlayedFile {
  fileSha256: string | null;
  fileMd5: string | null;
  durationMs: number;
  laneOption: string;
}

/**
 * The chart file of a play (its well-formed `chart.sha256` / `chart.md5`, lowercased) and its length: from the chart's
 * zero to the end of the last note (a long note's tail) or the last input, whichever is later, in milliseconds.
 */
export function playedFileOf(replay: Pick<BeMusicReplay, 'chart' | 'inputs' | 'play'>): PlayedFile {
  const hashes = new Map(fileHashAliases(replay.chart).map((alias) => [alias.kind, alias.hash]));
  let endUs = 0;
  for (const note of replay.chart.notes) endUs = Math.max(endUs, note.endTimeUs ?? note.timeUs);
  for (const input of replay.inputs) endUs = Math.max(endUs, input.timeUs);
  return {
    fileSha256: hashes.get('sha256') ?? null,
    fileMd5: hashes.get('md5') ?? null,
    durationMs: Math.round(endUs / 1000),
    laneOption: laneOptionOf(replay.play),
  };
}

/**
 * The lane arrangement of a play as players name it: `OFF`, `RANDOM`, `MIRROR / RANDOM` for the two sides of a double
 * play when they differ, with ` FLIP` appended when the sides were swapped.
 */
export function laneOptionOf(play: Pick<BeMusicReplay['play'], 'randomLane' | 'dpFlip'>): string {
  const p1 = (play.randomLane?.p1 ?? 'OFF').toUpperCase();
  const p2 = play.randomLane?.p2?.toUpperCase();
  const sides = p2 === undefined || p2 === p1 ? p1 : `${p1} / ${p2}`;
  return play.dpFlip === true ? `${sides} FLIP` : sides;
}

const FILE_HASH_PATTERNS = { sha256: /^[0-9a-f]{64}$/, md5: /^[0-9a-f]{32}$/ } as const;

/** The well-formed file hashes of a replay's chart, lowercased, as chart aliases. */
export function fileHashAliases(chart: {
  sha256?: string;
  md5?: string;
}): Array<{ kind: 'sha256' | 'md5'; hash: string }> {
  const aliases: Array<{ kind: 'sha256' | 'md5'; hash: string }> = [];
  for (const kind of ['sha256', 'md5'] as const) {
    const hash = chart[kind]?.toLowerCase();
    if (hash !== undefined && FILE_HASH_PATTERNS[kind].test(hash)) aliases.push({ kind, hash });
  }
  return aliases;
}
