// LR2's level edit (F3 held with the arrows on the select screen): the player's own difficulty (`#DIFFICULTY`, 1
// BEGINNER … 5 INSANE) and level (`#PLAYLEVEL`) for a chart, kept in this browser and put over the chart's own each time
// the library is read. A chart is known by its path and title, so the same folder dropped again keeps its edits.
import type { LibraryChart } from '@be-music/player-scene-model';

/** Where the edits are kept. */
export const CHART_LEVEL_EDITS_STORAGE_KEY = 'be-music.chart-level-edits';

/** The player's own difficulty and level for a chart. */
export interface ChartLevelEdit {
  readonly difficulty?: number;
  readonly playLevel?: number;
}

/** Every chart's edit, by {@link chartLevelKey}. */
export type ChartLevelEdits = Readonly<Record<string, ChartLevelEdit>>;

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The key a chart's edit is kept under: its path in its source and its title. */
export function chartLevelKey(chart: Pick<LibraryChart, 'chartPath' | 'title'>): string {
  return `${chart.chartPath}\u0000${chart.title}`;
}

/** The edits kept in `storage`, keeping only difficulties of 1-5 and whole levels of 0-99. */
export function readChartLevelEdits(storage: KeyValueStorage | undefined): ChartLevelEdits {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(CHART_LEVEL_EDITS_STORAGE_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const edits: Record<string, ChartLevelEdit> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'object' || value === null) continue;
      const { difficulty, playLevel } = value as Record<string, unknown>;
      const edit: { difficulty?: number; playLevel?: number } = {};
      if (Number.isInteger(difficulty) && (difficulty as number) >= 1 && (difficulty as number) <= 5) {
        edit.difficulty = difficulty as number;
      }
      if (Number.isInteger(playLevel) && (playLevel as number) >= 0 && (playLevel as number) <= 99) {
        edit.playLevel = playLevel as number;
      }
      if (edit.difficulty !== undefined || edit.playLevel !== undefined) edits[key] = edit;
    }
    return edits;
  } catch {
    return {};
  }
}

/** Keeps `edits` in `storage`. */
export function writeChartLevelEdits(storage: KeyValueStorage | undefined, edits: ChartLevelEdits): void {
  try {
    storage?.setItem(CHART_LEVEL_EDITS_STORAGE_KEY, JSON.stringify(edits));
  } catch {
    // Storage full or blocked: the edit holds for this visit only.
  }
}

/** A chart's level as a number: its `#PLAYLEVEL`'s leading digits (`12`, `★5` → 5), 0 without one. */
function levelNumber(playLevel: LibraryChart['playLevel']): number {
  if (typeof playLevel === 'number') return playLevel;
  const digits = /\d+/u.exec(playLevel ?? '');
  return digits === null ? 0 : Number(digits[0]);
}

/**
 * The chart's edit after one step of LR2's level edit: the difficulty steps through 1-5, wrapping, and the level by 1
 * between 0 and 99.
 */
export function stepChartLevel(
  chart: Pick<LibraryChart, 'playLevel'> & { readonly chart: { readonly metadata: { readonly difficulty?: number } } },
  part: 'difficulty' | 'level',
  step: 1 | -1,
): ChartLevelEdit {
  const difficulty = chart.chart.metadata.difficulty;
  const playLevel = levelNumber(chart.playLevel);
  if (part === 'difficulty') {
    const current = difficulty !== undefined && difficulty >= 1 && difficulty <= 5 ? difficulty : step > 0 ? 0 : 6;
    return { ...(difficulty !== undefined ? { difficulty } : {}), difficulty: ((current - 1 + step + 5) % 5) + 1 };
  }
  return {
    ...(difficulty !== undefined ? { difficulty } : {}),
    playLevel: Math.min(99, Math.max(0, playLevel + step)),
  };
}

/** Puts `edits` over the charts' own difficulty and level, in place. */
export function applyChartLevelEdits(charts: readonly LibraryChart[], edits: ChartLevelEdits): void {
  for (const chart of charts) {
    const edit = edits[chartLevelKey(chart)];
    if (edit === undefined) continue;
    if (edit.playLevel !== undefined) chart.playLevel = edit.playLevel;
    if (edit.difficulty !== undefined) chart.chart.metadata.difficulty = edit.difficulty;
  }
}
