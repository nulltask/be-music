import { setDisabled, type PaneBinding } from './pane-controls.ts';
import type { BeMusicReplay, ReplayRecorderInfo } from '@be-music/player-engine/replay';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { FolderApi } from 'tweakpane';

import {
  createLeaderboardPasskey,
  describeAccountChip,
  describeLeaderboardAccount,
  describeStartAccount,
  shouldTurnOnSubmitting,
  loadLeaderboardAccount,
  signInWithLeaderboardPasskey,
  signOutOfLeaderboard,
  START_ACCOUNT_ACTION_LABELS,
  type AccountActionResult,
} from './account.ts';
import { wireAccountDialogs } from './account-dialogs.ts';
import { leaderboardLink } from './service-links.ts';
import type { BeMusicCourseReplay } from '@be-music/player-engine/replay';
import {
  describeCourseLeaderboardResult,
  describeLeaderboardResult,
  describeSkippedCourseSubmission,
  describeSkippedSubmission,
  prepareCourseLeaderboardSubmission,
  prepareLeaderboardSubmission,
  submitCourseToLeaderboard,
  submitToLeaderboard,
} from './leaderboard.ts';
/** What the panel needs from the player: the remembered toggle, the status line and the recorder it names as client. */
export interface LeaderboardPanelHost {
  /** The remembered settings holding the "Submit to Leaderboard" toggle (`guiState`), read on use. */
  settings(): {
    submitToLeaderboard: boolean;
  };
  setStatus(text: string): void;
  warn(message: string, error: unknown): void;
  recorder: Omit<ReplayRecorderInfo, 'engine'>;
}
/** The `Be-Music-Client` header a submission carries: `be-music-web/0.5.0 (build abc)`. */
export function describeSubmittingClient(recorder: Omit<ReplayRecorderInfo, 'engine'>): string {
  return `${recorder.name}/${recorder.version}${recorder.build !== undefined ? ` (build ${recorder.build})` : ''}`;
}
/**
 * Everything the player shows of the Leaderboard: the start card's row (submission checkbox, account and its sign-in /
 * sign-up buttons), the Debug Menu folder (the same toggle, account row and passkey buttons), the account chip in the
 * corner, and submitting a finished play. An account starts anonymous (the first
 * submission signs in anonymously); creating a passkey keeps it, and "Sign in with passkey" brings it to another device,
 * moving that device's anonymous plays into it.
 */
