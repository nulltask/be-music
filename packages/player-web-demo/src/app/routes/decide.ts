// The decide route: the decide screen (`createDecideScene`), whichever family draws it, between a start on the select
// screen and its play. A chart's play is made and loads off stage behind the screen (the scene router's `prepare`), and
// takes the stage once the screen is done: that play and no other, or one made again with the screen's draws when its
// load failed (`decide-handoff.ts`). The screen, the play and its load share one navigation. A course's screen leads to
// its first stage instead, and carries its run on. Without a decide screen the chart plays at once.

import { logger } from '@be-music/player-web';
import type { ResolvedPlayChart } from '@be-music/player';
import type { AudioService } from '@be-music/player-web/audio';
import { resolveSongSource, type ChartFileHashes } from '@be-music/player-web/collection';
import { createDecideScene, type PlayScene, type PlaySceneKit, type SelectScene } from '@be-music/player-web/host';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { systemSoundSetFromBeatoraja, type LibraryChart } from '@be-music/scene-model';
import { sanitizeFilenameStem } from '../../demo-utils.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import { allowsLiveTempo, describePlayingStatus } from '../../play-tempo-settings.ts';
import { startArmedRecording, type RecordingDeps } from '../../recording-controller.ts';
import type { LibraryService } from '../../services/library.ts';
import type { PlayOptionsService } from '../../services/play-options.ts';
import type { RecordsService } from '../../services/records.ts';
import type { BeatorajaThemeService } from '../../services/themes/beatoraja.ts';
import type { DemoGuiState, DemoScene, PlayerWebDemoElements } from '../../types.ts';
import type { BeatorajaSkinOptionsPanel } from '../../ui/beatoraja-skin-options.ts';
import { settleDecidePreload, type DecidePreload } from '../decide-handoff.ts';
import type { FamilyKits } from '../family-kits.ts';
import type { SceneRouter, SceneRouteToken } from '../scene-router.ts';
import type { SelectRoute } from './select.ts';

const gameplayLog = logger('gameplay');

/** What a play loading behind a decide screen is made with: the start's AUTO, and the chart as the screen drew it. */
interface DecidePlayOverrides {
  readonly autoPlay?: boolean;
  readonly preResolved: ResolvedPlayChart;
}

/** What a decide screen leads to instead of playing its song: a course's first stage, and what backing out undoes. */
export interface DecideContinuation {
  start: () => Promise<void>;
  cancel?: () => void;
}

/** The family a play's status line names: the beatoraja play's; the built-in and LR2 plays name none. */
export function playingFamily(view: PlayScene): { family?: 'beatoraja' } {
  return view.identity.family === 'beatoraja' ? { family: 'beatoraja' } : {};
}

