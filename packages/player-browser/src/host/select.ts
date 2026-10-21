/**
 * The host API for the select screen: `createSelectScene(kit, options)` pairs the select session with the view of the
 * kit's family and returns the scene to show with `PixiSceneHost.setScene`.
 */

import { DOMSelectView } from '../view/built-in/dom-view.ts';
import type { BeatorajaSkinConfig } from '@be-music/skin-beatoraja';
import type { BrowseSnapshot, LibraryEntry, PlayOptions, SystemSoundSet } from '@be-music/player-scene-model';
import type { BrowserChartCollection } from '../collection/types.ts';
import { logger } from '../logger.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { SELECT_POLICIES } from '../session/select/select-policy.ts';
import { SelectSession, type SelectCourseMaker, type SelectSessionEvents } from '../session/select/select-session.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { BeatorajaSelectView } from '../view/beatoraja/select-view.ts';
import { BuiltInSelectView } from '../view/built-in/select-view.ts';
import { LR2SelectView } from '../view/lr2/select-view.ts';
import type { SelectFrame, SelectIntent, SelectRecords, SelectView } from '../view/types.ts';
import type { SelectKit } from './family-kit.ts';

const log = logger('select');

/**
 * The kits the select scene takes: a be-music skin, an LR2 select skin (the theme's, with its bar list), or a beatoraja
 * theme's select entry, loaded with `loadBeatorajaSceneKit`.
 */
export type SelectSceneKit = SelectKit;

/** What the select screen tells the host: what its session reports, and what a beatoraja skin changes of itself. */
export interface SelectSceneEvents extends SelectSessionEvents {
  /**
   * A beatoraja skin's JUDGE TIMING button changed the skin's options (their `offset`): keep them for the next load of
   * the entry. The screen draws with them already.
   */
  skinConfigChange?(config: BeatorajaSkinConfig): void;
}

export interface SelectSceneOptions extends SessionSceneOptions {
  /** The library to browse, with its charts' files (the preview's samples, the images, the text files). */
  readonly library: BrowserChartCollection;
  /** Where to open it: a browse position saved with `snapshot()`. Without one, a library of one chart folder opens it. */
  readonly browse?: BrowseSnapshot;
  /** The play options to start from, over `DEFAULT_PLAY_OPTIONS`; their sort and filters shape the list. */
  readonly playOptions?: Partial<PlayOptions>;
  /** The player's best records, for the bars and panels. */
  readonly records?: SelectRecords;
  /**
   * The theme's sounds: the select BGM (`selectBGM`, ducked under the chart preview), the cues, and the decide jingle
   * (`decideBGM`), which plays out through the screens that follow.
   */
  readonly sounds: SystemSoundSet;
  readonly audio: AudioService;
  /**
   * The player's own courses and the course being made (LR2's course maker): an LR2 skin shows it and its finish,
   * cancel and connection buttons run on it.
   */
  readonly courseMaker?: SelectCourseMaker;
  /** What the screen tells the host: a chart or a course started, the play options changed, and the rest. */
  readonly on: SelectSceneEvents;
}

/** The select screen as a scene. */
export interface SelectScene extends SessionScene<SelectFrame, SelectIntent> {
  /** The skin owns a native search input, so the host can hide its overlay input. */
  readonly ownsSearchInput: boolean;
  focusSearch(): boolean;
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
  setLibrary(library: BrowserChartCollection): void;
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
   * Takes a new kit of the scene's family: the player's new settings for a be-music skin (the scene keeps its skin),
   * another LR2 select skin (a theme dropped), or a beatoraja select entry loaded again (the player's options for it,
   * or another entry). The next frame draws with it. A kit of another family is ignored.
   */
  updateKit(kit: SelectSceneKit): void;
}

/** A family's select view, and how it takes a new kit. */
interface FamilySelectView {
  readonly view: SelectView;
  updateKit(kit: SelectSceneKit): void;
}

/**
 * The select view of `kit`'s family. A beatoraja skin's Lua sounds play through the audio service as the session's, so
 * they stop as the screen leaves.
 */
function createSelectView(
  kit: SelectSceneKit,
  session: SelectSession,
  options: Pick<SelectSceneOptions, 'audio' | 'on'>,
): FamilySelectView {
  switch (kit.family) {
    case 'lr2': {
      const view = new LR2SelectView(kit);
      return { view, updateKit: (next) => (next.family === 'lr2' ? view.updateKit(next) : ignoreKit(next, 'lr2')) };
    }
    case 'beatoraja': {
      const { on } = options;
      const view = new BeatorajaSelectView(kit, {
        skinSounds: options.audio.skinSounds.owned(session),
        ...(on.skinConfigChange !== undefined ? { onSkinConfigChange: (config) => on.skinConfigChange?.(config) } : {}),
      });
      return {
        view,
        updateKit: (next) => (next.family === 'beatoraja' ? view.updateKit(next) : ignoreKit(next, 'beatoraja')),
      };
    }
    case 'built-in': {
      const view = kit.skin.dom?.select ? new DOMSelectView(kit) : new BuiltInSelectView(kit);
      return {
        view,
        updateKit: (next) => (next.family === 'built-in' ? view.updateKit(next) : ignoreKit(next, 'built-in')),
      };
    }
  }
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

  public get ownsSearchInput(): boolean {
    return this.familyView.view.ownsSearchInput === true;
  }
  public focusSearch(): boolean {
    return this.familyView.view.focusSearch?.() ?? false;
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

  public setLibrary(library: BrowserChartCollection): void {
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
  // The session asks the view for its skin's launch outro, and a beatoraja view's skin sounds belong to the session.
  let familyView: FamilySelectView | undefined;
  const session = new SelectSession({
    library: options.library,
    ...(options.browse !== undefined ? { browse: options.browse } : {}),
    ...(options.playOptions !== undefined ? { playOptions: options.playOptions } : {}),
    ...(options.records !== undefined ? { records: options.records } : {}),
    sounds: options.sounds,
    audio: options.audio,
    ...(options.courseMaker !== undefined ? { courseMaker: options.courseMaker } : {}),
    policy: SELECT_POLICIES[kit.family],
    launchOutroMs: () => familyView?.view.launchOutroMs ?? 0,
    ...(options.now !== undefined ? { now: options.now } : {}),
    on: options.on,
  });
  familyView = createSelectView(kit, session, options);
  return new FamilySelectScene(session, familyView, {
    ...(options.keyTarget !== undefined ? { keyTarget: options.keyTarget } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}
