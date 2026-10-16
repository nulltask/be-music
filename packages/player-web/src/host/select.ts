/**
 * The host API for the select screen: `createSelectScene(kit, options)` pairs the select session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import type { BrowseSnapshot, LibraryEntry, PlayOptions, SystemSoundSet } from '@be-music/scene-model';
import type { BrowserSongCollection } from '../collection/types.ts';
import { logger } from '../logger.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { SELECT_POLICIES } from '../session/select/select-policy.ts';
import { SelectSession, type SelectCourseMaker, type SelectSessionEvents } from '../session/select/select-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { BuiltInSelectView } from '../view/built-in/select-view.ts';
import { Lr2SelectView } from '../view/lr2/select-view.ts';
import type { SelectFrame, SelectIntent, SelectRecords, SelectView } from '../view/types.ts';
import type { BuiltInKit, Lr2Kit } from './family-kit.ts';

const log = logger('select');

/**
 * The kits the select scene takes: a be-music skin, or an LR2 select skin (the theme's, with its bar list). The
 * beatoraja select screen is still `PixiBeatorajaSelectScene`.
 */
export type SelectSceneKit = BuiltInKit | Lr2Kit;

export interface SelectSceneOptions extends SessionSceneOptions {
  /** The library to browse, with its charts' files (the preview's samples, the images, the text files). */
  readonly library: BrowserSongCollection;
  /** Where to open it: a browse position saved with `snapshot()`. Without one, a library of one chart folder opens it. */
  readonly browse?: BrowseSnapshot;
  /** The play options to start from, over `DEFAULT_PLAY_OPTIONS`; their sort and filters shape the list. */
  readonly playOptions?: Partial<PlayOptions>;
  /** The player's best records, for the bars and panels. */
  readonly records?: SelectRecords;
  /**
   * The theme's sounds: the select BGM (`selectBgm`, ducked under the chart preview), the cues, and the decide jingle
   * (`decideBgm`), which plays out through the screens that follow.
   */
  readonly sounds: SystemSoundSet;
  readonly audio: AudioService;
  /**
   * The player's own courses and the course being made (LR2's course maker): an LR2 skin shows it and its finish,
   * cancel and connection buttons run on it.
   */
  readonly courseMaker?: SelectCourseMaker;
  /** What the screen tells the host: a chart or a course started, the play options changed, and the rest. */
  readonly on: SelectSessionEvents;
}

/** The select screen as a scene. */
export interface SelectScene extends SessionScene<SelectFrame, SelectIntent> {
  /** The browse position as plain data (`captureBrowse`): hand it back as `browse`, or to `restore`, later. */
  snapshot(): BrowseSnapshot;
  /** The bar under the cursor, or `undefined` when the list is empty. */
  focused(): LibraryEntry | undefined;
  /** The play options in force. */
  getPlayOptions(): PlayOptions;
  /** Takes play options from the host; the screen does not report them back through `on.playOptions`. */
  setPlayOptions(partial: Partial<PlayOptions>): void;
  /**
   * Takes a library: the same one again only redraws; a new one keeps the player's place over it (by folder label and
   * bar key).
   */
  setLibrary(library: BrowserSongCollection): void;
  /** Puts the player back where a snapshot says, over the library as it is now. */
  restore(snapshot: BrowseSnapshot): void;
  /** The records changed (another judge ruleset, a new best): the bars and panels draw them again. */
  refreshRecords(): void;
  /** Searches for `text`; a changed query puts the cursor on the top of the new list. */
  setSearch(text: string): void;
  /** The host's text field is over the skin's search box (`true`) or has left it. */
  setSearchEditing(editing: boolean): void;
  /** Where the skin's search box is on the canvas, in CSS pixels, or `undefined` when it has none. */
  searchFieldRect(): { x: number; y: number; width: number; height: number } | undefined;
  /** Takes the theme's new sounds; a BGM playing changes to the new one. */
  setSounds(sounds: SystemSoundSet): void;
  /**
   * Takes a new kit of the scene's family: the player's new settings for a be-music skin (the scene keeps its skin), or
   * another LR2 select skin (a theme dropped). The next frame draws with it. A kit of another family is ignored.
   */
  updateKit(kit: SelectSceneKit): void;
}

