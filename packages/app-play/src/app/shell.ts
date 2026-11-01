// The page around the stage: the shell's state as the scenes change (the play's overlays, the touch controls shown, the
// pinch zoom), the canvas's fullscreen toggle with its Escape handling, and the on-screen pause and quit buttons. The
// app wires it once the scene host is mounted (`PlayerWebApp.mountStage`).

import { logger } from '@be-music/player-browser';
import type { PixiSceneHost, PlayScene, SceneKind } from '@be-music/player-browser/host';
import type { DeviceProfile } from '../device-profile.ts';
import {
  enterTouchFullscreen,
  exitFullscreen,
  FullscreenEscapeLock,
  getFullscreenElement,
  type KeyboardLockNavigatorLike,
  shouldCaptureFullscreenEscape,
  toggleFullscreen,
} from '../fullscreen.ts';
import type { InlineSearch } from '../inline-search.ts';
import type { PlayerWebElements } from '../types.ts';
import { resolveShellState, shellStateKey } from './shell-state.ts';

const fullscreenLog = logger('fullscreen');

/** What the shell reads of the app: the stage, the shell element, the search field, the device and the play. */
export interface PlayerShellDeps {
  readonly sceneHost: PixiSceneHost;
  readonly elements: Pick<PlayerWebElements, 'shell'>;
  readonly search: Pick<InlineSearch, 'skinHasBox'> & Partial<Pick<InlineSearch, 'ownsNativeInput'>>;
  readonly deviceProfile: Pick<DeviceProfile, 'phone'>;
  /** The play, whichever family draws it: loading behind a decide screen, or on the stage. */
  readonly gameplayView: () => PlayScene | undefined;
  /** The kind of scene on stage, `undefined` between scenes. */
  readonly showing: () => SceneKind | undefined;
}

/** The player shell around the stage: its gameplay state, fullscreen and touch controls. */
export class PlayerShell {
  private readonly sceneHost: PlayerShellDeps['sceneHost'];
  private readonly elements: PlayerShellDeps['elements'];
  private readonly search: PlayerShellDeps['search'];
  private readonly deviceProfile: PlayerShellDeps['deviceProfile'];
  private readonly readGameplayView: PlayerShellDeps['gameplayView'];
  private readonly readShowing: PlayerShellDeps['showing'];

  public constructor(deps: PlayerShellDeps) {
    this.sceneHost = deps.sceneHost;
    this.elements = deps.elements;
    this.search = deps.search;
    this.deviceProfile = deps.deviceProfile;
    this.readGameplayView = deps.gameplayView;
    this.readShowing = deps.showing;
  }

  /** The play (`createPlayScene`), whichever family draws it: loading behind a decide screen, or on the stage. */
  private get gameplayView(): PlayScene | undefined {
    return this.readGameplayView();
  }

  /** Last state {@link syncGameplayShellState} applied, so the per-frame check only touches the DOM on a change. */
  private shellGameplayState = '';

  /**
   * The on-screen pause / quit buttons phones and tablets get during play (they have no Space or Escape key). Pause
   * toggles; Quit, shown while paused, leaves the play the way Escape does.
   */
  public wireTouchControls(): void {
    const pause = document.querySelector<HTMLButtonElement>('#touch-pause');
    const quit = document.querySelector<HTMLButtonElement>('#touch-quit');
    pause?.addEventListener('click', () => this.gameplayView?.requestTogglePause());
    quit?.addEventListener('click', () => {
      const view = this.gameplayView;
      if (!view) return;
      // Resume first so the exit fade (which runs on the play clock) plays out instead of freezing on the pause.
      if (view.isPaused()) view.requestTogglePause();
      view.requestExit();
    });
  }