export interface DecideRouteDeps {
  /** The scene router: the select scene it keeps, and the navigation the screen, the play and its load share. */
  readonly router: Pick<
    SceneRouter<DemoScene, PlayScene, SelectScene>,
    'select' | 'begin' | 'isCurrent' | 'leave' | 'show' | 'prepare'
  >;
  /** The select route: where its screen was, for its next showing to come back to. */
  readonly selectRoute: Pick<SelectRoute, 'lastSelectNavigation'>;
  /** The page: the shell's `playing` class. */
  readonly elements: Pick<PlayerWebDemoElements, 'shell'>;
  /** The library: the chart's asset source. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The chart hashes the play's log records. */
  readonly records: Pick<RecordsService, 'resolveChartHashes'>;
  /** The family that draws the screen and the play, and the kits they draw with. */
  readonly familyKits: Pick<FamilyKits, 'familyDispatchState' | 'playsOnBeatoraja' | 'decideKitFor' | 'resolvePlayKit'>;
  /** The beatoraja theme's sounds: its decide sound. */
  readonly beatoraja: Pick<BeatorajaThemeService, 'beatorajaThemeBgm'>;
  /** The play options in force, which the screen shows. */
  readonly playOptions: Pick<PlayOptionsService, 'current'>;
  /** The Debug Menu's auto play, and the tempo the status line shows. */
  readonly guiState: Pick<DemoGuiState, 'autoPlay' | 'tempoPercent' | 'tempoPitchMode'>;
  readonly audio: AudioService;
  /** The skin-options panel of the beatoraja play showing. */
  readonly beatorajaSkinOptions: Pick<BeatorajaSkinOptionsPanel, 'refreshBeatorajaPlaySkinOptions'>;
  /** The play last made: whether it is a replay. */
  readonly lastPlay: () => { readonly overrides: { readonly replay?: BeMusicPlaylog } } | undefined;
  /** The video recording's deps: a recording armed on the select screen starts with the play. */
  readonly recordingDeps: () => RecordingDeps;
  /** Names the next saved recording after the chart. */
  readonly setRecordingFilenameBase: (base: string) => void;
  readonly setStatus: (text: string) => void;
  /** Shows a status about the play, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  /** Latches the options a play takes for it, and disables their controls. */
  readonly lockPlaylogOptionsForPlay: (liveTempo?: boolean) => void;
  readonly showSelect: () => Promise<void>;
  /** Plays a chart with no decide screen: one with none, or a play made again after its load failed. */
  readonly playSong: (
    song: LibraryChart,
    overrides: { autoPlay?: boolean; preResolved?: ResolvedPlayChart },
  ) => Promise<void>;
  /** Makes the play scene for a chart with the play options in force. */
  readonly buildPlayScene: (
    song: LibraryChart,
    kit: PlaySceneKit,
    overrides: { autoPlay?: boolean; preResolved?: ResolvedPlayChart; chartHashes?: ChartFileHashes },
  ) => PlayScene;
}

/** A start's decide screen, and the play it hands the stage to. */
export class DecideRoute {
  private readonly router: DecideRouteDeps['router'];
  private readonly selectRoute: DecideRouteDeps['selectRoute'];
  private readonly elements: DecideRouteDeps['elements'];
  private readonly library: DecideRouteDeps['library'];
  private readonly records: DecideRouteDeps['records'];
  private readonly familyKits: DecideRouteDeps['familyKits'];
  private readonly beatoraja: DecideRouteDeps['beatoraja'];
  private readonly playOptions: DecideRouteDeps['playOptions'];
  private readonly guiState: DecideRouteDeps['guiState'];
  private readonly audio: DecideRouteDeps['audio'];
  private readonly beatorajaSkinOptions: DecideRouteDeps['beatorajaSkinOptions'];
  private readonly lastPlay: DecideRouteDeps['lastPlay'];
  private readonly recordingDeps: DecideRouteDeps['recordingDeps'];
  private readonly setRecordingFilenameBase: DecideRouteDeps['setRecordingFilenameBase'];
  private readonly setStatus: DecideRouteDeps['setStatus'];
  private readonly setPlayStatus: DecideRouteDeps['setPlayStatus'];
  private readonly lockPlaylogOptionsForPlay: DecideRouteDeps['lockPlaylogOptionsForPlay'];
  private readonly showSelect: DecideRouteDeps['showSelect'];
  private readonly playSong: DecideRouteDeps['playSong'];
  private readonly buildPlayScene: DecideRouteDeps['buildPlayScene'];

  public constructor(deps: DecideRouteDeps) {
    this.router = deps.router;
    this.selectRoute = deps.selectRoute;
    this.elements = deps.elements;
    this.library = deps.library;
    this.records = deps.records;
    this.familyKits = deps.familyKits;
    this.beatoraja = deps.beatoraja;
    this.playOptions = deps.playOptions;
    this.guiState = deps.guiState;
    this.audio = deps.audio;
    this.beatorajaSkinOptions = deps.beatorajaSkinOptions;
    this.lastPlay = deps.lastPlay;
    this.recordingDeps = deps.recordingDeps;
    this.setRecordingFilenameBase = deps.setRecordingFilenameBase;
    this.setStatus = deps.setStatus;
    this.setPlayStatus = deps.setPlayStatus;
    this.lockPlaylogOptionsForPlay = deps.lockPlaylogOptionsForPlay;
    this.showSelect = deps.showSelect;
    this.playSong = deps.playSong;
    this.buildPlayScene = deps.buildPlayScene;
  }

