import { renderBuildInfo } from '@be-music/web-theme';

/**
 * Static HTML for the demo shell — injected once into `#app` at boot via `app.innerHTML = DEMO_APP_HTML`.
 *
 * Extracted from `main.ts` so the bootstrap module isn't dominated by ~470 lines of inline markup. The layout is
 * intentionally a single template-literal blob (no DOM-building APIs) so authoring / diffing reads like a static
 * HTML file. Inline `<!-- … -->` comments document each region — keep them when editing this file so the markup
 * stays self-documenting.
 *
 * Sub-elements wired up elsewhere:
 *  - `#help-button` / `#help-modal` — `help-modal.ts` (`wireHelpModal`)
 *  - `#account-chip` — `leaderboard-ui.ts` (`LeaderboardPanel.refreshAccount`)
 *  - `#compat-panel*` — `compat-panel.ts` (`renderBrowserCompatPanel`), folded inside the drop card
 *  - `#start-leaderboard` / `#start-*` — `leaderboard-ui.ts` (`LeaderboardPanel.bindStartCard`)
 *  - `#start-silent-mode` — `silent-mode-playback.ts` (`mountStartSilentModeOption`), from `services/silent-mode.ts`
 *  - `#songs` / `#search` / `#stage` / `#loading-*` / `.shell` — looked up in `main.ts` as `PlayerWebDemoElements`
 */
