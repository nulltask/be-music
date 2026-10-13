import type { BeMusicPlaylog, PlaylogRecorderInfo } from '@be-music/player-web/runtime';
import type { BrowserSongEntry } from '@be-music/player-web/collection';
import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import {
  createLeaderboardPasskey,
  describeAccountChip,
  describeLeaderboardAccount,
  loadLeaderboardAccount,
  signInWithLeaderboardPasskey,
  signOutOfLeaderboard,
  type AccountActionResult,
} from './account.ts';
import {
  describeLeaderboardResult,
  describeSkippedSubmission,
  prepareLeaderboardSubmission,
  submitToLeaderboard,
} from './leaderboard.ts';

/** What the panel needs from the demo: the remembered toggle, the status line and the recorder it names as client. */
export interface LeaderboardPanelHost {
  /** The remembered settings holding the "Submit to Leaderboard" toggle (`guiState`), read on use. */
  settings(): { submitToLeaderboard: boolean };
  setStatus(text: string): void;
  warn(message: string, error: unknown): void;
  recorder: Omit<PlaylogRecorderInfo, 'engine'>;
}

/** The `Be-Music-Client` header a submission carries: `be-music-web/0.5.0 (build abc)`. */
export function describeSubmittingClient(recorder: Omit<PlaylogRecorderInfo, 'engine'>): string {
  return `${recorder.name}/${recorder.version}${recorder.build !== undefined ? ` (build ${recorder.build})` : ''}`;
}

/**
 * Everything the demo shows of the Leaderboard: the Debug Menu folder (submission toggle, account row and passkey
 * buttons), the account chip in the corner, and submitting a finished play. An account starts anonymous (the first
 * submission signs in anonymously); creating a passkey keeps it, and "Sign in with passkey" brings it to another device,
 * moving that device's anonymous plays into it.
 */
export class LeaderboardPanel {
  private folder: GUI | undefined;
  private submitController: Controller | undefined;
  private accountController: Controller | undefined;
  private readonly accountState = { status: 'Not signed in' };
  /** The toggle as it was when the current play started: a play is sent only if it was on at song start. */
  private submitThisPlay = false;

  constructor(private readonly host: LeaderboardPanelHost) {}

  /** Fills the Debug Menu's Leaderboard folder and wires the account chip. */
  buildFolder(folder: GUI): void {
    this.folder = folder;
    // Signed out, the account chip has no page to open: it opens this folder instead.
    document.querySelector<HTMLAnchorElement>('#account-chip')?.addEventListener('click', (event) => {
      if (event.currentTarget instanceof HTMLElement && event.currentTarget.dataset.state !== 'signed-out') return;
      event.preventDefault();
      this.openFolder();
    });
    // Submission — OFF by default. When enabled, a finished manual play is sent to the Leaderboard API (same origin,
    // `/api/*`) as the result scene mounts; the result shows the rank in the status line.
    const settings = this.host.settings();
    this.submitController = folder
      .add(settings, 'submitToLeaderboard')
      .name('Submit to Leaderboard')
      .onChange((value: boolean) => {
        settings.submitToLeaderboard = value;
      });
    this.accountController = folder.add(this.accountState, 'status').name('Account').disable();
    const run = (label: string, action: () => Promise<AccountActionResult>) => async (): Promise<void> => {
      this.host.setStatus(`${label}…`);
      try {
        const result = await action();
        this.host.setStatus(result.ok ? `${label}: done` : `${label} failed: ${result.error}`);
      } catch (error) {
        this.host.setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.refreshAccount();
    };
    folder
      .add({ create: run('Create passkey', createLeaderboardPasskey) }, 'create')
      .name('Create passkey (keep this account)');
    folder
      .add({ signIn: run('Sign in with passkey', signInWithLeaderboardPasskey) }, 'signIn')
      .name('Sign in with passkey');
    folder.add({ signOut: run('Sign out', signOutOfLeaderboard) }, 'signOut').name('Sign out');
    void this.refreshAccount();
  }

  /** Latches the toggle for the play about to start and locks it until {@link unlock}. */
  lockForPlay(): void {
    this.submitThisPlay = this.host.settings().submitToLeaderboard;
    this.submitController?.disable();
  }

  unlock(): void {
    this.submitController?.enable();
  }

  /**
   * Sends the play to the Leaderboard when "Submit to Leaderboard" was on at song start. Runs in the background: the
   * result screen never waits for it, and its outcome (rank, or why it was not sent) goes to the status line.
   */
  maybeSubmit(playlog: BeMusicPlaylog | undefined, song: BrowserSongEntry): void {
    if (!this.submitThisPlay || playlog === undefined) return;
    const prepared = prepareLeaderboardSubmission(playlog, song.chart, song.chartPath);
    if (!prepared.ok) {
      this.host.setStatus(describeSkippedSubmission(prepared.reason));
      return;
    }
    const playedRuleset = playlog.play.judgeRuleset ?? 'lr2';
    void submitToLeaderboard(prepared.submission, { client: describeSubmittingClient(this.host.recorder) })
      .then((result) => {
        this.host.setStatus(describeLeaderboardResult(result, playedRuleset));
        // The first submission signs in anonymously; show the account it created.
        void this.refreshAccount();
      })
      .catch((error: unknown) => {
        this.host.warn('leaderboard submission failed', error);
        this.host.setStatus('Leaderboard: not submitted (network error)');
      });
  }

  /** Re-reads the account into the Debug Menu's "Account" row and the account chip. */
  async refreshAccount(): Promise<void> {
    const account = await loadLeaderboardAccount();
    this.accountState.status = describeLeaderboardAccount(account);
    this.accountController?.updateDisplay();
    const chip = document.querySelector<HTMLAnchorElement>('#account-chip');
    if (chip === null) return;
    const view = describeAccountChip(account);
    chip.dataset.state = view.state;
    chip.title = view.title;
    chip.href = view.href ?? '/leaderboard';
    chip.setAttribute('aria-label', `Leaderboard account: ${view.label}`);
    const label = chip.querySelector('#account-chip-label');
    if (label !== null) label.textContent = view.label;
  }

  /** Opens the Debug Menu with the Leaderboard folder unfolded. */
  private openFolder(): void {
    const folder = this.folder;
    if (folder === undefined) return;
    for (let current: GUI | undefined = folder; current !== undefined; current = current.parent) current.open();
    folder.domElement.scrollIntoView({ block: 'nearest' });
  }
}
