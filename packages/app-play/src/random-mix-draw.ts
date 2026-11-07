// A RANDOM MIX drawn one stage at a time from the charts that fit the RANDOM MIX dialog's conditions. Only the charts a
// draw walks have their BPMs read, and only the songs it picks have their chart file hashed (a course keys its stages
// by MD5), so a draw costs the same however large the library is. The draw rules are `drawRandomMixStage`'s
// (`@be-music/player-engine/course`).

import {
  drawRandomMixStage,
  type LR2RandomMixSettings,
  type RandomMixBPMRange,
  type RandomMixCandidate,
  type RandomMixStage,
} from '@be-music/player-engine/course';
import type { LibraryChart } from '@be-music/player-scene-model';

/** A entry a RANDOM MIX can draw: its candidate facts and the entry itself. */
export type RandomMixPoolChart = RandomMixCandidate & { readonly chart: LibraryChart };

/** A drawn stage: the entry and the stage as the course keys it. */
export interface RandomMixDrawnStage {
  chart: LibraryChart;
  stage: RandomMixStage;
}

export interface RandomMixDrawOptions {
  /** LR2's RANDOM MIX settings: the BPM limits, the BPM range and the favorite level. */
  settings: LR2RandomMixSettings;
  /** A entry's BPMs, read only for the songs a draw walks. */
  bpmOf: (chart: LibraryChart) => RandomMixBPMRange;
  /** A entry's chart MD5, read only for the songs drawn; `undefined` for one that cannot be hashed (never drawn again). */
  md5Of: (chart: LibraryChart) => Promise<string | undefined>;
  random: () => number;
  /** Draw a chart whose BPM changes too (`RandomMixConditions.allowBPMChanges`). */
  allowBPMChanges?: boolean;
  /**
   * An endless draw: once every entry folder has been drawn, the folders are free again (all but the last one drawn,
   * unless it is the only one), so the draw goes on as long as the pool holds a entry.
   */
  endless?: boolean;
}

/** The stages of one RANDOM MIX, drawn as they are asked for. */
export class RandomMixDraw {
  private readonly pool: readonly RandomMixPoolChart[];
  private readonly options: RandomMixDrawOptions;
  private readonly usedFolders = new Set<string>();
  private readonly excluded = new Set<RandomMixPoolChart>();
  private first: RandomMixPoolChart | undefined;
  private last: RandomMixPoolChart | undefined;

  /** `pool`: the charts that fit the conditions (`filterRandomMixCandidates`). */
  constructor(pool: readonly RandomMixPoolChart[], options: RandomMixDrawOptions) {
    this.pool = pool;
    this.options = options;
  }

  /** Draws the next stage, or `undefined` when no entry is left that fits. */
  async next(): Promise<RandomMixDrawnStage | undefined> {
    for (;;) {
      const entry = this.pick();
      if (entry === undefined) return undefined;
      const md5 = await this.options.md5Of(entry.chart);
      if (md5 === undefined || !/^[0-9a-f]{32}$/iu.test(md5)) {
        this.excluded.add(entry);
        continue;
      }
      this.first ??= entry;
      this.last = entry;
      this.usedFolders.add(entry.folder);
      const { chart } = entry;
      return {
        chart,
        stage: {
          md5: md5.toLowerCase(),
          keyMode: entry.keyMode,
          title: chart.title,
          ...(chart.subtitle !== undefined ? { subtitle: chart.subtitle } : {}),
          ...(chart.artist !== undefined ? { artist: chart.artist } : {}),
        },
      };
    }
  }

  /** Draws `count` stages up front (fewer when the pool runs out). */
  async take(count: number): Promise<RandomMixDrawnStage[]> {
    const stages: RandomMixDrawnStage[] = [];
    while (stages.length < count) {
      const stage = await this.next();
      if (stage === undefined) break;
      stages.push(stage);
    }
    return stages;
  }

  private pick(): RandomMixPoolChart | undefined {
    const draw = () =>
      drawRandomMixStage(
        this.pool,
        {
          settings: this.options.settings,
          bpmOf: (entry) => this.options.bpmOf(entry.chart),
          ...(this.options.allowBPMChanges === true ? { allowBPMChanges: true } : {}),
          ...(this.first !== undefined ? { first: this.first } : {}),
          usedFolders: this.usedFolders,
          excluded: this.excluded,
        },
        this.options.random,
      );
    const entry = draw();
    if (entry !== undefined || this.options.endless !== true || this.last === undefined) return entry;
    // Every folder has been drawn: free them again, all but the last one, so a entry does not follow itself unless the
    // pool has only its folder.
    this.usedFolders.clear();
    this.usedFolders.add(this.last.folder);
    const again = draw();
    if (again !== undefined) return again;
    this.usedFolders.clear();
    return draw();
  }
}
