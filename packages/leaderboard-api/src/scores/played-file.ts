import type { BeMusicPlaylog } from '@be-music/player/playlog';

/** What a play log says about the play beyond its judgments: which chart file it came from and how long it ran. */
export interface PlayedFile {
  fileSha256: string | null;
  fileMd5: string | null;
  durationMs: number;
}

/**
 * The chart file of a play (its well-formed `chart.sha256` / `chart.md5`, lowercased) and its length: from the chart's
 * zero to the end of the last note (a long note's tail) or the last input, whichever is later, in milliseconds.
 */
export function playedFileOf(playlog: Pick<BeMusicPlaylog, 'chart' | 'inputs'>): PlayedFile {
  const hashes = new Map(fileHashAliases(playlog.chart).map((alias) => [alias.kind, alias.hash]));
  let endUs = 0;
  for (const note of playlog.chart.notes) endUs = Math.max(endUs, note.endTimeUs ?? note.timeUs);
  for (const input of playlog.inputs) endUs = Math.max(endUs, input.timeUs);
  return {
    fileSha256: hashes.get('sha256') ?? null,
    fileMd5: hashes.get('md5') ?? null,
    durationMs: Math.round(endUs / 1000),
  };
}

const FILE_HASH_PATTERNS = { sha256: /^[0-9a-f]{64}$/, md5: /^[0-9a-f]{32}$/ } as const;

/** The well-formed file hashes of a play log's chart, lowercased, as chart aliases. */
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