  /**
   * Marks the shell `in-gameplay` while a play screen is up, so the select-screen overlays (the floating Help button and
   * the search box) step aside instead of covering the skin's track plate. Checked every frame because the gameplay
   * views are created and torn down along many paths; a play being prepared behind a decide splash counts already.
   * Off the select screen (a result, say) the shell is `off-select`, which hides the search field for every family.
   */
  public readonly syncGameplayShellState = (): void => {
    const view = this.gameplayView;
    const resolved = resolveShellState({
      playFamily: view?.identity.family,
      paused: view?.isPaused() === true,
      showing: this.readShowing(),
      // A skin drawing on its portrait stage needs no rotate prompt on a phone held upright.
      portraitStage: this.sceneHost.getStageOrientation() === 'portrait',
      skinHasBox: this.search.skinHasBox,
    });
    this.elements.shell.classList.toggle('native-search', this.search.ownsNativeInput === true);
    const state = shellStateKey(resolved);
    if (state === this.shellGameplayState) return;
    this.shellGameplayState = state;
    const { inGameplay, touchPlay, paused, portraitStage, searchInSkin, offSelect } = resolved;
    const { shell } = this.elements;
    shell.classList.toggle('in-gameplay', inGameplay);
    // A skin with its own search box hides the field at the foot of the screen; the box opens it in place.
    shell.classList.toggle('search-in-skin', searchInSkin);
    shell.classList.toggle('off-select', offSelect);
    // The built-in / LR2 play views take touch input and expose pause / exit for the touch controls.
    shell.classList.toggle('touch-play', touchPlay);
    shell.classList.toggle('play-paused', paused);
    document.documentElement.classList.toggle('portrait-stage', portraitStage);
    // No pinch zoom while playing: a stray two-finger touch on the lanes would otherwise zoom the page.
    document
      .querySelector('meta[name="viewport"]')
      ?.setAttribute(
        'content',
        inGameplay
          ? 'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no'
          : 'width=device-width, initial-scale=1.0, viewport-fit=cover',
      );
  };

  /**
   * Double-click the stage (the Pixi canvas, or the background of a native screen) to toggle the player shell into (and
   * out of) fullscreen.
   * Escape while fullscreen is consumed here so the active scene's Esc handler — quit play,
   * dismiss result, close a select folder — does not fire on the same keypress that leaves
   * fullscreen. Where the browser has Keyboard Lock (Chrome / Edge), Escape is locked while
   * fullscreen instead: a short press reaches the scene as it does windowed and the browser
   * leaves fullscreen on a long press, so nothing is consumed.
   */
  public wireCanvasFullscreen(): void {
    const canvas = this.sceneHost.app.canvas;
    // The stage, not the canvas: the host takes the canvas out while a native screen is showing.
    const stage = this.sceneHost.container;
    const isStageBackground = (target: EventTarget | null): boolean =>
      target === canvas ||
      target === stage ||
      (target instanceof HTMLElement && target.dataset.beMusicScreen !== undefined);
    let lastPointerType = 'mouse';
    let autoFullscreenTried = false;
    stage.addEventListener('pointerdown', (event) => {
      lastPointerType = event.pointerType;
      // A phone gives the stage the whole screen on the first tap: the browser bars eat a large share of a landscape
      // phone's height, and the stage is fitted to that height. The document element goes fullscreen. It contains the
      // shell, where the Debug Menu is mounted, so the menu stays reachable, along with the page's other overlays.
      // Once only, so leaving fullscreen sticks. iPhone Safari has no element fullscreen and simply stays windowed.
      if (this.deviceProfile.phone && event.pointerType === 'touch' && !autoFullscreenTried) {
        autoFullscreenTried = true;
        void enterTouchFullscreen(document.documentElement);
      }
    });
    stage.addEventListener('dblclick', (event) => {
      if (!isStageBackground(event.target)) return;
      event.preventDefault();
      // Double taps are lane presses during play, not a fullscreen toggle.
      if (lastPointerType !== 'mouse' && this.elements.shell.classList.contains('in-gameplay')) return;
      void toggleFullscreen(this.elements.shell);
    });
    // Every way in or out of fullscreen (double-click, the Debug Menu toggle, the phone's first tap, the browser's own
    // exit) fires `fullscreenchange`, so the lock follows it from here.
    const escapeLock = new FullscreenEscapeLock(navigator as KeyboardLockNavigatorLike, (error) =>
      fullscreenLog.debug('Escape key lock refused', error),
    );
    const syncEscapeLock = (): void => void escapeLock.sync(getFullscreenElement() !== null);
    document.addEventListener('fullscreenchange', syncEscapeLock);
    document.addEventListener('webkitfullscreenchange', syncEscapeLock);
    window.addEventListener(
      'keydown',
      (event) => {
        if (!shouldCaptureFullscreenEscape(event, document, escapeLock.isLocked())) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void exitFullscreen();
      },
      true,
    );
  }
}
