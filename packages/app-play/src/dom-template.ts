import { playerLang, playerText } from './player-copy.ts';
import { localized } from './ui/localized.ts';
import { PLAYER_HELP_TEMPLATE } from './ui/help-template.ts';
import { OPTIONS_HELP_TEMPLATE } from './ui/options/help-template.ts';
import { PLAYER_BUILD_INFO } from './ui/shell-build-info.ts';
import { html } from 'lit';
import { publicBetaNoticeTemplate, serviceFooterTemplate } from '@be-music/service-web-theme/client';

/** Local play uses production siblings, matching `leaderboardLink`. A preview host stays on preview. */
function playHostname(): string {
  return typeof location === 'undefined' ? 'localhost' : location.hostname;
}

/**
 * The player shell, rendered once into `#app` with Lit before the application binds its surfaces.
 *
 * Extracted from `main.ts` so the bootstrap module isn't dominated by ~470 lines of inline markup. The layout is
 * a Lit template so authoring and diffing read like HTML. Shared server-rendered fragments enter through
 * `unsafeHTML`; these renderers escape their own dynamic values. Inline `<!-- … -->` comments document each region — keep them when editing this file so the markup
 * stays self-documenting.
 *
 * Sub-elements wired up elsewhere:
 *  - `#player-service-header` — `player-header.ts` (`mountPlayerHeader`): the shared site header. Settings opens the Options dialog (`#options-modal`, `ui/options/`). Fullscreen covers `#main`, so this header and the site footer stay on the page.
 *  - `#help-modal` — `help-modal.ts` (`wireHelpModal`), opened from the header's Help button
 *  - `#compat-panel*` — `compat-panel.ts` (`renderBrowserCompatPanel`), folded inside the drop card
 *  - `#start-leaderboard` / `#start-*` — `leaderboard-ui.ts` (`LeaderboardPanel.bindStartCard`)
 *  - `#start-silent-mode` — `silent-mode-playback.ts` (`mountStartSilentModeOption`), from `services/silent-mode.ts`
 *  - `#songs` / `#search` / `#stage` / `#loading-*` / `.shell` — looked up in `main.ts` as `PlayerWebElements`
 */