export class LeaderboardPanel {
  private folder: FolderApi | undefined;
  private openPane: () => void = () => undefined;
  private submitController: PaneBinding | undefined;
  private accountController: PaneBinding | undefined;
  private readonly accountState = { status: 'Not signed in' };
  /** Opens the sign-in / sign-up dialogs the start card's buttons lead to. */
  private readonly openDialog = wireAccountDialogs({
    onChanged: () => void this.refreshAccount(),
    // Signing in is choosing to take part: plays from now on are submitted.
    onSignedIn: () => this.setSubmitting(true),
  });
  /** The account state last shown, so signing in (or arriving signed in) can be told from a refresh. */
  private shownState: 'signed-in' | 'anonymous' | 'signed-out' | undefined;
  /** The toggle as it was when the current play started: a play is sent only if it was on at song start. */
  private submitThisPlay = false;
  private readonly host: LeaderboardPanelHost;
  constructor(host: LeaderboardPanelHost) {
    this.host = host;
  }
  /** Fills the Debug Menu's Leaderboard folder and wires the account chip. */
  buildFolder(folder: FolderApi, openPane: () => void = () => undefined): void {
    this.folder = folder;
    this.openPane = openPane;
    // Signed out, the account chip has no page to open: it opens this folder instead.
    document.querySelector<HTMLAnchorElement>('#account-chip')?.addEventListener('click', (event) => {
      if (event.currentTarget instanceof HTMLElement && event.currentTarget.dataset.state !== 'signed-out') return;
      event.preventDefault();
      this.openFolder();
    });
    // Submission — OFF by default. When enabled, a finished manual play is sent to the Leaderboard API (same origin,
    // `/api/*`) as the result scene mounts; the result shows the rank in the status line.
    const settings = this.host.settings();
    const startCheckbox = document.querySelector<HTMLInputElement>('#start-submit');
    this.submitController = folder
      .addBinding(settings, 'submitToLeaderboard', { label: 'Submit to Leaderboard' })
      .on('change', ({ value }) => {
        settings.submitToLeaderboard = value;
        if (startCheckbox !== null) startCheckbox.checked = value;
      });
    // The start card's checkbox is the same setting: it goes through the controller, so it is remembered like any
    // Debug Menu change.
    if (startCheckbox !== null) {
      startCheckbox.checked = settings.submitToLeaderboard;
      startCheckbox.addEventListener('change', () => this.setSubmitting(startCheckbox.checked));
    }
    this.accountController = folder.addBinding(this.accountState, 'status', {
      label: 'Account',
      readonly: true,
      multiline: true,
      rows: 2,
    });
    const run = (label: string, action: () => Promise<AccountActionResult>, onSuccess?: () => void) => () =>
      this.runAccountAction(label, action, onSuccess);
    // Signing in, or keeping the account with a passkey, is choosing to take part: plays from now on are submitted.
    const takePart = () => this.setSubmitting(true);
    folder
      .addButton({ title: 'Create passkey (keep this account)' })
      .on('click', run('Create passkey', createLeaderboardPasskey, takePart));
    folder
      .addButton({ title: 'Sign in with passkey' })
      .on('click', run('Sign in with passkey', signInWithLeaderboardPasskey, takePart));
    folder.addButton({ title: 'Sign out' }).on('click', run('Sign out', signOutOfLeaderboard));
    void this.refreshAccount();
  }
  /** Runs an account action, reporting it in the status line and under the start card's account row. */
  private async runAccountAction(
    label: string,
    action: () => Promise<AccountActionResult>,
    onSuccess?: () => void,
  ): Promise<void> {
    const status = document.querySelector<HTMLElement>('#start-account-status');
    const say = (text: string) => {
      this.host.setStatus(text);
      if (status !== null) status.textContent = text;
    };
    say(`${label}…`);
    try {
      const result = await action();
      say(result.ok ? '' : `${label} failed: ${result.error}`);
      if (result.ok) {
        this.host.setStatus(`${label}: done`);
        onSuccess?.();
      }
    } catch (error) {
      say(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.refreshAccount();
  }
  /** Latches the toggle for the play about to start and locks it until {@link unlock}. */
  lockForPlay(): void {
    this.submitThisPlay = this.host.settings().submitToLeaderboard;
    setDisabled(this.submitController, true);
  }
  unlock(): void {
    setDisabled(this.submitController, false);
  }
  /**
   * Sends the play to the Leaderboard when "Submit to Leaderboard" was on at song start. Runs in the background: the
   * result screen never waits for it, and its outcome (rank, or why it was not sent) goes to the status line.
   */
  maybeSubmit(replay: BeMusicReplay | undefined, chartEntry: LibraryChart): void {
    if (!this.submitThisPlay || replay === undefined) return;
    const prepared = prepareLeaderboardSubmission(replay, chartEntry.chart, chartEntry.chartPath);
    if (!prepared.ok) {
      this.host.setStatus(describeSkippedSubmission(prepared.reason));
      return;
    }
    const playedRuleset = replay.play.judgeRuleset ?? 'lr2';
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
  /**
   * Sends a finished course run to the Leaderboard when "Submit to Leaderboard" was on when its last stage started, as
   * {@link maybeSubmit} does for one play. `stageSongs` are the course's stages as it played them, in order (their
   * charts rebuild each played stage's fingerprint documents, and go to the server for the stages it rebuilds: the
   * unreached ones, and all of a NONSTOP run). The course rank goes to the status line.
   */
  maybeSubmitCourse(courseReplay: BeMusicCourseReplay, stageSongs: readonly LibraryChart[]): void {
    if (!this.submitThisPlay) return;
    const prepared = prepareCourseLeaderboardSubmission(
      courseReplay,
      stageSongs.map((chartEntry) => ({ chart: chartEntry.chart, chartPath: chartEntry.chartPath })),
    );
    if (!prepared.ok) {
      this.host.setStatus(describeSkippedCourseSubmission(prepared.reason));
      return;
    }
    const firstStage = courseReplay.stages[0];
    // Every stage of a ranked run is judged under one ruleset (the server refuses mixed ones); a NONSTOP run was one play.
    const judged = courseReplay.nonstop?.replay ?? (firstStage?.played === true ? firstStage.replay : undefined);
    const playedRuleset = judged?.play.judgeRuleset ?? 'lr2';
    void submitCourseToLeaderboard(prepared.submission, { client: describeSubmittingClient(this.host.recorder) })
      .then((result) => {
        this.host.setStatus(describeCourseLeaderboardResult(result, playedRuleset));
        void this.refreshAccount();
      })
      .catch((error: unknown) => {
        this.host.warn('leaderboard course submission failed', error);
        this.host.setStatus('Leaderboard: course not submitted (network error)');
      });
  }
  /** Re-reads the account into the Debug Menu's "Account" row and the account chip. */
  async refreshAccount(): Promise<void> {
    const account = await loadLeaderboardAccount();
    const state = describeAccountChip(account).state;
    // A player who is signed in takes part: submitting turns on when they arrive signed in or sign in, not on every
    // refresh, so unticking it during a session sticks.
    if (shouldTurnOnSubmitting(this.shownState, state)) this.setSubmitting(true);
    this.shownState = state;
    this.accountState.status = describeLeaderboardAccount(account);
    this.accountController?.refresh();
    this.renderStartAccount(account);
    const chip = document.querySelector<HTMLAnchorElement>('#account-chip');
    if (chip === null) return;
    const view = describeAccountChip(account);
    chip.dataset.state = view.state;
    chip.title = view.title;
    chip.href = leaderboardLink(view.href ?? '/', location.hostname);
    chip.setAttribute('aria-label', `Leaderboard account: ${view.label}`);
    const label = chip.querySelector('#account-chip-label');
    if (label !== null) label.textContent = view.label;
  }
  /** Fills the start card's account row: who the plays go to, a link to their page, and the actions that fit. */
  private renderStartAccount(account: Awaited<ReturnType<typeof loadLeaderboardAccount>>): void {
    const row = document.querySelector<HTMLElement>('#start-account');
    const label = document.querySelector<HTMLElement>('#start-account-label');
    const actions = document.querySelector<HTMLElement>('#start-account-actions');
    if (row === null || label === null || actions === null) return;
    const view = describeStartAccount(account);
    row.dataset.state = view.state;
    const hint = document.querySelector<HTMLElement>('#start-account-hint');
    if (hint !== null) hint.textContent = view.hint ?? '';
    if (view.href !== undefined) {
      const link = document.createElement('a');
      link.href = leaderboardLink(view.href, location.hostname);
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = 'Your Leaderboard page (opens in a new tab)';
      link.textContent = view.label;
      label.replaceChildren(link);
    } else {
      label.textContent = view.label;
    }
    actions.replaceChildren(
      ...view.actions.map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        // Making an account is the step the card leads to; the other actions stay quiet.
        button.className = 'btn';
        button.dataset.size = 'sm';
        if (action !== 'sign-up' && action !== 'keep') button.dataset.variant = 'outline';
        button.textContent = START_ACCOUNT_ACTION_LABELS[action];
        button.addEventListener('click', () => {
          // Signing out needs nothing more; the rest open the dialogs the Leaderboard's own pages use.
          if (action === 'sign-out') void this.runAccountAction('Sign out', signOutOfLeaderboard);
          else if (action === 'keep') void this.runAccountAction('Manage account', createLeaderboardPasskey);
          else void this.runAccountAction('Sign in', signInWithLeaderboardPasskey);
        });
        return button;
      }),
    );
  }
  private setSubmitting(value: boolean): void {
    this.host.settings().submitToLeaderboard = value;
    const checkbox = document.querySelector<HTMLInputElement>('#start-submit');
    if (checkbox) checkbox.checked = value;
    this.submitController?.refresh();
  }
  /** Opens the Debug Menu with the Leaderboard folder unfolded. */
  private openFolder(): void {
    const folder = this.folder;
    if (folder === undefined) return;
    folder.expanded = true;
    this.openPane();
    folder.element.scrollIntoView({ block: 'nearest' });
  }
}
