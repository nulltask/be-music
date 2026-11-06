/*
 * A chart's `#DIFFICULTY` as beatoraja reads it when the chart names none: from the difficulty name in its subtitle,
 * then in its title and subtitle together, then from its note count (beatoraja `SQLiteSongDatabaseAccessor`
 * `assignDifficulty` L962-L983 @ 69954f8). LR2 estimates nothing; Be-Music follows beatoraja here.
 */

/** The difficulty names beatoraja looks for, in the order it tries them, with the `#DIFFICULTY` each stands for. */
const DIFFICULTY_NAMES: readonly (readonly [readonly string[], number])[] = [
  [['beginner'], 1],
  [['normal'], 2],
  [['hyper'], 3],
  [['another'], 4],
  [['insane', 'leggendaria'], 5],
];

/** What a difficulty estimate reads of a chart. */
export interface DifficultyEstimateSource {
  /** `#DIFFICULTY`, when the chart names one (1-5; 0 or absent is none). */
  difficulty?: number;
  title: string;
  subtitle?: string;
  /** The chart's note count. */
  notes: number;
}

/** The `#DIFFICULTY` a name in `text` (lowercased) stands for, or `undefined`. */
function difficultyNamed(text: string): number | undefined {
  for (const [names, difficulty] of DIFFICULTY_NAMES) if (names.some((name) => text.includes(name))) return difficulty;
  return undefined;
}

/**
 * The chart's `#DIFFICULTY`, or, when it names none, the one beatoraja estimates: a difficulty name (BEGINNER, NORMAL,
 * HYPER, ANOTHER, INSANE or LEGGENDARIA, any case) in the subtitle, else in the title and subtitle; else by the note
 * count (below 250 BEGINNER, 600 NORMAL, 1000 HYPER, 2000 ANOTHER, else INSANE).
 */
export function estimateChartDifficulty(chart: DifficultyEstimateSource): number {
  if (chart.difficulty !== undefined && chart.difficulty !== 0) return chart.difficulty;
  const subtitle = (chart.subtitle ?? '').toLowerCase();
  const named = difficultyNamed(subtitle) ?? difficultyNamed(`${chart.title.toLowerCase()}${subtitle}`);
  if (named !== undefined) return named;
  if (chart.notes < 250) return 1;
  if (chart.notes < 600) return 2;
  if (chart.notes < 1000) return 3;
  if (chart.notes < 2000) return 4;
  return 5;
}
