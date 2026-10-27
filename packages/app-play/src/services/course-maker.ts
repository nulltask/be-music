// LR2's course maker in the player: the player's own courses and the course being made, kept in IndexedDB
// (`course-maker-store.ts`) and shown on the course-maker card (`course-maker-panel.ts`). While a course is being made,
// a chart decided on the select screen joins it instead of playing.

import { logger } from '@be-music/player-browser';
import { CourseMaker, type BrowserChartCollection, type ChartFileHashes } from '@be-music/player-browser/collection';
import type { SelectScene } from '@be-music/player-browser/host';
import { LR2_COURSE_MAKER_MAX_STAGES } from '@be-music/player-engine/course';
import type { LibraryChart } from '@be-music/player-scene-model';
import { CourseMakerPanel } from '../course-maker-panel.ts';
import { loadMadeCourses, saveMadeCourses } from '../course-maker-store.ts';

const dropLog = logger('drop');

export interface CourseMakerServiceOptions {
  /** A chart's file hashes, cached per chart (`RecordsService`): a course keys its stages by MD5. */
  readonly resolveChartHashes: (chartEntry: LibraryChart) => Promise<ChartFileHashes | undefined>;
  /** The library as last loaded (`LibraryService`). */
  readonly collection: () => BrowserChartCollection;
  /** Relists the course folders after the player's own courses changed (`LibraryService`). */
  readonly refreshMadeCourses: () => Promise<void>;
  /** The select screen the router keeps, on the stage or off it; `undefined` before the first. */
  readonly selectView: () => SelectScene | undefined;
  readonly setStatus: (text: string) => void;
}

/** The course maker, its card, and what it saves and redraws as it changes. */
export class CourseMakerService {
  /** The player's own courses and the course being made (LR2's course maker), kept in IndexedDB. */
  public readonly maker: CourseMaker;
  /** The course-maker card and the "My courses" manager, mounted by {@link start}. */
  public panel: CourseMakerPanel | undefined;
  private readonly collection: CourseMakerServiceOptions['collection'];
  private readonly refreshMadeCourses: CourseMakerServiceOptions['refreshMadeCourses'];
  private readonly selectView: CourseMakerServiceOptions['selectView'];
  private readonly setStatus: CourseMakerServiceOptions['setStatus'];

  public constructor(options: CourseMakerServiceOptions) {
    this.collection = options.collection;
    this.refreshMadeCourses = options.refreshMadeCourses;
    this.selectView = options.selectView;
    this.setStatus = options.setStatus;
    this.maker = new CourseMaker({
      md5Of: async (chartEntry) => (await options.resolveChartHashes(chartEntry))?.md5,
      onChange: (change) => void this.handleCourseMakerChange(change),
    });
  }

  /** Mounts the course-maker card and restores the courses kept in IndexedDB, relisting them once they are read. */
  public start(): void {
    this.panel = new CourseMakerPanel(this.maker, { onStatus: (text) => this.setStatus(text) });
    void loadMadeCourses().then(async (made) => {
      this.maker.restore(made);
      if (made.courses.length > 0 && this.collection().charts.length > 0) await this.refreshMadeCourses();
    });
  }

  /**
   * Reacts to the course maker: redraws its card and the select skin for the course being made, and saves the courses
   * (and relists them) when they or the settings (the default connection, the RANDOM MIX settings) change.
   */
  private async handleCourseMakerChange(change: 'draft' | 'courses' | 'settings'): Promise<void> {
    this.panel?.update();
    if (change === 'draft') {
      // Same collection: the select view only redraws (an LR2 skin's course-maker ops and texts).
      this.selectView()?.setLibrary(this.collection());
      return;
    }
    try {
      await saveMadeCourses({
        courses: [...this.maker.courses],
        defaultConnection: this.maker.defaultConnection,
        randomMixSettings: this.maker.randomMixSettings,
        randomMixes: [...this.maker.randomMixes],
      });
    } catch (error) {
      this.setStatus('Could not save your courses in this browser; they last until the page is closed');
      dropLog.warn('course save failed', error);
    }
    if (change === 'courses') await this.refreshMadeCourses();
    else this.selectView()?.setLibrary(this.collection());
  }

  /**
   * While a course is being made, deciding a song adds it to the course instead of playing it, as LR2 does; deciding one
   * more once it holds five saves the course. Returns whether the song was taken.
   */
  public addChartToCourseBeingMade(chartEntry: LibraryChart): boolean {
    const draft = this.maker.draft;
    if (draft === undefined) return false;
    if (draft.stages.length >= LR2_COURSE_MAKER_MAX_STAGES) {
      const saved = this.maker.finish();
      if (saved !== undefined) this.setStatus(`Saved the course "${saved.name}"`);
      return true;
    }
    void this.maker.append(chartEntry).then((result) => {
      if (result.ok) {
        this.setStatus(`Added ${chartEntry.title} to the course (${this.maker.draft?.stages.length ?? 0} / 5)`);
        return;
      }
      const reasons = {
        full: 'the course already has 5 charts',
        'key-mode': 'its key mode differs from the first chart’s',
        'no-md5': 'its chart could not be hashed',
        'not-making': 'no course is being made',
      } as const;
      this.setStatus(`Could not add ${chartEntry.title}: ${reasons[result.reason]}`);
    });
    return true;
  }
}