export const PLAYER_APP_TEMPLATE = html`
  <div class="shell empty">
    <div id="player-service-header" class="player-service-header"></div>
    <main id="main" class="player-main">
      <!--
      Hidden file input — triggered by the Options dialog's
      "Open folder" button, which forwards a synthetic click to
      this hidden input. \`webkitdirectory\` makes the
      browser show a folder picker on Chromium / Safari. ZIPs and
      replays go through the "Open files" picker below.
    -->
      <input id="songs" type="file" webkitdirectory multiple class="hidden-file-input" />
      <!-- The "Open files" button's picker: ZIP archives and replays (\`*.bmplay.json\`, \`*.bmcourse.json\`). -->
      <input id="files" type="file" multiple accept=".zip,.json" class="hidden-file-input" />
      <input
        id="search"
        class="input search-input"
        type="search"
        placeholder=${localized('search')}
        aria-describedby="search-error"
      />
      <p id="search-error" class="search-error" role="status" hidden></p>
      <div class="stage" id="stage">
        <!--
        Drop hint. Visible whenever the shell carries the
        \`.empty\` class (no songs loaded yet) so the user has a
        clear "drop a folder here" target up-front, plus during
        an active drag (\`.dragging\`) so the hint reappears even
        once charts are loaded. Falls behind the canvas otherwise.

        Structured as two layers:
        - \`.drop-card\`: centered glassmorphism panel hosting the
          actual content; hosts the entry / hover animations.
          It is the only drop feedback.
        - icon + title + subtitle for the hierarchy.
      -->
        <div class="drop">
          <div class="card drop-card px-8">
            <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true">
              <!--
              Stylized download arrow. The two halves animate
              independently so the head bounces while the
              shaft holds steady — feels lighter than a single
              translateY.
            -->
              <path
                class="drop-icon-shaft"
                d="M24 6 L24 30"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
              />
              <path
                class="drop-icon-head"
                d="M14 22 L24 32 L34 22"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M10 38 L38 38"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                opacity="0.55"
              />
            </svg>
            <div class="drop-title">${localized('dropTitle')}</div>
            <div class="drop-subtitle">
              <span>${localized('dropFolder')}</span>
              <span class="drop-subtitle-sep" aria-hidden="true">·</span>
              <span>${localized('dropLR2Skin')}</span>
              <span class="drop-subtitle-sep" aria-hidden="true">·</span>
              <span>${localized('dropBeatorajaSkin')}</span>
            </div>
            <!--
            Leaderboard: whether this browser's plays are sent, and the
            account they go to. Rendered by \`LeaderboardPanel\`
            (leaderboard-ui.ts) from the account state; the checkbox is
            the Options dialog's "Submit to Leaderboard" setting.
          -->
            <section class="start-leaderboard" id="start-leaderboard" aria-label=${localized('leaderboard')}>
              <!-- One row: the checkbox, then the account's actions. Under it, one note: who the plays go to, and why. -->
              <div class="start-leaderboard-row">
                <label class="start-check">
                  <input class="input" type="checkbox" id="start-submit" />
                  <span>${localized('submitPlays')}</span>
                </label>
                <div class="start-account-actions" id="start-account-actions"></div>
              </div>
              <!-- \`loading\` until the account has been read, so a signed-in player never sees "Not signed in". -->
              <p class="start-account" id="start-account" data-state="loading">
                <span class="start-account-label" id="start-account-label"></span
                ><span class="start-account-hint" id="start-account-hint"></span>
              </p>
              <be-music-status
                class="start-account-status"
                id="start-account-status"
                role="status"
                aria-live="polite"
              ></be-music-status>
            </section>
            <!--
            Sound in silent mode: Safari / iOS only (\`navigator.audioSession\`),
            so hidden until \`mountStartSilentModeOption\`
            (silent-mode-playback.ts) fills the label and note in the
            browser's language and shows it. The checkbox is the Debug
            Menu's "Play in silent mode" setting.
          -->
            <section class="start-audio" id="start-silent-mode" aria-label=${localized('sound')} hidden>
              <label class="start-check">
                <input class="input" type="checkbox" id="start-silent-mode-input" checked />
                <span data-silent-mode-label>Play in silent mode</span>
              </label>
              <p class="start-audio-note" data-silent-mode-note></p>
            </section>
            <!--
            Browser-compatibility check, folded: the summary gives the
            verdict at a glance, opening it lists every probed feature
            split into Required / Optional. Opened up front when a
            required feature is missing. Populated once at boot from
            \`checkBrowserCompat()\` (compat-panel.ts).
          -->
            <details class="compat-panel" id="compat-panel">
              <summary class="compat-panel-header">
                <span class="compat-panel-badge" id="compat-panel-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" class="compat-panel-badge-icon" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
                    <path
                      class="compat-panel-badge-mark compat-panel-badge-mark--check"
                      d="M7 12 L11 16 L17 9"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      class="compat-panel-badge-mark compat-panel-badge-mark--cross"
                      d="M8 8 L16 16 M16 8 L8 16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="compat-panel-eyebrow">${localized('systemCheck')}</span>
                <span class="compat-panel-status" id="compat-panel-status"></span>
                <span class="compat-panel-chevron" aria-hidden="true"></span>
              </summary>
              <div class="compat-panel-sections">
                <section class="compat-panel-section">
                  <h3 class="compat-panel-section-title">${localized('required')}</h3>
                  <ul class="compat-panel-list" id="compat-panel-required"></ul>
                </section>
                <section class="compat-panel-section">
                  <h3 class="compat-panel-section-title">${localized('optional')}</h3>
                  <ul class="compat-panel-list" id="compat-panel-optional"></ul>
                </section>
              </div>
            </details>
            <!-- Public Beta, in both languages; Help shows the one it picked (help-modal.ts). -->
            <div class="start-beta-notice">${publicBetaNoticeTemplate('both')}</div>
          </div>
        </div>
      </div>
      <!--
      Leaderboard sign-in and sign-up, as on the Leaderboard's own pages:
      a passkey, Google, or Discord. Each button starts Accounts sign-in
      and the OIDC callback returns here. Opened from the start card's
      account row; wired by \`wireAccountDialogs\` (account-dialogs.ts).
    -->
      <dialog
        class="dialog account-dialog"
        id="leaderboard-sign-in"
        aria-labelledby="leaderboard-sign-in-title"
      ></dialog>
      <dialog
        class="dialog account-dialog"
        id="leaderboard-sign-up"
        aria-labelledby="leaderboard-sign-up-title"
      ></dialog>
      <!--
      "Drop a skin" — shown when the Options dialog's Skin system is set to LR2 or
      beatoraja with none of that system loaded. A drop anywhere closes it, and
      the detected skin is confirmed before it is used. Filled by
      \`promptSkinDrop\` (ui/skin-drop-prompt.ts).
    -->
      <dialog class="dialog" id="skin-drop" aria-labelledby="skin-drop-title">
        <div class="grid justify-items-center gap-3 text-center">
          <svg class="drop-icon size-11" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M24 6 L24 30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            <path
              d="M14 22 L24 32 L34 22"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M10 38 L38 38"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              opacity="0.55"
            />
          </svg>
          <h2 class="drop-title" id="skin-drop-title"></h2>
          <p class="text-muted-foreground text-sm" data-skin-drop-hint></p>
          <footer>
            <button type="button" class="btn" data-variant="outline" data-skin-drop-cancel>
              ${localized('cancel')}
            </button>
          </footer>
        </div>
      </dialog>
      <dialog
        class="dialog account-dialog"
        id="skin-switch"
        aria-labelledby="skin-switch-title"
        aria-describedby="skin-switch-hint"
      >
        <form method="dialog" class="account-dialog-body">
          <header>
            <h2 id="skin-switch-title">${localized('skinSwitchTitle')}</h2>
            <p id="skin-switch-hint">${localized('skinSwitchHint')}</p>
          </header>
          <footer>
            <button type="submit" value="" class="btn" data-variant="outline" autofocus>${localized('cancel')}</button>
            <span class="account-dialog-buttons">
              <button type="submit" value="lr2" class="btn" data-skin-family="lr2">${localized('useLr2')}</button>
              <button type="submit" value="beatoraja" class="btn" data-skin-family="beatoraja">
                ${localized('useBeatoraja')}
              </button>
            </span>
          </footer>
        </form>
      </dialog>
      <!--
      A dropped replay (\`*.bmplay.json\`) whose chart is not loaded, or a course
      replay (\`*.bmcourse.json\`) whose stage charts are not all loaded: it lists
      the missing charts and the replay does not start. Filled by
      \`showMissingReplayCharts\` (ui/replay-missing.ts).
    -->
      <dialog
        class="dialog account-dialog"
        id="replay-missing"
        aria-labelledby="replay-missing-title"
        aria-describedby="replay-missing-hint"
      >
        <form method="dialog" class="account-dialog-body">
          <header>
            <h2 id="replay-missing-title">${localized('chartsMissing')}</h2>
            <p id="replay-missing-hint" data-replay-missing-hint></p>
          </header>
          <ul class="replay-missing-list" data-replay-missing-list></ul>
          <footer>
            <button type="submit" class="btn" autofocus>${localized('ok')}</button>
          </footer>
        </form>
      </dialog>
      <!--
      The exit menu: Escape at the root of the select screen asks whether to leave it for the drop screen, as
      That-Which-Must-Not-Be-Named PC's exit menu asks before it leaves. Opened by \`showExitMenu\` (ui/exit-menu.ts).
    -->
      <dialog
        class="dialog account-dialog"
        id="exit-menu"
        aria-labelledby="exit-menu-title"
        aria-describedby="exit-menu-hint"
      >
        <form method="dialog" class="account-dialog-body">
          <header>
            <h2 id="exit-menu-title">${localized('exitMenuTitle')}</h2>
            <p id="exit-menu-hint">${localized('exitMenuHint')}</p>
          </header>
          <footer>
            <button type="submit" class="btn" data-variant="outline" value="cancel">
              ${localized('exitMenuCancel')}
            </button>
            <button type="submit" class="btn" value="leave" autofocus>${localized('exitMenuLeave')}</button>
          </footer>
        </form>
      </dialog>
      <!--
      A play whose selected options do not fit its chart (beatoraja CONVERGE on a
      7KEY chart, LR2 SCATTER on a non-9KEY chart, ...): it names the options and
      the player goes back to the select screen when it closes. Filled by
      \`showPlayOptionMismatch\` (ui/play-option-mismatch.ts).
    -->
      <dialog
        class="dialog account-dialog"
        id="play-option-mismatch"
        aria-labelledby="play-option-mismatch-title"
        aria-describedby="play-option-mismatch-hint"
      >
        <form method="dialog" class="account-dialog-body">
          <header>
            <h2 id="play-option-mismatch-title">${localized('optionUnavailable')}</h2>
            <p id="play-option-mismatch-hint">${localized('optionUnavailableHint')}</p>
          </header>
          <ul class="replay-missing-list" data-play-option-mismatch-list></ul>
          <footer>
            <button type="submit" class="btn" autofocus>${localized('ok')}</button>
          </footer>
        </form>
      </dialog>
      <!--
      Loading overlay. Hidden by default; revealed via the
      "visible" class while a folder / ZIP drop is mid-load. The
      bar below moves between "indeterminate" (CSS animation) and
      "determinate" (inline width %) states depending on whether
      the active phase reports a known total. The card sits in the
      center of the shell so it's visible regardless of which
      scene is currently mounted (select / gameplay / result).
    -->
      <div class="loading-overlay" id="loading-overlay" aria-hidden="true">
        <div class="card loading-card gap-3 px-6" role="status" aria-live="polite">
          <div class="loading-label" id="loading-label"></div>
          <div class="progress loading-bar"><span class="loading-bar-fill" id="loading-bar-fill"></span></div>
          <div class="loading-counter" id="loading-counter"></div>
        </div>
      </div>
      <!--
      Touch play controls. Phones and tablets have no Space / Esc key, so
      during play a pause button sits in the top-left corner; while paused
      it shows Resume and Quit. Hidden on desktops and outside play.
    -->
      <div class="touch-controls" id="touch-controls">
        <button
          class="btn touch-control"
          data-size="icon"
          id="touch-pause"
          type="button"
          aria-label=${localized('pause')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </button>
        <button
          class="btn touch-control touch-control--text"
          data-size="sm"
          data-variant="outline"
          id="touch-quit"
          type="button"
        >
          ${localized('quit')}
        </button>
      </div>
      <!--
      Shown on phones held upright: the play field is laid out for
      landscape, so ask for a turn instead of shrinking it to a strip.
    -->
      <div class="rotate-hint" aria-live="polite">
        <div class="card rotate-hint-card gap-2 px-6 text-center">
          <svg class="rotate-hint-icon" viewBox="0 0 48 48" aria-hidden="true">
            <rect x="15" y="6" width="18" height="32" rx="3" fill="none" stroke="currentColor" stroke-width="2.4" />
            <path
              d="M8 34a17 17 0 0 0 17 9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
            <path
              d="M21 40l4 3-3 4"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <div class="rotate-hint-title">${localized('rotateTitle')}</div>
          <div class="rotate-hint-subtitle">${localized('rotateSubtitle')}</div>
        </div>
      </div>
      <!--
      Install, for Safari: it has no install prompt, so the header's
      Install button opens these steps (install-button.ts).
    -->
      <dialog
        class="dialog"
        id="install-dialog"
        aria-labelledby="install-dialog-title"
        aria-describedby="install-dialog-description"
      >
        <div>
          <header>
            <h2 id="install-dialog-title">${localized('installTitle')}</h2>
            <p id="install-dialog-description">${localized('installLead')}</p>
          </header>
          <section>
            <ol class="install-steps" data-install-steps="ios-safari" hidden>
              <li>${localized('installIOSShare')}</li>
              <li>${localized('installIOSAdd')}</li>
            </ol>
            <ol class="install-steps" data-install-steps="mac-safari" hidden>
              <li>${localized('installMacFile')}</li>
              <li>${localized('installMacAdd')}</li>
            </ol>
          </section>
          <footer>
            <button type="button" class="btn" data-install-close>${localized('close')}</button>
          </footer>
        </div>
      </dialog>
      <!--
      Help modal. Two tabs:
      - Usage: drag-drop instructions, keyboard shortcuts,
        gameplay keys and the result screen.
      - Acknowledgements: the acknowledgement list the build writes
        (one card per third-party package in the bundle, with
        its license text; scripts/acknowledgements.ts).
      A Basecoat dialog and tabs; help-modal.ts opens it with
      \`showModal()\` and switches the tabs.
    -->
      ${PLAYER_HELP_TEMPLATE}
      <!-- Options tooltip descriptions, kept outside the Help dialog. -->
      ${OPTIONS_HELP_TEMPLATE}

      <!--
      Options: every player setting, a Basecoat dialog with one tab per
      area. ui/options/ (OptionsDialog.buildGUI) fills #options-modal-body;
      the header's Settings button opens it, and so does #options-open
      while the play surface is fullscreen and the header is not shown.
    -->
      <dialog class="dialog options-dialog" id="options-modal" aria-labelledby="options-modal-title">
        <div>
          <header>
            <h2 id="options-modal-title">${localized('options')}</h2>
          </header>
          <section id="options-modal-body" class="options-body"></section>
          <button type="button" id="options-modal-close" aria-label=${localized('close')}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </dialog>
      <button
        type="button"
        id="options-open"
        class="btn options-open"
        data-variant="secondary"
        data-size="icon"
        aria-label=${localized('options')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </main>
    ${localized(() =>
      serviceFooterTemplate({
        current: 'play',
        hostname: playHostname(),
        className: 'service-page-footer',
        buildInfo: PLAYER_BUILD_INFO,
        layout: 'columns',
        publicBeta: false,
        navLabel: playerText().shell.services,
        locale: playerLang(),
      }),
    )}
  </div>
`;
