// The header's Install button: Chromium's install prompt where the page has one, Safari's steps otherwise
// (`resolveInstallOffer`). It shows only while the player can be installed here.
import { resolveInstallOffer, type InstallOffer } from './install-offer.ts';
import { bindPlayerHeader, setPlayerHeaderInstallable } from './player-header.ts';

/** Chromium's `beforeinstallprompt` event, which the DOM typings leave out. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** An installed window: its own window, or the title bar folded into the header. Browser fullscreen is not one. */
const INSTALLED_QUERY =
  '(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)';

export function wireInstallButton(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#install-dialog');
  const installed = matchMedia(INSTALLED_QUERY);
  let deferred: BeforeInstallPromptEvent | undefined;
  const offer = (): InstallOffer | undefined =>
    resolveInstallOffer({
      installed: installed.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      hasPrompt: deferred !== undefined,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    });
  const refresh = (): void => {
    const next = offer();
    setPlayerHeaderInstallable(next === 'prompt' || (next !== undefined && dialog !== null));
  };

  addEventListener('beforeinstallprompt', (event) => {
    // Keep the prompt for the button instead of the browser's own mini-infobar.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    refresh();
  });
  addEventListener('appinstalled', () => {
    deferred = undefined;
    refresh();
  });
  installed.addEventListener('change', refresh);

  if (dialog !== null) {
    dialog.querySelector('[data-install-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    // Keys stay in the dialog, so the select screen behind it does not take them.
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
  }

  bindPlayerHeader({
    install: () => {
      const current = offer();
      if (current === 'prompt' && deferred !== undefined) {
        // A prompt shows once; the browser may fire another later, which brings the button back.
        const prompt = deferred;
        deferred = undefined;
        void prompt.prompt().finally(refresh);
        return;
      }
      if ((current === 'ios-safari' || current === 'mac-safari') && dialog !== null) {
        for (const steps of dialog.querySelectorAll<HTMLElement>('[data-install-steps]')) {
          steps.hidden = steps.dataset.installSteps !== current;
        }
        dialog.showModal();
      }
    },
  });
  refresh();
}
