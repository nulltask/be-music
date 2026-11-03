import { authPanelTemplate } from '@be-music/service-web-theme/client';
import { localized } from './ui/localized.ts';
import { render } from 'lit';
import type { BeMusicStatusElement } from '@be-music/service-web-theme/client';
import {
  accountProviderFromAction,
  signInWithAccountProvider,
  signInWithLeaderboardPasskey,
  signUpForLeaderboard,
  type AccountActionResult,
} from './account.ts';
import { playerLang, playerText } from './player-copy.ts';

/** Which account dialog to open: sign-in, sign-up, or sign-up for the anonymous account already in this browser. */
export type AccountDialog = 'sign-in' | 'sign-up' | 'keep';

const DIALOG_IDS = { 'sign-in': '#leaderboard-sign-in', 'sign-up': '#leaderboard-sign-up' } as const;

/** What the dialogs report back: any change to the account, and a sign-in or sign-up that went through. */
export interface AccountDialogHandlers {
  /** The account may have changed (also after a sign-up that stopped half-way): re-read it. */
  onChanged(): void;
  /** The player is signed in to a kept account now. */
  onSignedIn(): void;
}

/**
 * Wires the Leaderboard sign-in and sign-up dialogs (`#leaderboard-sign-in`, `#leaderboard-sign-up`). Returns the
 * function that opens one.
 */
export function wireAccountDialogs(handlers: AccountDialogHandlers): (dialog: AccountDialog) => void {
  let signUpMode: 'sign-up' | 'keep' = 'sign-up';
  const draw = (kind: 'sign-in' | 'sign-up'): void => {
    const dialog = document.querySelector<HTMLDialogElement>(DIALOG_IDS[kind]);
    if (dialog !== null)
      render(
        localized(() =>
          authPanelTemplate({ id: dialog.id, locale: playerLang(), mode: kind === 'sign-in' ? kind : signUpMode }),
        ),
        dialog,
      );
  };
  draw('sign-in');
  draw('sign-up');
  const open = (which: AccountDialog): void => {
    closeAll();
    const kind = which === 'keep' ? 'sign-up' : which;
    const dialog = document.querySelector<HTMLDialogElement>(DIALOG_IDS[kind]);
    if (dialog === null) return;
    if (which !== 'sign-in') {
      signUpMode = which;
      draw('sign-up');
    }
    say(dialog, undefined);
    dialog.showModal();
  };

  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-auth-action]');
    if (button === null || button === undefined) return;
    const action = button.dataset.authAction;
    if (action === 'close') closeAll();
    else if (action === 'open-sign-up') open('sign-up');
    else if (action === 'sign-in') {
      const dialog = button.closest('dialog');
      void run(button, dialog, signInWithLeaderboardPasskey, () => playerText().account.signInFailed, handlers);
    } else {
      const provider = accountProviderFromAction(action);
      if (provider !== undefined) {
        const dialog = button.closest('dialog');
        void run(
          button,
          dialog,
          () => signInWithAccountProvider(provider),
          () => playerText().account.signInFailed,
          handlers,
        );
      }
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-auth-sign-up-form]')) return;
    event.preventDefault();
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    void run(
      submit,
      form.closest('dialog'),
      () => signUpForLeaderboard({ handle: text('handle'), displayName: text('displayName') }),
      () => playerText().account.signUpFailed,
      handlers,
    );
  });

  return open;
}

/** Runs an account step from a dialog: the button waits, a failure is said in the dialog, success closes it. */
async function run(
  button: HTMLButtonElement | null,
  dialog: HTMLDialogElement | null,
  action: () => Promise<AccountActionResult>,
  failure: () => string,
  handlers: AccountDialogHandlers,
): Promise<void> {
  if (button !== null) button.disabled = true;
  say(dialog, undefined);
  try {
    const result = await action();
    if (result.ok) {
      dialog?.close();
      handlers.onSignedIn();
      handlers.onChanged();
    } else {
      const ready =
        result.error.startsWith(playerText().account.accountReadyPrefix) ||
        result.error.startsWith('Your account is ready');
      say(dialog, ready ? result.error : `${failure()}: ${result.error}`);
      // A half-made account (saved, no passkey yet) is still an account: show it.
      handlers.onChanged();
    }
  } catch (error) {
    say(dialog, `${failure()}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (button !== null) button.disabled = false;
  }
}

function say(dialog: HTMLDialogElement | null, message: string | undefined): void {
  const status = dialog?.querySelector<BeMusicStatusElement>('[data-auth-status]');
  if (status === null || status === undefined) return;
  status.message = message ?? '';
  status.hidden = message === undefined;
}

function closeAll(): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog.account-dialog[open]')) dialog.close();
}
