// Whether the header offers to install the player, and how: Chromium hands the page an install prompt
// (`beforeinstallprompt`), while Safari has no prompt, so the button explains where Safari keeps its own command.

/** How the player can be installed here: Chromium's prompt, or Safari's Share or File menu. */
export type InstallOffer = 'prompt' | 'ios-safari' | 'mac-safari';

export interface InstallOfferInput {
  /** The page already runs installed (`display-mode: standalone` or the like, or iOS's `navigator.standalone`). */
  readonly installed: boolean;
  /** Chromium fired `beforeinstallprompt` and the page kept it. */
  readonly hasPrompt: boolean;
  readonly userAgent: string;
  /** `navigator.maxTouchPoints`: an iPad asks for the desktop site and says it is a Mac. */
  readonly maxTouchPoints: number;
}

/** The install the header offers, or `undefined` when there is none to offer (installed, or no way to install). */
export function resolveInstallOffer(input: InstallOfferInput): InstallOffer | undefined {
  if (input.installed) return undefined;
  if (input.hasPrompt) return 'prompt';
  const ua = input.userAgent;
  // Safari only: Chrome, Edge and Firefox on iOS name themselves (CriOS / EdgiOS / FxiOS) and cannot add to the Home
  // Screen from their own menu in the same way, and Chromium on a Mac fires the prompt instead.
  const safari = /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|EdgiOS|FxiOS|Edg|OPR|Android)\//.test(ua);
  if (!safari) return undefined;
  const iOS = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && input.maxTouchPoints > 1);
  if (iOS) return 'ios-safari';
  // Safari 17 on macOS Sonoma adds a web app to the Dock.
  const version = /Version\/(\d+)/.exec(ua);
  if (/\bMacintosh\b/.test(ua) && version !== null && Number(version[1]) >= 17) return 'mac-safari';
  return undefined;
}
