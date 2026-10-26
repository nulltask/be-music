// What kind of device the player runs on, as far as the page can tell: a touch-first phone or tablet, or a desktop. The
// player uses it to pick lighter skin effects by default and to offer touch controls during play.

export type SkinEffectsLevel = 'full' | 'reduced' | 'off';

/** The media-query and screen readings {@link resolveDeviceProfile} decides from. */
export interface DeviceSignals {
  /** `(pointer: coarse)` — the primary pointer is a finger. */
  readonly coarsePointer: boolean;
  /** `(any-pointer: coarse)` — some pointer is a finger (a touch laptop has one, next to its fine trackpad). */
  readonly anyCoarsePointer: boolean;
  /** `(prefers-reduced-motion: reduce)`. */
  readonly prefersReducedMotion: boolean;
  /** The device screen in CSS pixels (`screen.width` / `screen.height`), not the window — resizing a window changes nothing. */
  readonly screenWidth: number;
  readonly screenHeight: number;
}

export interface DeviceProfile {
  /** A phone or tablet: the primary pointer is a finger, or some pointer is and the screen is phone-sized. */
  readonly touchFirst: boolean;
  /** A phone-sized screen (short side at most {@link PHONE_SHORT_SIDE_MAX} CSS pixels). */
  readonly phone: boolean;
}

/** Short side, in CSS pixels, up to which a screen counts as a phone's (phones sit at 360–430, tablets from 744). */
export const PHONE_SHORT_SIDE_MAX = 500;

export function resolveDeviceProfile(signals: DeviceSignals): DeviceProfile {
  const shortSide = Math.min(signals.screenWidth, signals.screenHeight);
  const phoneSized = shortSide > 0 && shortSide <= PHONE_SHORT_SIDE_MAX;
  const touchFirst = signals.coarsePointer || (signals.anyCoarsePointer && phoneSized);
  return { touchFirst, phone: touchFirst && phoneSized };
}

/**
 * The skin effect level a session starts with: the level the user picked before (`stored`, when it is a valid level)
 * always wins; otherwise `'reduced'` when the OS asks for reduced motion or the device is a phone / tablet — the heavy
 * particle effects cost frames on mobile GPUs — and `'full'` on a desktop.
 */
export function resolveDefaultSkinEffects(stored: string | null | undefined, signals: DeviceSignals): SkinEffectsLevel {
  if (stored === 'full' || stored === 'reduced' || stored === 'off') return stored;
  if (signals.prefersReducedMotion || resolveDeviceProfile(signals).touchFirst) return 'reduced';
  return 'full';
}

/** The Debug Menu's play-layout pick: follow the device, or force the desktop (standard) or touch layout. */
export type PlayLayoutChoice = 'auto' | 'standard' | 'touch';

/** The gameplay layout to ask the play scene for: an explicit pick wins, `'auto'` is touch on phones and tablets. */
export function resolvePlayLayoutMode(choice: PlayLayoutChoice, profile: DeviceProfile): 'standard' | 'touch' {
  if (choice !== 'auto') return choice;
  return profile.touchFirst ? 'touch' : 'standard';
}

/** Reads {@link DeviceSignals} from the browser; missing APIs read as a desktop. */
export function readDeviceSignals(win: Window = window): DeviceSignals {
  const matches = (query: string): boolean => {
    try {
      return win.matchMedia?.(query).matches ?? false;
    } catch {
      return false;
    }
  };
  return {
    coarsePointer: matches('(pointer: coarse)'),
    anyCoarsePointer: matches('(any-pointer: coarse)'),
    prefersReducedMotion: matches('(prefers-reduced-motion: reduce)'),
    screenWidth: win.screen?.width ?? 0,
    screenHeight: win.screen?.height ?? 0,
  };
}
