// "Play in silent mode": the platform audio session asks for `'playback'`, so sound plays with the iPhone / iPad silent
// switch on (`silent-mode-playback.ts`). The setting is kept in the Debug Menu's state and remembered, shows on the
// Debug Menu and the start card where the browser offers it, and a hint points at it the first time sound can start.

import { applySilentModePlayback, supportsSystemAudioSession } from '@be-music/player-browser/audio';
import {
  SILENT_MODE_STRINGS,
  installSilentModePlayback,
  mountSilentModeHint,
  readSilentModeHintSeen,
  resolveSilentModeLanguage,
  shouldShowSilentModeHint,
  storePlayInSilentMode,
  storeSilentModeHintSeen,
  type StartSilentModeOption,
} from '../silent-mode-playback.ts';

export interface SilentModeSettingOptions {
  /** The state the setting is kept in: the Debug Menu's, whose checkbox writes it. */
  readonly settings: { playInSilentMode: boolean };
  /** Whether the device is a phone or a tablet, where the hint shows. */
  readonly touchFirst: boolean;
}

/** The "Play in silent mode" setting, and the places it shows. */
export class SilentModeSetting {
  /** The Debug Menu's "Play in silent mode" checkbox, when the browser offers the setting. */
  public controller: { updateDisplay(): unknown } | undefined;
  /** The start card's "Play in silent mode" checkbox, when the browser offers the setting. */
  public startOption: Pick<StartSilentModeOption, 'setChecked'> | undefined;
  private readonly settings: { playInSilentMode: boolean };
  private readonly touchFirst: boolean;

  public constructor(options: SilentModeSettingOptions) {
    this.settings = options.settings;
    this.touchFirst = options.touchFirst;
  }

  /**
   * Sets the platform audio session before any scene creates an AudioContext, and again on the first gesture (which is
   * when the scenes resume their contexts) — see `silent-mode-playback.ts`.
   */
  public install(): void {
    installSilentModePlayback({
      enabled: () => this.settings.playInSilentMode,
      target: window,
      visibility: document,
      onFirstGesture: () => this.maybeShowHint(),
    });
  }

  /** Applies and remembers the "Play in silent mode" setting (Debug Menu checkbox or the hint's button). */
  public set(value: boolean): void {
    this.settings.playInSilentMode = value;
    storePlayInSilentMode(value);
    applySilentModePlayback(value);
    this.controller?.updateDisplay();
    this.startOption?.setChecked(value);
    // Once the user has found the setting, the hint has nothing left to say.
    storeSilentModeHintSeen();
  }

  /**
   * The first time sound can start on an iPhone / iPad, point at the setting: the silent switch mutes web audio there
   * and nothing on screen says why. Shown once per browser, only while the setting is off.
   */
  public maybeShowHint(): void {
    const show = shouldShowSilentModeHint({
      supported: supportsSystemAudioSession(),
      enabled: this.settings.playInSilentMode,
      seen: readSilentModeHintSeen(),
      touchFirst: this.touchFirst,
    });
    if (!show) return;
    storeSilentModeHintSeen();
    mountSilentModeHint({
      strings: SILENT_MODE_STRINGS[resolveSilentModeLanguage(navigator.language)],
      onEnable: () => this.set(true),
    });
  }
}