export const DEMO_APP_HTML = `
  <div class="shell empty">
    <!--
      Hidden file input — triggered by the GUI's "Open folder"
      button. lil-gui has no native file controller, so we
      forward a synthetic click to this hidden input from the
      function controller's handler. \`webkitdirectory\` makes the
      browser show a folder picker on Chromium / Safari. ZIPs and
      replays go through the "Open files" picker below.
    -->
    <input id="songs" type="file" webkitdirectory multiple class="hidden-file-input" />
    <!-- The "Open files" button's picker: ZIP archives and replays (\`*.bmplay.json\`). -->
    <input id="files" type="file" multiple accept=".zip,.json" class="hidden-file-input" />
    <input id="search" class="search-input" type="search" placeholder="Search title / artist / genre..." />
    <div class="stage" id="stage">
      <!--
        Drop hint. Visible whenever the shell carries the
        \`.empty\` class (no songs loaded yet) so the user has a
        clear "drop a folder here" target up-front, plus during
        an active drag (\`.dragging\`) so the hint reappears even
        once charts are loaded. Falls behind the canvas otherwise.

        Structured as three layers:
        - \`.drop-frame\`: subtle outer ring spanning the whole
          stage, lights up during a live drag.
        - \`.drop-card\`: centered glassmorphism panel hosting the
          actual content; hosts the entry / hover animations.
        - icon + title + subtitle for the hierarchy.
      -->
      <div class="drop">
        <div class="drop-frame"></div>
        <div class="drop-card">
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
          <div class="drop-title">Drop to load</div>
          <div class="drop-subtitle">
            <span>BMS folder</span>
          </div>
          <!--
            Leaderboard: whether this browser's plays are sent, and the
            account they go to. Rendered by \`LeaderboardPanel\`
            (leaderboard-ui.ts) from the account state; the checkbox is
            the Debug Menu's "Submit to Leaderboard" setting.
          -->
          <section class="start-leaderboard" id="start-leaderboard" aria-label="Leaderboard">
            <label class="start-check">
              <input type="checkbox" id="start-submit" />
              <span>Submit my plays to the Leaderboard</span>
            </label>
            <!-- \`loading\` until the account has been read, so a signed-in player never sees "Not signed in". -->
            <div class="start-account" id="start-account" data-state="loading">
              <span class="start-account-label" id="start-account-label">Checking account…</span>
              <div class="start-account-actions" id="start-account-actions"></div>
            </div>
            <p class="start-account-hint" id="start-account-hint"></p>
            <div class="start-account-status" id="start-account-status" role="status" aria-live="polite"></div>
          </section>
          <!--
            Sound in silent mode: Safari / iOS only (\`navigator.audioSession\`),
            so hidden until \`mountStartSilentModeOption\`
            (silent-mode-playback.ts) fills the label and note in the
            browser's language and shows it. The checkbox is the Debug
            Menu's "Play in silent mode" setting.
          -->
          <section class="start-audio" id="start-silent-mode" aria-label="Sound" hidden>
            <label class="start-check">
              <input type="checkbox" id="start-silent-mode-input" checked />
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
              <span class="compat-panel-eyebrow">System check</span>
              <span class="compat-panel-status" id="compat-panel-status">Browser ready</span>
              <span class="compat-panel-chevron" aria-hidden="true"></span>
            </summary>
            <div class="compat-panel-sections">
              <section class="compat-panel-section">
                <h3 class="compat-panel-section-title">Required</h3>
                <ul class="compat-panel-list" id="compat-panel-required"></ul>
              </section>
              <section class="compat-panel-section">
                <h3 class="compat-panel-section-title">Optional</h3>
                <ul class="compat-panel-list" id="compat-panel-optional"></ul>
              </section>
            </div>
          </details>
          <footer class="service-build-footer">${renderBuildInfo(
            typeof __BE_MUSIC_BUILD_TIME__ === 'string'
              ? { builtAt: __BE_MUSIC_BUILD_TIME__, revision: __BE_MUSIC_BUILD_REVISION__ }
              : undefined,
          )}</footer>
        </div>
      </div>
    </div>
    <!--
      Leaderboard sign-in and sign-up, as on the Leaderboard's own pages:
      a passkey now, Google and Discord shown but in development. Opened
      from the start card's account row; wired by \`wireAccountDialogs\`
      (account-dialogs.ts).
    -->
    <dialog class="account-dialog" id="leaderboard-sign-in" aria-labelledby="leaderboard-sign-in-title">
      <div class="account-dialog-body">
        <header>
          <h2 id="leaderboard-sign-in-title">Sign in</h2>
          <p>Use the passkey of your Leaderboard account.</p>
        </header>
        <button type="button" class="account-dialog-primary" data-account-dialog-action="sign-in">
          Sign in with a passkey
        </button>
        <div class="account-dialog-or" role="separator">or</div>
        <div class="account-providers">
          <button type="button" class="account-provider" disabled title="Sign in with Google is coming soon">
            <span class="account-provider-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg></span>
            Sign in with Google
            <span class="account-provider-badge">Coming soon</span>
          </button>
          <button type="button" class="account-provider" disabled title="Sign in with Discord is coming soon">
            <span class="account-provider-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg></span>
            Sign in with Discord
            <span class="account-provider-badge">Coming soon</span>
          </button>
        </div>
        <p class="account-dialog-status" data-account-dialog-status role="status" hidden></p>
        <footer>
          <button type="button" class="account-dialog-link" data-account-dialog-action="open-sign-up">
            No account yet? Sign up
          </button>
          <button type="button" class="account-dialog-quiet" data-account-dialog-action="close">Cancel</button>
        </footer>
      </div>
    </dialog>
    <dialog class="account-dialog" id="leaderboard-sign-up" aria-labelledby="leaderboard-sign-up-title">
      <form class="account-dialog-body" method="dialog" data-account-sign-up-form>
        <header>
          <h2 id="leaderboard-sign-up-title">Create your account</h2>
          <p data-account-sign-up-lead>Pick a handle and a name. Your browser then makes a passkey for it.</p>
        </header>
        <div class="account-providers">
          <button type="button" class="account-provider" disabled title="Sign up with Google is coming soon">
            <span class="account-provider-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg></span>
            Sign up with Google
            <span class="account-provider-badge">Coming soon</span>
          </button>
          <button type="button" class="account-provider" disabled title="Sign up with Discord is coming soon">
            <span class="account-provider-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg></span>
            Sign up with Discord
            <span class="account-provider-badge">Coming soon</span>
          </button>
        </div>
        <div class="account-dialog-or" role="separator">or with a passkey</div>
        <label class="account-field">
          <span>Handle</span>
          <input
            name="handle"
            required
            minlength="3"
            maxlength="15"
            pattern="[A-Za-z0-9_]{3,15}"
            autocomplete="username"
            spellcheck="false"
          />
          <small>3 to 15 letters, digits or _. It names your page.</small>
        </label>
        <label class="account-field">
          <span>Name</span>
          <input name="displayName" required maxlength="64" autocomplete="nickname" />
          <small>Up to 32 characters, in any script. The rankings show it.</small>
        </label>
        <p class="account-dialog-status" data-account-dialog-status role="status" hidden></p>
        <footer>
          <span></span>
          <span class="account-dialog-buttons">
            <button type="button" class="account-dialog-quiet" data-account-dialog-action="close">Cancel</button>
            <button type="submit" class="account-dialog-primary">Create passkey</button>
          </span>
        </footer>
      </form>
    </dialog>
    <!--
      "Drop a skin" — shown when the Debug Menu's Skin system is set to LR2 or
      beatoraja with none of that system loaded. A drop anywhere closes it, and
      a skin of the asked-for system is then used without asking. Filled by
      \`promptSkinDrop\` (ui/skin-drop-prompt.ts).
    -->
    <dialog class="skin-drop" id="skin-drop" aria-labelledby="skin-drop-title">
      <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 6 L24 30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        <path d="M14 22 L24 32 L34 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M10 38 L38 38" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.55" />
      </svg>
      <h2 class="drop-title" id="skin-drop-title">Drop an LR2 skin</h2>
      <p class="skin-drop-hint" data-skin-drop-hint></p>
      <button type="button" class="account-dialog-quiet" data-skin-drop-cancel>Cancel</button>
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
      <div class="loading-card" role="status" aria-live="polite">
        <div class="loading-label" id="loading-label">Loading…</div>
        <div class="loading-bar"><div class="loading-bar-fill" id="loading-bar-fill"></div></div>
        <div class="loading-counter" id="loading-counter"></div>
      </div>
    </div>
    <!--
      Bottom-right floating Help button. Pinned so it stays
      reachable from every scene (select / gameplay / result)
      without having to compete with lil-gui (top-right) or the
      search bar (bottom-left). Opens the unified Help dialog
      that hosts both the usage guide and the third-party
      attribution required by the libraries we ship.
    -->
    <button class="help-button" id="help-button" type="button" aria-haspopup="dialog" aria-controls="help-modal">
      <svg class="help-button-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path
          d="M9.4 9.5 a2.6 2.6 0 1 1 3.6 2.4 c-0.7 0.3 -1 0.9 -1 1.6 V14.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
      </svg>
      <span class="help-button-label">Help</span>
    </button>
    <!--
      Bottom-right Leaderboard account chip: the sign-in state at a glance
      (a green dot when signed in, amber when anonymous, grey when signed
      out). Signed in, it opens the player's Leaderboard page; signed out,
      it opens the Debug Menu's Leaderboard folder. Wired in \`leaderboard-ui.ts\`.
    -->
    <a class="account-chip" id="account-chip" data-state="loading" href="https://leaderboard.be-music.app/" target="_blank" rel="noopener">
      <span class="account-chip-dot" aria-hidden="true"></span>
      <span class="account-chip-label" id="account-chip-label"></span>
    </a>
    <!--
      Touch play controls. Phones and tablets have no Space / Esc key, so
      during play a pause button sits in the top-left corner; while paused
      it shows Resume and Quit. Hidden on desktops and outside play.
    -->
    <div class="touch-controls" id="touch-controls">
      <button class="touch-control" id="touch-pause" type="button" aria-label="Pause">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
      </button>
      <button class="touch-control touch-control--text" id="touch-quit" type="button">Quit</button>
    </div>
    <!--
      Shown on phones held upright: the play field is laid out for
      landscape, so ask for a turn instead of shrinking it to a strip.
    -->
    <div class="rotate-hint" aria-live="polite">
      <div class="rotate-hint-card">
        <svg class="rotate-hint-icon" viewBox="0 0 48 48" aria-hidden="true">
          <rect x="15" y="6" width="18" height="32" rx="3" fill="none" stroke="currentColor" stroke-width="2.4" />
          <path d="M8 34a17 17 0 0 0 17 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
          <path d="M21 40l4 3-3 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div class="rotate-hint-title">Rotate your device</div>
        <div class="rotate-hint-subtitle">The player is laid out for landscape.</div>
      </div>
    </div>
    <!--
      Help modal. Two tabs:
      - Usage: drag-drop instructions, keyboard shortcuts,
        gameplay keys, options.
      - Open source: build-time-resolved acknowledgement list
        (one card per npm dependency that ships in the runtime
        bundle, with verbatim LICENSE text).
      Hidden by default; toggled via the \`.visible\` class on
      the overlay.
    -->
    <div class="help-modal" id="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title" aria-hidden="true">
      <div class="help-modal-backdrop" id="help-modal-backdrop"></div>
      <div class="help-modal-card">
        <header class="help-modal-header">
          <div>
            <div class="help-modal-eyebrow">Help &amp; About</div>
            <h2 class="help-modal-title" id="help-modal-title">be-music player</h2>
          </div>
          <button class="help-modal-close" id="help-modal-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7 7 L17 17 M17 7 L7 17"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>
        <div class="help-modal-tabs" role="tablist">
          <button
            class="help-modal-tab is-active"
            id="help-tab-usage"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="help-pane-usage"
            data-pane="usage"
          >
            Usage
          </button>
          <button
            class="help-modal-tab"
            id="help-tab-oss"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="help-pane-oss"
            data-pane="oss"
          >
            Open source
          </button>
        </div>
        <section
          class="help-modal-pane is-active"
          id="help-pane-usage"
          role="tabpanel"
          aria-labelledby="help-tab-usage"
          tabindex="0"
        >
          <!--
            Language switcher. The two \`.help-lang\` blocks below
            carry parallel translations; only one is shown at a
            time. Default selection comes from \`navigator.language\`
            at boot — \`ja-*\` users land on Japanese, everyone else
            on English.
          -->
          <div class="help-lang-switch" role="group" aria-label="Language">
            <button
              class="help-lang-toggle is-active"
              type="button"
              data-lang="en"
              aria-pressed="true"
            >
              English
            </button>
            <button class="help-lang-toggle" type="button" data-lang="ja" aria-pressed="false">
              日本語
            </button>
          </div>
          <div class="help-lang is-active" data-lang="en">
            <section class="help-about">
              <p class="help-about-summary">
                A browser-based BMS player. Drop in a folder containing BMS / bmson charts and
                play them straight from the page. It comes with two skins, Synesthesia and Plain
                (Debug Menu → Built-in skin), and reads <strong>Lunatic Rave 2</strong> skins
                (<code>.lr2skin</code>) and <strong>beatoraja</strong> skins
                (<code>.json</code> / <code>.luaskin</code>) — drop your
                <code>LR2files</code> folder, or your beatoraja <code>skin/</code> folder, onto
                the page (alongside or before the chart drop) and the theme is applied
                automatically.
              </p>
              <ul class="help-about-meta">
                <li>
                  <span class="help-about-key">Author</span>
                  <a href="https://nulltask.dev" target="_blank" rel="noopener noreferrer">nulltask · nulltask.dev</a>
                </li>
                <li>
                  <span class="help-about-key">Source</span>
                  <a href="https://github.com/nulltask/be-music" target="_blank" rel="noopener noreferrer">
                    github.com/nulltask/be-music
                  </a>
                </li>
                <li>
                  <span class="help-about-key">Also available</span>
                  <span>A TUI build (terminal frontend) ships in the same monorepo as <code>@be-music/player-tui</code>.</span>
                </li>
              </ul>
              <ul class="help-about-notes">
                <li>
                  Dropped files stay entirely in your browser. Charts, audio, and BGA assets are
                  <strong>never uploaded to any server</strong>. Only with
                  <strong>Submit to Leaderboard</strong> on does a finished play send its replay
                  (your key presses and the chart's note layout) and a fingerprint of the chart to
                  the Leaderboard.
                </li>
                <li>Some features are still missing or incomplete — expect rough edges.</li>
                <li>
                  <strong>Best records stay in this browser.</strong> The Leaderboard (off by
                  default, Debug Menu → Leaderboard) is a beta: its rankings may be reset.
                </li>
                <li>
                  <strong>Verified skins:</strong> the Lunatic Rave 2 default skin, plus the
                  beatoraja default skin (<code>skin/default</code>),
                  <code>ModernChic</code>, and <code>GdbG Original Skin</code>. Other LR2 /
                  beatoraja skins parse and load, but their layout is unverified — expect element
                  overlap, off-by-a-few-pixels positioning, or missing animation frames on
                  third-party themes.
                </li>
                <li>Use at your own risk. No warranty is provided.</li>
              </ul>
            </section>
            <h3 class="help-section-title">Loading charts</h3>
            <ul class="help-list">
              <li>Drop a BMS folder anywhere on the page to register its charts.</li>
              <li>
                Drop an <code>LR2files</code> folder, or a beatoraja <code>skin/</code> folder
                (or their contents), to apply a skin theme.
              </li>
              <li>
                Or click <strong>Open folder</strong> in the Debug Menu (top-right) to use the native
                folder picker — same handling as a drag-drop, so a folder containing both an LR2 / beatoraja
                theme and BMS charts loads both in one shot. Press the button again to add another folder.
                <strong>Open files</strong> picks ZIP archives or a replay (<code>*.bmplay.json</code>) to replay.
              </li>
              <li>Subsequent drops add to the library and keep the current theme.</li>
              <li>
                Or link straight to a pack: open the page with
                <code>?music=https://…/song.zip</code> to auto-load a chart archive, and/or
                <code>?skin=https://…/theme.zip</code> to apply a skin — the charts are listed in this select
                screen. Cross-origin archive links are fetched through the demo proxy and must use HTTPS.
              </li>
            </ul>

            <h3 class="help-section-title">Chart select</h3>
            <ul class="help-list">
              <li><kbd>/</kbd> focuses the search input. Filter by title, artist, or genre.</li>
              <li><kbd>Esc</kbd> clears the search filter.</li>
              <li>Click a chart row, or click the active skin's <em>PLAY</em> button, to start.</li>
            </ul>

            <h3 class="help-section-title">Gameplay (default keys)</h3>
            <div class="help-keymap">
              <div class="help-keymap-row">
                <span class="help-keymap-side">1P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd>
                  <span class="help-keymap-sep">·</span>
                  <kbd>Z</kbd> <kbd>S</kbd> <kbd>X</kbd> <kbd>D</kbd> <kbd>C</kbd> <kbd>F</kbd> <kbd>V</kbd>
                </span>
              </div>
              <div class="help-keymap-row">
                <span class="help-keymap-side">2P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd> <span class="help-keymap-sep">·</span>
                  <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd> <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd>
                </span>
              </div>
              <div class="help-keymap-note">Left Shift = 1P scratch · Right Shift = 2P scratch · K = 2P 6th key.</div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> adjusts hi-speed.</li>
              <li><kbd>Space</kbd> pauses / resumes.</li>
              <li><kbd>F5</kbd> restarts the current chart.</li>
              <li><kbd>Esc</kbd> exits to the result screen (or back to chart select).</li>
              <li>Hold <kbd>Backspace</kbd> for 0.5 s to quit the play the same way (works in fullscreen on every browser).</li>
              <li>Double-click the playfield to enter or leave fullscreen. <kbd>Esc</kbd> leaves fullscreen first, then repeats the usual scene action. On Chrome / Edge, <kbd>Esc</kbd> keeps its usual scene action in fullscreen; hold <kbd>Esc</kbd> to leave fullscreen.</li>
            </ul>

            <h3 class="help-section-title">Result</h3>
            <ul class="help-list">
              <li><kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>Esc</kbd> returns to chart select.</li>
              <li><kbd>R</kbd> plays the same chart again right away with the same options.</li>
            </ul>

            <h3 class="help-section-title">Options &amp; recording</h3>
            <ul class="help-list">
              <li>
                The Debug Menu (top-right) holds loading, skin, play option, audio, and recording controls; rarely used
                and developer settings sit in its collapsed folders, which remember whether you left them open.
              </li>
              <li>
                Click <strong>Record gameplay video</strong> to capture the next play as a downloadable video (MP4 · H.264 unless <strong>Video format</strong> says otherwise) (requires
                MediaRecorder support — see Open source / browser checks).
              </li>
              <li>
                Open the active skin's <strong>PLAY OPTION</strong> panel during chart select to set per-side
                modifiers (Random / Mirror / Auto-scratch / hi-speed).
              </li>
            </ul>
          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <section class="help-about">
              <p class="help-about-summary">
                ブラウザ上で動作する BMS プレイヤーです。BMS / bmson が入ったフォルダをドロップするだけでそのまま再生できます。
                内蔵スキンはシナスタジア (Synesthesia) とプレーン (Plain) の 2 種類です (Debug Menu → Built-in skin)。
                <strong>Lunatic Rave 2</strong> のスキン (<code>.lr2skin</code>) と <strong>beatoraja</strong> のスキン (<code>.json</code> / <code>.luaskin</code>) も解釈するので、<code>LR2files</code> フォルダや beatoraja の <code>skin/</code> フォルダをページにドロップすれば既存のスキンをそのまま適用できます。
              </p>
              <ul class="help-about-meta">
                <li>
                  <span class="help-about-key">作者</span>
                  <a href="https://nulltask.dev" target="_blank" rel="noopener noreferrer">nulltask · nulltask.dev</a>
                </li>
                <li>
                  <span class="help-about-key">ソースコード</span>
                  <a href="https://github.com/nulltask/be-music" target="_blank" rel="noopener noreferrer">
                    github.com/nulltask/be-music
                  </a>
                </li>
                <li>
                  <span class="help-about-key">関連</span>
                  <span>同じモノレポに TUI 版 (<code>@be-music/player-tui</code>) も同梱されています。</span>
                </li>
              </ul>
              <ul class="help-about-notes">
                <li>
                  ドロップしたファイルはブラウザ内でのみ処理され、譜面・音声・BGA データを
                  <strong>サーバへ送信することは一切ありません</strong>。
                  <strong>Submit to Leaderboard</strong> をオンにしたときだけ、プレイ終了時にリプレイ (キー入力と譜面のノーツ配置) と譜面のフィンガープリントを Leaderboard に送ります。
                </li>
                <li>一部の機能はまだ実装されていません。動作が不完全な箇所があります。</li>
                <li>
                  <strong>ベスト記録はこのブラウザに保存されます。</strong>
                  Leaderboard (初期状態はオフ、Debug Menu → Leaderboard) はベータ版で、ランキングはリセットされることがあります。
                </li>
                <li>
                  <strong>動作確認済みのスキン:</strong> Lunatic Rave 2 デフォルトスキンに加え、beatoraja デフォルトスキン (<code>skin/default</code>)、<code>ModernChic</code>、<code>GdbG Original Skin</code> の四種類です。
                  これら以外の LR2 / beatoraja スキンも読み込み自体は可能ですが、レイアウトは未検証です。要素の重なり / 数ピクセル単位のズレ / 一部アニメーションの欠落などが残っている可能性があります。
                </li>
                <li>利用は自己責任でお願いします。本ソフトウェアは無保証で提供されます。</li>
              </ul>
            </section>
            <h3 class="help-section-title">譜面の読み込み</h3>
            <ul class="help-list">
              <li>BMS フォルダをページ上にドロップすると、その中の譜面が登録されます。</li>
              <li><code>LR2files</code> フォルダか beatoraja の <code>skin/</code> フォルダ (またはその中身) をドロップするとスキンが適用されます。</li>
              <li>
                右上 Debug Menu の <strong>Open folder</strong> ボタンからネイティブのフォルダ選択ダイアログも使えます。
                ドラッグ&ドロップと同じ処理経路を通るので、LR2 / beatoraja のテーマと譜面が同居したフォルダもまとめて読み込めます。
                ボタンを押し直せば別フォルダを追加で読み込めます。
                <strong>Open files</strong> では ZIP アーカイブやリプレイ (<code>*.bmplay.json</code>) を選べます。
              </li>
              <li>追加でドロップした場合、既存のライブラリに追加され、テーマも維持されます。</li>
            </ul>

            <h3 class="help-section-title">選曲画面</h3>
            <ul class="help-list">
              <li><kbd>/</kbd> で検索入力にフォーカス。タイトル / アーティスト / ジャンルで絞り込めます。</li>
              <li><kbd>Esc</kbd> で検索条件をクリア。</li>
              <li>譜面の行をクリック、または現在のスキンの <em>PLAY</em> ボタンで再生開始。</li>
            </ul>

            <h3 class="help-section-title">ゲームプレイ (デフォルトキー)</h3>
            <div class="help-keymap">
              <div class="help-keymap-row">
                <span class="help-keymap-side">1P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd>
                  <span class="help-keymap-sep">·</span>
                  <kbd>Z</kbd> <kbd>S</kbd> <kbd>X</kbd> <kbd>D</kbd> <kbd>C</kbd> <kbd>F</kbd> <kbd>V</kbd>
                </span>
              </div>
              <div class="help-keymap-row">
                <span class="help-keymap-side">2P</span>
                <span class="help-keymap-keys">
                  <kbd>Shift</kbd> <span class="help-keymap-sep">·</span>
                  <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd> <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd>
                </span>
              </div>
              <div class="help-keymap-note">左 Shift = 1P スクラッチ · 右 Shift = 2P スクラッチ · K = 2P 6 鍵。</div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> でハイスピード調整。</li>
              <li><kbd>Space</kbd> でポーズ / 再開。</li>
              <li><kbd>F5</kbd> で現在の譜面をリスタート。</li>
              <li><kbd>Esc</kbd> でリザルト画面 (または選曲画面) へ戻ります。</li>
              <li><kbd>Backspace</kbd> を 0.5 秒長押しでも同じようにプレイを中断します (どのブラウザでもフルスクリーン中に使えます)。</li>
              <li>プレイフィールドをダブルクリックするとフルスクリーンに入り / 解除します。<kbd>Esc</kbd> は先にフルスクリーンを解除し、もう一度押すと通常のシーン操作になります。Chrome / Edge ではフルスクリーン中も <kbd>Esc</kbd> は通常のシーン操作のままで、<kbd>Esc</kbd> 長押しでフルスクリーンを解除します。</li>
            </ul>

            <h3 class="help-section-title">リザルト</h3>
            <ul class="help-list">
              <li><kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>Esc</kbd> で選曲画面へ戻ります。</li>
              <li><kbd>R</kbd> で同じオプションのまま同じ譜面をすぐにもう一度プレイします。</li>
            </ul>

            <h3 class="help-section-title">オプションと録画</h3>
            <ul class="help-list">
              <li>
                右上 Debug Menu に読み込み / スキン / プレイオプション / オーディオ / 録画のコントロールがあります。あまり使わない設定や開発者向けの設定は折りたたまれたフォルダにあり、フォルダの開閉状態は記憶されます。
              </li>
              <li>
                <strong>Record gameplay video</strong> ボタンを押すと、次の再生を動画（<strong>Video format</strong> で選んだ形式、既定は MP4 · H.264）として録画してダウンロードできます (ブラウザが MediaRecorder に対応している必要があります — Open source / Browser checks を参照)。
              </li>
              <li>
                選曲画面で現在のスキンの <strong>PLAY OPTION</strong> パネルを開くと、Random / Mirror / Auto-scratch / hi-speed などのプレイヤー側モディファイアを設定できます。
              </li>
            </ul>
          </div>
        </section>
        <section
          class="help-modal-pane"
          id="help-pane-oss"
          role="tabpanel"
          aria-labelledby="help-tab-oss"
          tabindex="0"
          hidden
        >
          <p class="help-pane-intro">
            This player is built on the open source libraries listed below. Each entry shows the
            verbatim copyright / license text shipped with the package.
          </p>
          <ol class="help-oss-list" id="help-oss-list"></ol>
        </section>
      </div>
      <footer class="service-build-footer">${renderBuildInfo(
        typeof __BE_MUSIC_BUILD_TIME__ === 'string'
          ? { builtAt: __BE_MUSIC_BUILD_TIME__, revision: __BE_MUSIC_BUILD_REVISION__ }
          : undefined,
      )}</footer>
    </div>
  </div>
`;
