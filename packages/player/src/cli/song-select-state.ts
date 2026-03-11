import { computed, signal } from 'alien-signals';
import type { ChartSelectionEntry } from './chart-selection.ts';
import type { PlayMode } from './config.ts';
import { normalizeHighSpeedValue } from './config.ts';
import type { SongSelectDifficultyFilter } from './song-select-navigation.ts';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export interface SongSelectViewState {
  entries: ChartSelectionEntry[];
  selectableIndexes: number[];
  chartIndexes: number[];
  chartCount: number;
  chartFiles: string[];
  selectableIndexByEntryIndex: Map<number, number>;
  chartIndexByEntryIndex: Map<number, number>;
}

export interface SongSelectState {
  readonly difficultyFilter: WritableSignal<SongSelectDifficultyFilter | undefined>;
  readonly playMode: WritableSignal<PlayMode>;
  readonly highSpeed: WritableSignal<number>;
  readonly selectedIndex: WritableSignal<number>;
  readonly view: () => SongSelectViewState;
  ensureSelectedIndex: (preferredFocusKey?: string) => void;
}

export interface CreateSongSelectStateOptions {
  initialDifficultyFilter?: SongSelectDifficultyFilter;
  initialPlayMode?: PlayMode;
  initialHighSpeed?: number;
  initialFocusKey?: string;
}

export function createSongSelectState(
  allEntries: ChartSelectionEntry[],
  options: CreateSongSelectStateOptions = {},
): SongSelectState {
  const difficultyFilter = signal<SongSelectDifficultyFilter | undefined>(options.initialDifficultyFilter);
  const playMode = signal<PlayMode>(options.initialPlayMode ?? 'manual');
  const highSpeed = signal(normalizeHighSpeedValue(options.initialHighSpeed));
  const selectedIndex = signal(0);

  const view = computed(() => {
    const entries = filterChartSelectionEntries(allEntries, difficultyFilter());
    const selectableIndexes = entries.flatMap((entry, index) => (entry.kind === 'group' ? [] : [index]));
    const chartIndexes = entries.flatMap((entry, index) => (entry.kind === 'chart' ? [index] : []));
    const selectableIndexByEntryIndex = new Map<number, number>();
    const chartIndexByEntryIndex = new Map<number, number>();
    for (let index = 0; index < selectableIndexes.length; index += 1) {
      selectableIndexByEntryIndex.set(selectableIndexes[index]!, index);
    }
    for (let index = 0; index < chartIndexes.length; index += 1) {
      chartIndexByEntryIndex.set(chartIndexes[index]!, index);
    }
    return {
      entries,
      selectableIndexes,
      chartIndexes,
      chartCount: chartIndexes.length,
      chartFiles: entries.flatMap((entry) => (entry.kind === 'chart' ? [entry.filePath] : [])),
      selectableIndexByEntryIndex,
      chartIndexByEntryIndex,
    } satisfies SongSelectViewState;
  });

  const ensureSelectedIndex = (preferredFocusKey?: string): void => {
    const resolvedView = view();
    if (resolvedView.entries.length === 0) {
      selectedIndex(0);
      return;
    }
    let nextSelectedIndex = Math.max(0, Math.min(selectedIndex(), resolvedView.entries.length - 1));
    const focusKey = preferredFocusKey ?? getEntryFocusKey(resolvedView.entries[nextSelectedIndex]);
    if (focusKey) {
      const found = resolvedView.selectableIndexes.find(
        (index) => getEntryFocusKey(resolvedView.entries[index]) === focusKey,
      );
      if (typeof found === 'number') {
        selectedIndex(found);
        return;
      }
    }
    if (
      resolvedView.selectableIndexes.length > 0 &&
      !resolvedView.selectableIndexByEntryIndex.has(nextSelectedIndex)
    ) {
      nextSelectedIndex = resolvedView.selectableIndexes[0]!;
    }
    selectedIndex(nextSelectedIndex);
  };

  ensureSelectedIndex(options.initialFocusKey);

  return {
    difficultyFilter,
    playMode,
    highSpeed,
    selectedIndex,
    view,
    ensureSelectedIndex,
  };
}

export function filterChartSelectionEntries(
  entries: readonly ChartSelectionEntry[],
  difficultyFilter: SongSelectDifficultyFilter | undefined,
): ChartSelectionEntry[] {
  if (typeof difficultyFilter !== 'number') {
    return [...entries];
  }

  const filtered: ChartSelectionEntry[] = [];
  let pendingGroup: Extract<ChartSelectionEntry, { kind: 'group' }> | undefined;
  let hasVisibleCharts = false;

  for (const entry of entries) {
    if (entry.kind === 'random') {
      continue;
    }
    if (entry.kind === 'group') {
      pendingGroup = entry;
      continue;
    }
    if (entry.difficulty !== difficultyFilter) {
      continue;
    }
    if (pendingGroup) {
      filtered.push(pendingGroup);
      pendingGroup = undefined;
    }
    filtered.push(entry);
    hasVisibleCharts = true;
  }

  if (hasVisibleCharts) {
    filtered.unshift({ kind: 'random', label: '[Random] Select a chart randomly' });
  }
  return filtered;
}

export function getEntryFocusKey(entry: ChartSelectionEntry | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }
  if (entry.kind === 'random') {
    return 'random';
  }
  if (entry.kind === 'chart') {
    return createChartFocusKey(entry.filePath);
  }
  return undefined;
}

export function createChartFocusKey(filePath: string): string {
  return `chart:${filePath}`;
}