  /** The select screen (`createSelectScene`), whichever family draws it, kept by the router across the other screens. */
  private get selectView(): SelectScene | undefined {
    return this.router.select;
  }

  /**
   * Mounts the decide-screen splash and routes the user into gameplay when it dismisses (auto-advance OR Enter / Space
   * / Escape input). Without a decide skin, falls straight through to `playSong` so themes that don't ship a Decide
   * directory still play the chart immediately. Every family's splash is `createDecideScene`'s: on the beatoraja family
   * the theme's decide entry, on the LR2 family the theme's decide skin, on the default family the be-music skin's own
   * decide screen, shown only when the skin declares one.
   *
   * The select screen's decide jingle, started as the chart was picked, plays on through the splash, which visually
   * masks the chart-load + gameplay-mount window that comes next. The beatoraja splash plays its theme's decide sound
   * itself.
   */
  public async showDecide(
    song: LibraryChart,
    overrides: { autoPlay?: boolean } = {},
    then?: DecideContinuation,
  ): Promise<void> {
    const start = then?.start ?? (() => this.playSong(song, overrides));
    // Family dispatch for the decide splash. Note this is decoupled from the gameplay family pick: a user can be
    // playing in LR2 mode and have a beatoraja-only decide skin, or vice versa. The decide splash is a one-shot
    // overlay so each scene transition consults the family helper afresh.
    const decideFamily = pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'decide', song);
    const playsOnBeatoraja = this.familyKits.playsOnBeatoraja(song);
    const kit = await this.familyKits.decideKitFor(decideFamily, song, playsOnBeatoraja);
    if (kit === undefined) {
      // No decide splash: a be-music skin without one, an LR2-only setup that didn't ship a decide skin, or a beatoraja
      // theme without a decide skin (or one that failed to load). The select screen's decide jingle still plays.
      await start();
      return;
    }
    // One navigation from here into the play: the play loading behind the splash, the splash and the play share it. A
    // course's splash (`then`) carries its run on; a chart's starts a run of its own.
    const token = this.router.begin({ continuesRun: then !== undefined });
    this.selectRoute.lastSelectNavigation = this.selectView?.snapshot();
    // The select screen goes off the stage (kept), and any decide splash or play left over goes.
    if (!(await this.router.leave({ token }))) return;
    // Build the gameplay view eagerly and kick off its heavy load (chart parse, audio decode, BGA preload) IN PARALLEL
    // with the Decide animation, off stage (`prepare` attaches nothing until the play is shown). The Decide splash
    // typically runs ~3 s; chart asset decoding is mostly done by the time the splash auto-advances, so the hand-off to
    // gameplay becomes instant instead of dropping a frozen frame.
    // A course starts its own play once the splash is done, so nothing is preloaded for it. The play is preloaded once the
    // decide screen is made, whichever family draws either, so it plays the `#RANDOM` branches the screen drew
    // (`DecideScene.resolved`).
    let preload: DecidePreload<PlayScene, DecidePlayOverrides> | undefined;
    let advanced = false;
    const advance = (then: () => void): void => {
      // Idempotent — the auto-advance timer, key input, and pointer click can all race; whichever lands first wins and
      // re-entries no-op.
      if (advanced) return;
      advanced = true;
      then();
    };
    const callbacks = {
      onContinue: () =>
        advance(() => {
          // A course's play takes the stage from the splash as it starts.
          if (preload === undefined) {
            void start();
            return;
          }
          void this.startGameplayAfterDecide(song, preload, token);
        }),
      onCancel: () =>
        advance(() => {
          // User backed out of the splash: the select screen comes back, and the play prepared behind the splash goes.
          then?.cancel?.();
          void this.showSelect();
        }),
    };
    const decide = createDecideScene(kit, {
      chart: song,
      playOptions: { ...this.playOptions.current, autoPlay: overrides.autoPlay ?? this.guiState.autoPlay },
      source: resolveSongSource(this.library.collection, song),
      // The LR2 / built-in select screen plays the theme's decide jingle as the chart is picked, and lets it ring on
      // into the play, so those screens play none of their own. The beatoraja screen plays its theme's decide sound.
      sounds: kit.family === 'beatoraja' ? systemSoundSetFromBeatoraja({ bgm: this.beatoraja.beatorajaThemeBgm }) : {},
      audio: this.audio,
      on: { continue: callbacks.onContinue, cancel: callbacks.onCancel },
    });
    if (then === undefined) {
      const options = { ...overrides, preResolved: decide.resolved };
      preload = { options, play: this.preloadGameplay(song, options, token) };
    }
    const shown = await this.router.show(decide, { role: 'decide', token });
    if (shown && kit.family === 'beatoraja') this.setStatus(`Decide (beatoraja): ${song.title}`);
  }

  /**
   * Makes the play scene (`createPlayScene`) with the current play-options snapshot and has the router load it off
   * stage (`prepare`) for the navigation `token`. The returned promise resolves to that play once chart audio is decoded
   * (`undefined` when a newer navigation replaced it) — the host awaits it inside the Decide `onContinue` handler and
   * shows that play.
   *
   * Wired up here (rather than inline in `showDecide`) because the same option-marshalling + callback wiring is needed
   * whether we're going through Decide or the no-decide fast-path. `playSong` shares this construction shape.
   */
  private async preloadGameplay(
    song: LibraryChart,
    overrides: { autoPlay?: boolean; preResolved?: ResolvedPlayChart },
    token: SceneRouteToken,
  ): Promise<PlayScene | undefined> {
    this.setRecordingFilenameBase(sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`);
    // The same kit as `playSong` picks, so the decide → gameplay preload path stays consistent with the no-decide
    // fast-path.
    const kit = await this.familyKits.resolvePlayKit(song, {});
    if (kit === undefined) throw new Error(`no play skin for ${song.title}`);
    const chartHashes = await this.records.resolveChartHashes(song);
    const view = this.buildPlayScene(song, kit, { ...overrides, chartHashes });
    return (await this.router.prepare(view, { token })) ? view : undefined;
  }

  /**
   * Tears the Decide splash down and hands the stage over to the play prepared behind it (`preload`), that play and no
   * other. Awaits the preload: when the user dismisses Decide before chart audio has finished decoding, the splash's
   * last frame stays on screen until prepare resolves — visually a brief hold rather than the previous frozen-frame
   * freeze. A preload that failed makes the play again without one, with the splash's draws (`preResolved`).
   */
  private async startGameplayAfterDecide(
    song: LibraryChart,
    preload: DecidePreload<PlayScene, DecidePlayOverrides>,
    token: SceneRouteToken,
  ): Promise<void> {
    const handOff = await settleDecidePreload(preload, () => this.router.isCurrent(token));
    if (handOff.kind === 'stale') return;
    if (handOff.kind === 'reload') {
      // The play that failed to load is gone already; the splash goes as the play made again takes the stage.
      gameplayLog.warn('preload failed; falling back to no-decide path', handOff.error);
      await this.playSong(song, handOff.options);
      return;
    }
    const view = handOff.play;
    this.elements.shell.classList.add('playing');
    this.selectRoute.lastSelectNavigation = this.selectView?.snapshot();
    // The splash hands the stage over: it exits as the prepared play enters, then goes.
    if (!(await this.router.show(view, { role: 'play', token }))) return;
    this.setPlayStatus(
      describePlayingStatus(song.title, {
        ...playingFamily(view),
        tempoPercent: this.guiState.tempoPercent,
        replay: this.lastPlay()?.overrides.replay !== undefined,
      }),
    );
    this.lockPlaylogOptionsForPlay(
      allowsLiveTempo(this.guiState, {
        replay: this.lastPlay()?.overrides.replay !== undefined,
        tempo: view.getTempo(),
      }),
    );
    view.start();
    startArmedRecording(this.recordingDeps());
    this.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions();
  }
}