/** A family's select view, and how it takes a new kit. */
interface FamilySelectView {
  readonly view: SelectView;
  updateKit(kit: SelectSceneKit): void;
}

/** The select view of `kit`'s family. */
function createSelectView(kit: SelectSceneKit): FamilySelectView {
  if (kit.family === 'lr2') {
    const view = new Lr2SelectView(kit);
    return { view, updateKit: (next) => (next.family === 'lr2' ? view.updateKit(next) : ignoreKit(next, 'lr2')) };
  }
  const view = new BuiltInSelectView(kit);
  return {
    view,
    updateKit: (next) => (next.family === 'built-in' ? view.updateKit(next) : ignoreKit(next, 'built-in')),
  };
}

function ignoreKit(kit: SelectSceneKit, family: SelectSceneKit['family']): void {
  log.warn(`a ${family} select scene keeps its family; ignoring a ${kit.family} kit`);
}

class FamilySelectScene extends SessionScene<SelectFrame, SelectIntent> implements SelectScene {
  private readonly selectSession: SelectSession;
  private readonly familyView: FamilySelectView;

  public constructor(session: SelectSession, familyView: FamilySelectView, options: SessionSceneOptions) {
    super(session, familyView.view, options);
    this.selectSession = session;
    this.familyView = familyView;
  }

  public snapshot(): BrowseSnapshot {
    return this.selectSession.snapshot();
  }

  public focused(): LibraryEntry | undefined {
    return this.selectSession.focused();
  }

  public getPlayOptions(): PlayOptions {
    return this.selectSession.getPlayOptions();
  }

  public setPlayOptions(partial: Partial<PlayOptions>): void {
    this.selectSession.setPlayOptions(partial);
  }

  public setLibrary(library: BrowserSongCollection): void {
    this.selectSession.setLibrary(library);
  }

  public restore(snapshot: BrowseSnapshot): void {
    this.selectSession.restore(snapshot);
  }

  public refreshRecords(): void {
    this.selectSession.refreshRecords();
  }

  public setSearch(text: string): void {
    this.selectSession.setSearch(text);
  }

  public setSearchEditing(editing: boolean): void {
    this.selectSession.setSearchEditing(editing);
  }

  public searchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    return this.familyView.view.searchFieldRect();
  }

  public setSounds(sounds: SystemSoundSet): void {
    this.selectSession.setSounds(sounds);
  }

  public updateKit(kit: SelectSceneKit): void {
    this.familyView.updateKit(kit);
    // The view builds its skin again from the next frame.
    this.selectSession.refreshRecords();
  }
}

/**
 * The select screen for `kit`: the session browses the library, plays the BGM, the cues, the chart preview and the
 * decide jingle, and says what the player started; the kit's family view draws it. Show it with
 * `PixiSceneHost.setScene`; it can leave the stage and come back (its place, its BGM's decode and its preview's focus
 * are kept). Dispose it once it is gone.
 */
export function createSelectScene(kit: SelectSceneKit, options: SelectSceneOptions): SelectScene {
  const familyView = createSelectView(kit);
  const { view } = familyView;
  const session = new SelectSession({
    library: options.library,
    ...(options.browse !== undefined ? { browse: options.browse } : {}),
    ...(options.playOptions !== undefined ? { playOptions: options.playOptions } : {}),
    ...(options.records !== undefined ? { records: options.records } : {}),
    sounds: options.sounds,
    audio: options.audio,
    ...(options.courseMaker !== undefined ? { courseMaker: options.courseMaker } : {}),
    policy: SELECT_POLICIES[kit.family],
    launchOutroMs: () => view.launchOutroMs,
    ...(options.now !== undefined ? { now: options.now } : {}),
    on: options.on,
  });
  return new FamilySelectScene(session, familyView, {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
