import {
  accountIdentityTemplate,
  authButtonTemplate,
  skeletonGroupTemplate,
  skeletonTemplate,
  type BeMusicStatusElement,
} from '@be-music/service-web-theme/client';
import { html, nothing, render, type TemplateResult } from 'lit';
import { paneOptions, selectBinding, setDisabled, type PaneBinding } from './pane-controls.ts';
import { optionLabel } from './ui/options/labels.ts';
import type { BeMusicReplay, ReplayRecorderInfo } from '@be-music/player-engine/replay';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { OptionContainer } from './ui/options-controls.ts';

import {
  keepLeaderboardAccount,
  describeAccountChip,
  readLeaderboardAccount,
  readStartAccountState,
  rememberStartAccountState,
  startAccountPlaceholder,
  type AccountChip,
  describeLeaderboardAccountForm,
  describeStartAccount,
  shouldTurnOnSubmitting,
  loadLeaderboardAccount,
  signOutOfLeaderboard,
  startAccountActionLabels,
  type AccountActionResult,
} from './account.ts';
import { onPlayerLangChange, playerLang, playerText } from './player-copy.ts';
import { setPlayerHeaderAccount } from './player-header.ts';
import { wireAccountDialogs } from './account-dialogs.ts';
import { defaultStorage } from './player-storage.ts';
import { leaderboardAvatarURL, leaderboardLink } from './service-links.ts';
import type { BeMusicCourseReplay } from '@be-music/player-engine/replay';
import { resolveReplayRecordPolicy } from '@be-music/player-engine/records';
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
import { shouldSubmitPlay, type LeaderboardSubmitRule } from './leaderboard-submit-rule.ts';
/** The "Submit when" choices, by their English text (`OPTION_LABELS_JA` has their Japanese). */
const SUBMIT_RULE_CHOICES: Record<string, LeaderboardSubmitRule> = {
  'EX-SCORE improves (first play always)': 'improved',
  Always: 'always',
};
/** What the panel needs from the player: the remembered toggle, the status line and the recorder it names as client. */
export interface LeaderboardPanelHost {
  /** The remembered settings holding the "Submit to Leaderboard" toggle (`guiState`), read on use. */
  settings(): {
    submitToLeaderboard: boolean;
    leaderboardSubmitRule: LeaderboardSubmitRule;
  };
  /**
   * The player's own best EX-SCORE on `chartEntry` under the judge ruleset in force, from the local best records
   * (`be-music.chart-best-records`); `undefined` before its first recorded play. Read as a play starts, before its result
   * updates the record.
   */
  bestEXScore(chartEntry: LibraryChart): number | undefined;
  setStatus(text: string): void;
  warn(message: string, error: unknown): void;
  recorder: Omit<ReplayRecorderInfo, 'engine'>;
}
/** The `Be-Music-Client` header a submission carries: `be-music-web/0.5.0 (build abc)`. */
export function describeSubmittingClient(recorder: Omit<ReplayRecorderInfo, 'engine'>): string {
  return `${recorder.name}/${recorder.version}${recorder.build !== undefined ? ` (build ${recorder.build})` : ''}`;
}
/**
 * The start card's account note, hint and actions while the account is read, shaped like the card the player saw last
 * time ({@link startAccountPlaceholder}): a line where the account will be named, then the hint and each action button
 * with their own text, shimmering and unreadable, so the card keeps its size when the account arrives.
 */
export function startAccountLoadingTemplates(state: AccountChip['state'] = readStartAccountState(defaultStorage())): {
  label: TemplateResult;
  hint: TemplateResult;
  actions: TemplateResult;
} {
  const placeholder = startAccountPlaceholder(state);
  const labels = startAccountActionLabels();
  return {
    label: skeletonGroupTemplate({
      locale: playerLang(),
      label: playerText().shell.checkingAccount,
      content: skeletonTemplate({ shape: 'line', width: '18ch' }),
    }),
    hint:
      placeholder.hint === undefined
        ? html``
        : html`<span class="be-music-skeleton-fill" aria-hidden="true">${placeholder.hint}</span>`,
    actions: html`${placeholder.actions.map(
      (action) =>
        html`<span class="btn be-music-skeleton-fill" data-size="sm" aria-hidden="true">${labels[action]}</span>`,
    )}`,
  };
}

/** Puts {@link startAccountLoadingTemplates} into the start card, until the account has been read. */
export function renderStartAccountLoading(root: ParentNode = document): void {
  const label = root.querySelector<HTMLElement>('#start-account-label');
  const hint = root.querySelector<HTMLElement>('#start-account-hint');
  const actions = root.querySelector<HTMLElement>('#start-account-actions');
  const view = startAccountLoadingTemplates();
  if (label !== null) render(view.label, label);
  if (hint !== null) render(view.hint, hint);
  if (actions !== null) render(view.actions, actions);
}

