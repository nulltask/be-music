/**
 * The `#DIFFICULTY` (1 BEGINNER … 5 INSANE) of a chart that names none, read from its names. LR2 shows such a chart
 * without a difficulty; beatoraja fills one in from `#SUBTITLE` and `#TITLE` when it builds its song database
 * (`SQLiteSongDatabaseAccessor`), and Be-Music follows it as LR2 has no rule of its own. The rules here go further than
 * beatoraja's keyword match: they read the file name too, and were tuned against charts that do name their difficulty.
 * A difficulty read this way is an estimate, and a host marks it as one.
 */

/** The names a chart's difficulty is read from. */
export interface DifficultyNames {
  readonly title?: string;
  readonly subtitle?: string;
  /** bmson `info.chart_name`, read like the subtitle. */
  readonly chartName?: string;
  /** The chart's file name; an extension is dropped. */
  readonly fileName?: string;
}

/** Whole words, strongest first: a specific name wins over a generic one in the same text. */
const WORD_LEVELS: ReadonlyArray<readonly [level: number, words: readonly string[]]> = [
  [5, ['LEGGENDARIA', 'INSANE', 'BLACK', 'LUNATIC', 'MASTER', 'DARKANOTHER', 'BLACKANOTHER']],
  [1, ['BEGINNER', 'BEGINER']],
  [2, ['NORMAL', 'STANDARD']],
  [3, ['HYPER']],
  [4, ['ANOTHER']],
  [5, ['EXTRA']],
  [4, ['EX']],
  [1, ['EASY', 'BASIC']],
  [3, ['HARD']],
  [2, ['LIGHT']],
];
const WORDS = new Map<string, { level: number; rank: number }>(
  WORD_LEVELS.flatMap(([level, words], rank) => words.map((word) => [word, { level, rank }] as const)),
);

/** Words also read when glued to the end of a file name token (`silenteasy`, `boymganother2`). */
const GLUED_WORDS = ['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'INSANE', 'EASY', 'HARD', 'LIGHT'] as const;

/** Abbreviations, read in a token of `[key count | SP | DP]` + abbreviation (+ digits): `7A`, `SPH`, `14N`. */
const ABBREVIATIONS: Readonly<Record<string, number>> = {
  B: 1,
  BG: 1,
  BEG: 1,
  EZ: 1,
  N: 2,
  NM: 2,
  NOR: 2,
  H: 3,
  HD: 3,
  HY: 3,
  A: 4,
  AN: 4,
  ANO: 4,
  X: 5,
  I: 5,
  INS: 5,
};
/** `L` is LIGHT in some packs and LEGGENDARIA in others: read only after SP / DP (`SPL`). */
const SP_DP_ONLY_ABBREVIATIONS: Readonly<Record<string, number>> = { L: 5 };
/** A lone `E` names anything; after a key count or SP / DP (`5E`, `SPE`) it is EASY. */
const PREFIXED_ONLY_ABBREVIATIONS: Readonly<Record<string, number>> = { E: 1 };

const TOKEN_SEPARATOR = /[^A-Z0-9+]+/u;
const WORD_TOKEN = /^(?:\d{1,2}K?(?:EYS?)?|[SD]P)?([A-Z]+)\+?\d*$/u;
const ABBREVIATION_TOKEN = /^(\d{1,2}|[SD]P)?([A-Z]{1,3})\d*$/u;
const STEM_SUFFIX = /(?:\d{1,2}|[SD]P)([A-Z]{1,3})$/u;
const NUMBERED_EX = /(?:^|[^A-Z])(?:[SD]P)?EX\d(?:$|[^0-9])/u;
const BRACKETED = /[[(<【〔「（]([^\])>】〕」）]*)/gu;
const TRAILING_DASHED = /[-~]\s*([^-~]+?)\s*[-~]\s*$/u;

function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .split(TOKEN_SEPARATOR)
    .filter((token) => token.length > 0);
}

/** The subtitle (and bmson chart name) and the bracketed or trailing `-dashed-` parts of the title, not its bare words. */
function tagText(names: DifficultyNames): string {
  const title = names.title ?? '';
  const parts = [names.subtitle ?? '', names.chartName ?? ''];
  for (const match of title.matchAll(BRACKETED)) parts.push(match[1] ?? '');
  const dashed = TRAILING_DASHED.exec(title);
  if (dashed !== null) parts.push(dashed[1] ?? '');
  return parts.join(' ');
}

function matchWords(text: string): number | undefined {
  let best: { level: number; rank: number } | undefined;
  for (const token of tokens(text)) {
    const word = WORD_TOKEN.exec(token)?.[1];
    for (const candidate of word === undefined ? [token] : [token, word]) {
      const found = WORDS.get(candidate);
      if (found !== undefined && (best === undefined || found.rank < best.rank)) best = found;
    }
  }
  return best?.level;
}

function matchAbbreviation(text: string): number | undefined {
  for (const token of tokens(text).reverse()) {
    const match = ABBREVIATION_TOKEN.exec(token);
    if (match === null) continue;
    const prefix = match[1];
    const abbreviation = match[2]!;
    const level =
      ABBREVIATIONS[abbreviation] ??
      (prefix === 'SP' || prefix === 'DP' ? SP_DP_ONLY_ABBREVIATIONS[abbreviation] : undefined) ??
      (prefix !== undefined ? PREFIXED_ONLY_ABBREVIATIONS[abbreviation] : undefined);
    if (level !== undefined) return level;
  }
  return undefined;
}

function matchStemSuffix(stem: string): number | undefined {
  const abbreviation = STEM_SUFFIX.exec(stem.toUpperCase())?.[1];
  return abbreviation !== undefined ? ABBREVIATIONS[abbreviation] : undefined;
}

/** `EX1` / `EX2`: extra charts beyond ANOTHER. */
function matchNumberedEx(stem: string): number | undefined {
  return NUMBERED_EX.test(stem.toUpperCase()) ? 5 : undefined;
}

/** A difficulty word glued to a file name token, unless the title itself has that word (`hyperdiver` of Hyper Diver). */
function matchGluedWord(stem: string, title: string): number | undefined {
  const bareTitle = title
    .replace(BRACKETED, '')
    .toUpperCase()
    .replace(/[^A-Z]/gu, '');
  for (const token of tokens(stem)) {
    const core = token.replace(/\d+$/u, '');
    for (const word of GLUED_WORDS) {
      if (core.endsWith(word) && core !== word && !bareTitle.includes(word)) return WORDS.get(word)!.level;
    }
  }
  return undefined;
}

function fileStem(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The difficulty (1–5) a chart's names suggest, or `undefined` when they suggest none. Read in order, the first hit
 * wins: a difficulty word in the subtitle or a bracketed part of the title (`[SP ANOTHER]`, `-5NORMAL-`), a word in the
 * file name (`_hyper.bms`, `EX2`), a word glued to the file name (`silenteasy`), an abbreviation in the file name
 * (`7a`, `SPH`, `14n`), and an abbreviation in the subtitle or brackets (`[A]`).
 */
export function estimateDifficultyFromNames(names: DifficultyNames): number | undefined {
  const title = names.title ?? '';
  const tags = tagText(names);
  const stem = fileStem(names.fileName ?? '');
  return (
    matchWords(tags) ??
    matchNumberedEx(stem) ??
    matchWords(stem) ??
    matchGluedWord(stem, title) ??
    matchAbbreviation(stem) ??
    matchStemSuffix(stem) ??
    matchAbbreviation(tags)
  );
}
