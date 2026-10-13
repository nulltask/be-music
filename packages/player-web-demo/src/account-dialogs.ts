import { signInWithLeaderboardPasskey, signUpForLeaderboard, type AccountActionResult } from './account.ts';

/** Which account dialog to open: sign-in, sign-up, or sign-up for the anonymous account already in this browser. */
export type AccountDialog = 'sign-in' | 'sign-up' | 'keep';

const DIALOG_IDS = { 'sign-in': '#leaderboard-sign-in', 'sign-up': '#leaderboard-sign-up' } as const;

/** What the sign-up dialog says: a new account, or keeping the anonymous one this browser already has. */
const SIGN_UP_COPY = {
  'sign-up': {
    title: 'Create your account',
    lead: 'Pick a handle and a name. Your browser then makes a passkey for it.',
  },
  keep: {
    title: 'Keep this account',
    lead: 'Give your anonymous account a handle and a name. Your browser then makes a passkey, so its plays join the rankings.',
  },
} as const;

/**
 * Wires the Leaderboard sign-in and sign-up dialogs (`#leaderboard-sign-in`, `#leaderboard-sign-up`). `onChanged`
 * runs after a successful sign-in or sign-up, to re-read the account. Returns the function that opens one.
 */
export function wireAccountDialogs(onChanged: () => void): (dialog: AccountDialog) => void {
  const open = (which: AccountDialog): void => {
    closeAll();
    const dialog = document.querySelector<HTMLDialogElement>(DIALOG_IDS[which === 'keep' ? 'sign-up' : which]);
    if (dialog === null) return;
    say(dialog, undefined);
    if (which !== 'sign-in') {
      const copy = SIGN_UP_COPY[which];
      const title = dialog.querySelector('h2');
      const lead = dialog.querySelector('[data-account-sign-up-lead]');
      if (title !== null) title.textContent = copy.title;
      if (lead !== null) lead.textContent = copy.lead;
    }
    dialog.showModal();
  };

  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-account-dialog-action]');
    if (button === null || button === undefined) return;
    const action = button.dataset.accountDialogAction;
    if (action === 'close') closeAll();
    else if (action === 'open-sign-up') open('sign-up');
    else if (action === 'sign-in') {
      const dialog = button.closest('dialog');
      void run(button, dialog, signInWithLeaderboardPasskey, 'Sign-in failed', onChanged);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-account-sign-up-form]')) return;
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
      'Sign-up failed',
      onChanged,
    );
  });

  return open;
}

/** Runs an account step from a dialog: the button waits, a failure is said in the dialog, success closes it. */
async function run(
  button: HTMLButtonElement | null,
  dialog: HTMLDialogElement | null,
  action: () => Promise<AccountActionResult>,
  failure: string,
  onChanged: () => void,
): Promise<void> {
  if (button !== null) button.disabled = true;
  say(dialog, undefined);
  try {
    const result = await action();
    if (result.ok) {
      dialog?.close();
      onChanged();
    } else {
      say(dialog, result.error.startsWith('Your account is ready') ? result.error : `${failure}: ${result.error}`);
      // A half-made account (saved, no passkey yet) is still an account: show it.
      onChanged();
    }
  } catch (error) {
    say(dialog, `${failure}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (button !== null) button.disabled = false;
  }
}

function say(dialog: HTMLDialogElement | null, message: string | undefined): void {
  const status = dialog?.querySelector<HTMLElement>('[data-account-dialog-status]');
  if (status === null || status === undefined) return;
  status.textContent = message ?? '';
  status.hidden = message === undefined;
}

function closeAll(): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog.account-dialog[open]')) dialog.close();
}