/**
 * Everything the player shows of the Leaderboard: the start card's row (submission checkbox, account and its sign-in /
 * sign-up buttons), the Options dialog folder (the same toggle, account row and account buttons), the shared header's
 * account control, and submitting a finished play. Submitting needs an account; a guest one is enough. Keeping a guest
 * account with a passkey, Google or Discord makes it a regular one, and signing in to another account moves the guest's
 * plays into it.
 */
export class LeaderboardPanel {
  private submitController: PaneBinding | undefined;
  private submitRuleController: PaneBinding | undefined;
  /** The Options dialog's account form, rendered again whenever the account or the language changes. */
  private accountForm: HTMLElement | undefined;
  /** Opens the sign-in / sign-up dialogs the start card's buttons lead to. */
  private readonly openDialog = wireAccountDialogs({
    onChanged: () => void this.refreshAccount(),
    // Signing in is choosing to take part: plays from now on are submitted.
    onSignedIn: () => this.setSubmitting(true),
  });
  /** The account state last shown, so signing in (or arriving signed in) can be told from a refresh. */
  private shownState: 'signed-in' | 'anonymous' | 'signed-out' | undefined;
  /** The account last painted, so a Help language switch can paint it again. */
  private shownAccount: Awaited<ReturnType<typeof loadLeaderboardAccount>> | undefined;
  private accountReady = false;
  private signedInName: string | undefined;
  /** The name of a kept (non-guest) account, which a play shows; `undefined` signed out or as a guest. */
  get playerName(): string | undefined {
    return this.signedInName;
  }
  /** The toggle as it was when the current play started: a play is sent only if it was on at song start. */
  private submitThisPlay = false;
  /** The "Submit when" rule as it was when the current play started. */
  private submitRuleThisPlay: LeaderboardSubmitRule = 'improved';
  /** The player's best EX-SCORE on the current play's chart as it started, before its result updates the record. */
  private previousBestEXScore: number | undefined;
  private readonly host: LeaderboardPanelHost;
  constructor(host: LeaderboardPanelHost) {
    this.host = host;
    renderStartAccountLoading();
    onPlayerLangChange(() => {
      if (!this.accountReady) {
        renderStartAccountLoading();
        return;
      }
      this.renderAccountForm();
      this.renderStartAccount(this.shownAccount);
    });
  }
  /** Fills the Options dialog's Leaderboard folder, placing each row by its id in `options-layout.json`. */
  buildFolder(place: (id: string) => Pick<OptionContainer, 'addElement' | 'addBinding'>): void {
    // The account first, as a sign-in form: who plays are sent as, and how to sign in, keep the account or sign out.
    this.accountForm = document.createElement('div');
    this.accountForm.className = 'leaderboard-account-form';
    place('leaderboardAccount').addElement(this.accountForm);
    this.renderAccountForm();
    // Submission — OFF by default. When enabled, a finished manual play is sent to the Leaderboard API (same origin,
    // `/api/*`) as the result scene mounts; the result shows the rank in the status line.
    const settings = this.host.settings();
    const startCheckbox = document.querySelector<HTMLInputElement>('#start-submit');
    this.submitController = place('submitToLeaderboard')
      .addBinding(settings, 'submitToLeaderboard', { label: 'Submit to Leaderboard' })
      .on('change', ({ value }) => {
        settings.submitToLeaderboard = value;
        if (startCheckbox !== null) startCheckbox.checked = value;
      });
    // The start card's checkbox is the same setting: it goes through the controller, so it is remembered like any
    // Options dialog change.
    // When a play is sent: only when it beats the player's best EX-SCORE on the chart (its first play always), or always.
    const submitRule = selectBinding(
      place('leaderboardSubmitRule'),
      settings,
      'leaderboardSubmitRule',
      'Submit when',
      SUBMIT_RULE_CHOICES,
    );
    submitRule.on('change', ({ value }) => {
      settings.leaderboardSubmitRule = value;
    });
    // The dialog relabels its controls, not a select's choices: these follow the player's language here.
    const relabelChoices = () => {
      submitRule.options = paneOptions(SUBMIT_RULE_CHOICES).map((choice) => ({
        ...choice,
        text: optionLabel(choice.text, playerLang()),
      }));
    };
    relabelChoices();
    onPlayerLangChange(relabelChoices);
    this.submitRuleController = submitRule;
    if (startCheckbox !== null) {
      startCheckbox.checked = settings.submitToLeaderboard;
      startCheckbox.addEventListener('change', () => this.setSubmitting(startCheckbox.checked));
    }
    void this.refreshAccount();
  }
  /** Runs an account action, reporting it in the status line and under the start card's account row. */
  private async runAccountAction(
    label: string,
    action: () => Promise<AccountActionResult>,
    onSuccess?: () => void,
  ): Promise<void> {
    const status = document.querySelector<BeMusicStatusElement>('#start-account-status');
    const say = (text: string) => {
      this.host.setStatus(text);
      if (status !== null) status.message = text;
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
  /**
   * Latches the toggle and the "Submit when" rule for the play about to start, with the player's best EX-SCORE on its
   * chart (`chartEntry`, absent for a course stage or a replay), and locks both until {@link unlock}.
   */
  lockForPlay(chartEntry?: LibraryChart): void {
    const settings = this.host.settings();
    this.submitThisPlay = settings.submitToLeaderboard;
    this.submitRuleThisPlay = settings.leaderboardSubmitRule;
    this.previousBestEXScore = chartEntry !== undefined ? this.host.bestEXScore(chartEntry) : undefined;
    setDisabled(this.submitController, true);
    setDisabled(this.submitRuleController, true);
  }
  unlock(): void {
    setDisabled(this.submitController, false);
    setDisabled(this.submitRuleController, false);
  }
  /**
   * Sends the play to the Leaderboard when "Submit to Leaderboard" was on at song start and the "Submit when" rule
   * latched with it lets the play through (`shouldSubmitPlay`, against `exScore`, the play's own EX-SCORE). Runs in the
   * background: the result screen never waits for it, and its outcome (rank, or why it was not sent) goes to the status
   * line.
   */
  maybeSubmit(replay: BeMusicReplay | undefined, chartEntry: LibraryChart, exScore?: number): void {
    if (!this.submitThisPlay || replay === undefined) return;
    if (!shouldSubmitPlay(this.submitRuleThisPlay, exScore, this.previousBestEXScore)) {
      this.host.setStatus(playerText().lb.notImproved);
      return;
    }
    const prepared = prepareLeaderboardSubmission(replay, chartEntry.chart, chartEntry.chartPath);
    if (!prepared.ok) {
      this.host.setStatus(describeSkippedSubmission(prepared.reason));
      return;
    }
    const playedRuleset = replay.play.judgeRuleset ?? 'lr2';
    void submitToLeaderboard(prepared.submission, { client: describeSubmittingClient(this.host.recorder) })
      .then((result) => {
        this.host.setStatus(
          describeLeaderboardResult(result, playedRuleset, resolveReplayRecordPolicy(replay).leaderboard),
        );
        // Refresh the account row; the submission may have changed what it shows.
        void this.refreshAccount();
      })
      .catch((error: unknown) => {
        this.host.warn('leaderboard submission failed', error);
        this.host.setStatus(playerText().lb.network);
      });
  }
  /**
   * Sends a finished course run to the Leaderboard when "Submit to Leaderboard" was on when its last stage started,
   * whatever the "Submit when" rule (a run is ranked by more than its EX-SCORE, and it is few requests), as
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
        this.host.setStatus(playerText().lb.courseNetwork);
      });
  }
  /** Re-reads the account into the Options dialog's "Account" row and the shared header. */
  async refreshAccount(): Promise<void> {
    const { account, reached } = await readLeaderboardAccount();
    this.shownAccount = account;
    this.accountReady = true;
    this.signedInName = account !== undefined && !account.anonymous ? account.displayName : undefined;
    const state = describeAccountChip(account).state;
    // A player who is signed in takes part: submitting turns on when they arrive signed in or sign in, not on every
    // refresh, so unticking it during a session sticks.
    if (shouldTurnOnSubmitting(this.shownState, state)) this.setSubmitting(true);
    this.shownState = state;
    // Only an answer shapes the next visit's placeholder: a failed request (offline, a reload mid-request) says nothing.
    if (reached) rememberStartAccountState(state, defaultStorage());
    this.renderAccountForm();
    this.renderStartAccount(account);
    setPlayerHeaderAccount(
      account === undefined
        ? undefined
        : {
            handle: account.handle,
            displayName: account.displayName,
            anonymous: account.anonymous,
            avatarUrl: account.avatarUrl,
          },
    );
  }
  /**
   * Fills the Options dialog's account form: a skeleton until the account is read, then the account (or a Sign in
   * heading) and its actions. The passkey, Google, Discord and Sign up buttons carry `data-auth-action`, which the
   * account dialogs' handler runs; keeping and signing out run here and report in the status line.
   */
  private renderAccountForm(): void {
    const root = this.accountForm;
    if (root === undefined) return;
    if (!this.accountReady) {
      render(
        skeletonGroupTemplate({
          locale: playerLang(),
          label: playerText().shell.checkingAccount,
          content: html`${skeletonTemplate({ shape: 'circle', width: '40px' })}${skeletonTemplate({ shape: 'line', width: '18ch' })}`,
        }),
        root,
      );
      return;
    }
    const account = this.shownAccount;
    const view = describeLeaderboardAccountForm(account);
    const copy = playerText().account;
    const locale = playerLang();
    const has = (action: Parameters<typeof view.actions.includes>[0]) => view.actions.includes(action);
    const takePart = () => this.setSubmitting(true);
    const methods = has('sign-in-passkey')
      ? html`${authButtonTemplate({
            action: 'sign-in',
            method: 'passkey',
            label: copy.signInPasskey,
            ...(view.state === 'anonymous' ? { variant: 'outline' as const } : {}),
          })}
          <div class="text-muted-foreground flex items-center gap-3 text-xs" role="separator">
            <span class="bg-border h-px flex-1"></span>${copy.or}<span class="bg-border h-px flex-1"></span>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            ${authButtonTemplate({ action: 'sign-in-google', method: 'google', variant: 'outline', label: copy.signInGoogle })}
            ${authButtonTemplate({
              action: 'sign-in-discord',
              method: 'discord',
              variant: 'outline',
              label: copy.signInDiscord,
            })}
          </div>`
      : nothing;
    render(
      html`<section class="grid gap-3 border-b pb-4" data-state=${view.state}>
        ${
          account === undefined
            ? html`<header class="space-y-1">
                <h3 class="text-base font-semibold">${view.title}</h3>
                <p class="text-muted-foreground text-sm">${view.lead}</p>
              </header>`
            : html`<div class="flex items-center justify-between gap-3">
                  ${accountIdentityTemplate({
                    account: {
                      handle: account.handle,
                      displayName: account.displayName,
                      anonymous: account.anonymous,
                      ...(account.avatarUrl === undefined
                        ? {}
                        : { avatarURL: leaderboardAvatarURL(account.avatarUrl, location.hostname) }),
                    },
                    locale,
                  })}
                  <div class="flex shrink-0 items-center gap-2">
                    <a
                      class="btn shrink-0"
                      data-size="sm"
                      data-variant="ghost"
                      href=${leaderboardLink(`/players/${encodeURIComponent(account.handle)}`, location.hostname)}
                      target="_blank"
                      rel="noopener"
                      title=${playerText().shell.yourPage}
                      >${copy.myPage}</a
                    >
                    <button
                      class="btn"
                      type="button"
                      data-size="sm"
                      data-variant="outline"
                      @click=${() => void this.runAccountAction(copy.signOut, signOutOfLeaderboard)}
                    >
                      ${copy.signOut}
                    </button>
                  </div>
                </div>
                <p class="text-muted-foreground text-sm">${view.lead}</p>`
        }
        ${
          has('keep')
            ? html`<button
                class="btn w-full"
                type="button"
                @click=${() => void this.runAccountAction(copy.keep, keepLeaderboardAccount, takePart)}
              >
                ${copy.keep}
              </button>`
            : nothing
        }
        ${methods}
        <be-music-status class="text-destructive text-sm" data-auth-status role="status" hidden></be-music-status>
        ${
          has('sign-up')
            ? html`<footer class="text-muted-foreground flex items-center gap-1 text-sm">
                ${copy.noAccount}
                ${authButtonTemplate({ action: 'open-sign-up', label: copy.signUp, variant: 'link', className: 'btn px-0' })}
              </footer>`
            : nothing
        }
      </section>`,
      root,
    );
  }
  /** Opens the sign-in dialog. The header's Sign in control calls this. */
  public openSignIn(): void {
    this.openDialog('sign-in');
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
    if (hint !== null) render(view.hint ?? '', hint);
    render(
      view.href !== undefined
        ? html`<a
            href=${leaderboardLink(view.href, location.hostname)}
            target="_blank"
            rel="noopener"
            title=${playerText().shell.yourPage}
            >${view.label}</a
          >`
        : view.label,
      label,
    );
    // Localization must not restore the boot's loading placeholder over the current account.
    render(
      view.actions.map(
        (action) =>
          html`<button
            class="btn"
            type="button"
            data-size="sm"
            data-variant=${action !== 'sign-up' && action !== 'keep' ? 'outline' : nothing}
            @click=${() => {
              const copy = playerText();
              if (action === 'sign-out') void this.runAccountAction(copy.account.signOut, signOutOfLeaderboard);
              else if (action === 'keep') void this.runAccountAction(copy.account.manage, keepLeaderboardAccount);
              else if (action === 'sign-up') this.openDialog('sign-up');
              else this.openDialog('sign-in');
            }}
          >
            ${startAccountActionLabels()[action]}
          </button>`,
      ),
      actions,
    );
  }
  private setSubmitting(value: boolean): void {
    this.host.settings().submitToLeaderboard = value;
    const checkbox = document.querySelector<HTMLInputElement>('#start-submit');
    if (checkbox) checkbox.checked = value;
    this.submitController?.refresh();
  }
}
