import { renderBuildInfo, renderServiceFooter } from '@be-music/service-web-theme';

function playBuildInfo(): { builtAt: string; revision: string } | undefined {
  return typeof __BE_MUSIC_BUILD_TIME__ === 'string'
    ? { builtAt: __BE_MUSIC_BUILD_TIME__, revision: __BE_MUSIC_BUILD_REVISION__ }
    : undefined;
}

/** Local play uses production siblings, matching `leaderboardLink`. A preview host stays on preview. */
function playHostname(): string {
  return typeof location === 'undefined' ? 'localhost' : location.hostname;
}

/**
 * Static HTML for the player shell — injected once into `#app` at boot via `app.innerHTML = PLAYER_APP_HTML`.
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
 *  - `#songs` / `#search` / `#stage` / `#loading-*` / `.shell` — looked up in `main.ts` as `PlayerWebElements`
 */
export const PLAYER_APP_HTML = `
  <div class="shell empty">
    <!--
      Hidden file input — triggered by the GUI's "Open folder"
      button. Tweakpane has no native file controller, so we
      forward a synthetic click to this hidden input from the
      function controller's handler. \`webkitdirectory\` makes the
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
      placeholder="Search title / artist / genre... (? for a filter)"
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

        Structured as three layers:
        - \`.drop-frame\`: subtle outer ring spanning the whole
          stage, lights up during a live drag.
        - \`.drop-card\`: centered glassmorphism panel hosting the
          actual content; hosts the entry / hover animations.
        - icon + title + subtitle for the hierarchy.
      -->
      <div class="drop">
        <div class="drop-frame"></div>
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
              <input class="input" type="checkbox" id="start-submit" />
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
        </div>
      </div>
    </div>
    <!--
      Leaderboard sign-in and sign-up, as on the Leaderboard's own pages:
      a passkey now, Google and Discord shown but in development. Opened
      from the start card's account row; wired by \`wireAccountDialogs\`
      (account-dialogs.ts).
    -->
    <dialog class="dialog account-dialog" id="leaderboard-sign-in" aria-labelledby="leaderboard-sign-in-title">
      <div class="account-dialog-body">
        <header>
          <h2 id="leaderboard-sign-in-title">Sign in</h2>
          <p>Use the passkey of your Leaderboard account.</p>
        </header>
        <section class="grid gap-3">
        <button type="button" class="btn w-full" data-account-dialog-action="sign-in">
          Sign in with a passkey
        </button>
        <div class="text-muted-foreground text-center text-xs" role="separator">or</div>
        <div class="account-providers">
          <button type="button" class="btn w-full whitespace-normal" data-variant="outline" disabled title="Sign in with Google is coming soon">
            <span class="inline-flex size-4"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg></span>
            Sign in with Google
            <span class="text-muted-foreground ms-auto text-xs">Coming soon</span>
          </button>
          <button type="button" class="btn w-full whitespace-normal" data-variant="outline" disabled title="Sign in with Discord is coming soon">
            <span class="inline-flex size-4"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg></span>
            Sign in with Discord
            <span class="text-muted-foreground ms-auto text-xs">Coming soon</span>
          </button>
        </div>
        <p class="text-destructive text-sm" data-account-dialog-status role="status" hidden></p>
        </section>
        <footer>
          <button type="button" class="btn" data-variant="link" data-account-dialog-action="open-sign-up">
            No account yet? Sign up
          </button>
          <button type="button" class="btn" data-variant="outline" data-account-dialog-action="close">Cancel</button>
        </footer>
      </div>
    </dialog>
    <dialog class="dialog account-dialog" id="leaderboard-sign-up" aria-labelledby="leaderboard-sign-up-title">
      <form class="account-dialog-body" method="dialog" data-account-sign-up-form>
        <header>
          <h2 id="leaderboard-sign-up-title">Create your account</h2>
          <p data-account-sign-up-lead>Pick a handle and a name. Your browser then makes a passkey for it.</p>
        </header>
        <div class="account-providers">
          <button type="button" class="btn w-full whitespace-normal" data-variant="outline" disabled title="Sign up with Google is coming soon">
            <span class="inline-flex size-4"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg></span>
            Sign up with Google
            <span class="text-muted-foreground ms-auto text-xs">Coming soon</span>
          </button>
          <button type="button" class="btn w-full whitespace-normal" data-variant="outline" disabled title="Sign up with Discord is coming soon">
            <span class="inline-flex size-4"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg></span>
            Sign up with Discord
            <span class="text-muted-foreground ms-auto text-xs">Coming soon</span>
          </button>
        </div>
        <div class="text-muted-foreground text-center text-xs" role="separator">or with a passkey</div>
        <label class="field">
          <span>Handle</span>
          <input
            class="input"
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
        <label class="field">
          <span>Name</span>
          <input class="input" name="displayName" required maxlength="64" autocomplete="nickname" />
          <small>Up to 32 characters, in any script. The rankings show it.</small>
        </label>
        <p class="text-destructive text-sm" data-account-dialog-status role="status" hidden></p>
        <footer>
          <span></span>
          <span class="account-dialog-buttons">
            <button type="button" class="btn" data-variant="outline" data-account-dialog-action="close">Cancel</button>
            <button type="submit" class="btn">Create passkey</button>
          </span>
        </footer>
      </form>
    </dialog>
    <!--
      "Drop a skin" — shown when the Debug Menu's Skin system is set to LR2 or
      beatoraja with none of that system loaded. A drop anywhere closes it, and
      the detected skin is confirmed before it is used. Filled by
      \`promptSkinDrop\` (ui/skin-drop-prompt.ts).
    -->
    <dialog class="dialog" id="skin-drop" aria-labelledby="skin-drop-title">
      <div class="grid justify-items-center gap-3 text-center">
      <svg class="drop-icon size-11" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 6 L24 30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        <path d="M14 22 L24 32 L34 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M10 38 L38 38" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.55" />
      </svg>
      <h2 class="drop-title" id="skin-drop-title">Drop an LR2 skin</h2>
      <p class="text-muted-foreground text-sm" data-skin-drop-hint></p>
      <footer>
        <button type="button" class="btn" data-variant="outline" data-skin-drop-cancel>Cancel</button>
      </footer>
      </div>
    </dialog>
    <dialog class="dialog account-dialog" id="skin-switch" aria-labelledby="skin-switch-title" aria-describedby="skin-switch-hint">
      <form method="dialog" class="account-dialog-body">
        <header>
          <h2 id="skin-switch-title">Use the dropped skin?</h2>
          <p id="skin-switch-hint">Switch to this skin? Cancel keeps your current skin. Charts in the drop will still be imported.</p>
        </header>
        <footer>
          <button type="submit" value="" class="btn" data-variant="outline" autofocus>Cancel</button>
          <span class="account-dialog-buttons">
            <button type="submit" value="lr2" class="btn" data-skin-family="lr2">Use LR2 skin</button>
            <button type="submit" value="beatoraja" class="btn" data-skin-family="beatoraja">Use beatoraja skin</button>
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
    <dialog class="dialog account-dialog" id="replay-missing" aria-labelledby="replay-missing-title" aria-describedby="replay-missing-hint">
      <form method="dialog" class="account-dialog-body">
        <header>
          <h2 id="replay-missing-title">Charts missing</h2>
          <p id="replay-missing-hint" data-replay-missing-hint></p>
        </header>
        <ul class="replay-missing-list" data-replay-missing-list></ul>
        <footer>
          <button type="submit" class="btn" autofocus>OK</button>
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
        <div class="loading-label" id="loading-label">Loading…</div>
        <div class="progress loading-bar"><span class="loading-bar-fill" id="loading-bar-fill"></span></div>
        <div class="loading-counter" id="loading-counter"></div>
      </div>
    </div>
    <!--
      Bottom-right floating Help button. Pinned so it stays
      reachable from every scene (select / gameplay / result)
      without having to compete with Tweakpane (top-right) or the
      search bar (bottom-left). Opens the unified Help dialog
      that hosts both the usage guide and the third-party
      attribution required by the libraries we ship.
    -->
    <button class="btn help-button" data-size="sm" data-variant="outline" id="help-button" type="button" aria-haspopup="dialog" aria-controls="help-modal">
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
    <a class="btn account-chip no-underline" data-size="sm" data-variant="ghost" id="account-chip" data-state="loading" href="https://leaderboard.be-music.app/" target="_blank" rel="noopener">
      <span class="account-chip-dot" aria-hidden="true"></span>
      <span class="account-chip-label" id="account-chip-label"></span>
    </a>
    <!--
      Touch play controls. Phones and tablets have no Space / Esc key, so
      during play a pause button sits in the top-left corner; while paused
      it shows Resume and Quit. Hidden on desktops and outside play.
    -->
    <div class="touch-controls" id="touch-controls">
      <button class="btn touch-control" data-size="icon" id="touch-pause" type="button" aria-label="Pause">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
      </button>
      <button class="btn touch-control touch-control--text" data-size="sm" data-variant="outline" id="touch-quit" type="button">Quit</button>
    </div>
    <!--
      Shown on phones held upright: the play field is laid out for
      landscape, so ask for a turn instead of shrinking it to a strip.
    -->
    <div class="rotate-hint" aria-live="polite">
      <div class="card rotate-hint-card gap-2 px-6 text-center">
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
      Help modal. Three tabs:
      - Usage: drag-drop instructions, keyboard shortcuts,
        gameplay keys and the result screen.
      - Options: the Debug Menu, every control in it, play
        options and recording.
      - Open source: build-time-resolved acknowledgement list
        (one card per npm dependency that ships in the runtime
        bundle, with verbatim LICENSE text).
      Hidden by default; toggled via the \`.visible\` class on
      the overlay.
    -->
    <div class="help-modal" id="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title" aria-hidden="true">
      <div class="help-modal-backdrop" id="help-modal-backdrop"></div>
      <div class="card help-modal-card gap-4 overflow-hidden p-6">
        <header class="help-modal-header">
          <div>
            <div class="help-modal-eyebrow">Help &amp; About</div>
            <h2 class="help-modal-title" id="help-modal-title">be-music player</h2>
          </div>
          <button class="btn help-modal-close" data-size="icon-sm" data-variant="ghost" id="help-modal-close" type="button" aria-label="Close">
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
            class="btn help-modal-tab is-active" data-size="sm" data-variant="ghost"
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
            class="btn help-modal-tab" data-size="sm" data-variant="ghost"
            id="help-tab-options"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="help-pane-options"
            data-pane="options"
          >
            Options
          </button>
          <button
            class="btn help-modal-tab" data-size="sm" data-variant="ghost"
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
              class="btn help-lang-toggle is-active" data-size="sm" data-variant="ghost"
              type="button"
              data-lang="en"
              aria-pressed="true"
            >
              English
            </button>
            <button class="btn help-lang-toggle" data-size="sm" data-variant="ghost" type="button" data-lang="ja" aria-pressed="false">
              日本語
            </button>
          </div>
          <div class="help-lang is-active" data-lang="en">
            <section class="help-about">
              <p class="help-about-summary">
                A browser-based BMS player. Drop in a folder containing BMS / bmson charts and
                play them straight from the page. It comes with three skins, Synesthesia, Plain and Native
                (Debug Menu → Skin &amp; display → Built-in skin), and reads <strong>Lunatic Rave 2</strong> skins
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
                  <span>A TUI build (terminal frontend) ships in the same monorepo as <code>@be-music/player-terminal</code>.</span>
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
                <strong>Open files</strong> picks ZIP archives or a replay (<code>*.bmplay.json</code>, or a course's <code>*.bmcourse.json</code>) to replay.
              </li>
              <li>Subsequent drops add to the library and keep the current theme.</li>
              <li>
                Course files in a dropped folder (LR2 <code>.lr2crs</code>, beatoraja course <code>.json</code>) list
                as course folders. Decide <strong>NEW COURSE</strong> in MY COURSES, MY DAN or MY NONSTOP to make your
                own; <strong>Course → My courses…</strong> in the Debug Menu renames, deletes and exports them.
              </li>
              <li>
                Or link straight to a pack: open the page with
                <code>?music=https://…/song.zip</code> to auto-load a chart archive, and/or
                <code>?skin=https://…/theme.zip</code> to apply a skin — the charts are listed in this select
                screen. Cross-origin archive links are fetched through the player proxy and must use HTTPS.
              </li>
            </ul>

            <h3 class="help-section-title">Chart select</h3>
            <ul class="help-list">
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> move the cursor, <kbd>Enter</kbd> opens a folder or starts the chart, and
                <kbd>Esc</kbd> / <kbd>Backspace</kbd> go back. Click a chart row, or the active skin's <em>PLAY</em>
                button, to start.
              </li>
              <li>
                <kbd>Space</kbd> opens the <strong>PLAY OPTION</strong> panel (built-in and LR2 skins); beatoraja skins
                also take <kbd>PageUp</kbd> / <kbd>PageDown</kbd>, <kbd>Home</kbd> / <kbd>End</kbd> and <kbd>R</kbd>
                (a random chart).
              </li>
              <li><kbd>/</kbd> focuses the search input. Filter by title, artist, or genre.</li>
              <li><kbd>Esc</kbd> clears the search filter.</li>
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
                  <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd> <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd> <kbd>,</kbd>
                </span>
              </div>
              <div class="help-keymap-note">
                Left Shift = 1P scratch · Right Shift = 2P scratch · 9-button (PMS) charts use Z S X D C F V G B.
              </div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> adjusts hi-speed.</li>
              <li>
                Lane covers (Plain, Native, Synesthesia and beatoraja skins): <kbd>PageUp</kbd> / <kbd>PageDown</kbd>
                move SUDDEN+, <kbd>Home</kbd> / <kbd>End</kbd> the LIFT, <kbd>H</kbd> switches HIDDEN+ and
                <kbd>J</kbd> / <kbd>K</kbd> move it; hold <kbd>Shift</kbd> for larger steps. A key that a lane of the
                chart uses stays a lane key.
              </li>
              <li>In AUTO play, a replay or a practice play, <kbd>←</kbd> / <kbd>→</kbd> seek 5 s back / forward.</li>
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

          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <section class="help-about">
              <p class="help-about-summary">
                ブラウザ上で動作する BMS プレイヤーです。BMS / bmson が入ったフォルダをドロップするだけでそのまま再生できます。
                内蔵スキンはシナスタジア (Synesthesia)、プレーン (Plain)、ネイティブ (Native) の 3 種類です (Debug Menu → Skin &amp; display → Built-in skin)。
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
                  <span>同じモノレポに TUI 版 (<code>@be-music/player-terminal</code>) も同梱されています。</span>
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
                <strong>Open files</strong> では ZIP アーカイブやリプレイ (<code>*.bmplay.json</code>、コースは <code>*.bmcourse.json</code>) を選べます。
              </li>
              <li>追加でドロップした場合、既存のライブラリに追加され、テーマも維持されます。</li>
              <li>
                ドロップしたフォルダに含まれるコースファイル (LR2 の <code>.lr2crs</code>、beatoraja のコースの <code>.json</code>) はコースのフォルダとして並びます。
                MY COURSES / MY DAN / MY NONSTOP の <strong>NEW COURSE</strong> を決定すると自分でコースを作れます。作ったコースの名前の変更・削除・書き出しは Debug Menu の <strong>Course → My courses…</strong> から行えます。
              </li>
            </ul>

            <h3 class="help-section-title">選曲画面</h3>
            <ul class="help-list">
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> でカーソル移動、<kbd>Enter</kbd> でフォルダを開くか譜面を開始、<kbd>Esc</kbd> / <kbd>Backspace</kbd> で戻ります。
                譜面の行をクリック、または現在のスキンの <em>PLAY</em> ボタンでも開始できます。
              </li>
              <li>
                <kbd>Space</kbd> で <strong>PLAY OPTION</strong> パネルを開きます (内蔵スキンと LR2 スキン)。beatoraja スキンでは <kbd>PageUp</kbd> / <kbd>PageDown</kbd>、<kbd>Home</kbd> / <kbd>End</kbd>、<kbd>R</kbd> (ランダムに譜面を選ぶ) も使えます。
              </li>
              <li><kbd>/</kbd> で検索入力にフォーカス。タイトル / アーティスト / ジャンルで絞り込めます。</li>
              <li><kbd>Esc</kbd> で検索条件をクリア。</li>
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
                  <kbd>B</kbd> <kbd>H</kbd> <kbd>N</kbd> <kbd>J</kbd> <kbd>M</kbd> <kbd>K</kbd> <kbd>,</kbd>
                </span>
              </div>
              <div class="help-keymap-note">左 Shift = 1P スクラッチ · 右 Shift = 2P スクラッチ · 9 ボタン (PMS) の譜面は Z S X D C F V G B。</div>
            </div>
            <ul class="help-list">
              <li><kbd>↑</kbd> / <kbd>↓</kbd> でハイスピード調整。</li>
              <li>
                レーンカバー (Plain / Native / Synesthesia と beatoraja スキン): <kbd>PageUp</kbd> / <kbd>PageDown</kbd> で SUDDEN+、<kbd>Home</kbd> / <kbd>End</kbd> で LIFT を動かし、<kbd>H</kbd> で HIDDEN+ を切り替え、<kbd>J</kbd> / <kbd>K</kbd> で動かします。<kbd>Shift</kbd> を押しながらだと大きく動きます。譜面のレーンに使われているキーはレーンの入力になります。
              </li>
              <li>AUTO プレイ、リプレイ、練習のプレイでは <kbd>←</kbd> / <kbd>→</kbd> で 5 秒戻る / 進むことができます。</li>
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

          </div>
        </section>
        <section
          class="help-modal-pane"
          id="help-pane-options"
          role="tabpanel"
          aria-labelledby="help-tab-options"
          tabindex="0"
          hidden
        >
          <!-- The language switch follows the Usage one: every \`.help-lang-toggle\` and \`.help-lang\` share one state. -->
          <div class="help-lang-switch" role="group" aria-label="Language">
            <button
              class="btn help-lang-toggle is-active" data-size="sm" data-variant="ghost"
              type="button"
              data-lang="en"
              aria-pressed="true"
            >
              English
            </button>
            <button class="btn help-lang-toggle" data-size="sm" data-variant="ghost" type="button" data-lang="ja" aria-pressed="false">
              日本語
            </button>
          </div>
          <div class="help-lang is-active" data-lang="en">
            <h3 class="help-section-title">Debug Menu</h3>
            <ul class="help-list">
              <li>
                Click <strong>Debug Menu</strong> at the top right to open the settings panel. Everyday folders start
                open; rarely used ones start closed, and each remembers whether you left it open.
              </li>
              <li>
                Every setting is remembered in this browser and restored on your next visit.
                <strong>Developer → Reset settings and reload</strong> returns them all to their defaults (your best
                records stay).
              </li>
              <li>
                Settings that shape a play (lane options, gauge, modifiers, judgment windows) are locked while it runs
                and apply from the next chart; hi-speed, volume and a few view settings change live.
              </li>
            </ul>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Top</h4>
              <p class="help-menu-note">Above the folders.</p>
              <dl class="help-menu-items">
                <dt>Status</dt>
                <dd>What the player is doing now (read-only).</dd>
                <dt>Open folder</dt>
                <dd>Picks a folder of charts and / or skins; handled like a drop.</dd>
                <dt>Open files (ZIP / replay)</dt>
                <dd>Picks chart ZIP archives, or a replay (<code>*.bmplay.json</code>, or a course's <code>*.bmcourse.json</code>) to watch.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Play options</h4>
              <p class="help-menu-note">Locked during a play unless noted. Options that only change the chart or the view (marked LR2, beatoraja or AC) work under every ruleset and run their source's algorithm; the judge rules come from Developer → Judgment windows. Items marked “Shown with …” say when they appear.</p>
              <dl class="help-menu-items">
                <dt>Auto play</dt>
                <dd>Plays the chart automatically. An AUTO play saves no record.</dd>
                <dt>Gauge</dt>
                <dd>The gauge you play on. The choices follow the rules picked in Developer → Judgment windows.</dd>
                <dt>Judge algorithm</dt>
                <dd>With beatoraja rules, which note a press is judged against when several are in reach: Combo (default), Duration or Lowest.</dd>
                <dt>Random 1P / Random 2P</dt>
                <dd>The lane option for each side. RANDOM and S-RANDOM run the rules' own algorithm; options from one source (R-RANDOM, SPIRAL, H-RANDOM, SCATTER and more) are offered under every ruleset and run that source's. CONVERGE follows the rules.</dd>
                <dt>H-RANDOM threshold BPM (beatoraja)</dt>
                <dd>The BPM whose 16th note counts as a too-fast repeat for H-RANDOM, ALL-SCR and the 7-to-9 scratch.</dd>
                <dt>Fixed key 1P / 2P (LR2; 0=default)</dt>
                <dd>The lane LR2 CONVERGE gathers notes on. 0 picks the mode default.</dd>
                <dt>Seed 1P / 2P (-1=random)</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules.</em> Fixes the seed of the lane random; -1 draws a new one each play.</dd>
                <dt>7-to-9 (beatoraja)</dt>
                <dd>Plays a 7KEY chart on nine lanes, in the chosen layout.</dd>
                <dt>7-to-9 scratch</dt>
                <dd>Where 7-to-9 puts scratch notes: Fixed, Avoid repeated hits or Alternate.</dd>
                <dt>Reuse previous arrangement</dt>
                <dd>Plays the same chart again with the last play's exact lanes, when that play had the same judge rules.</dd>
                <dt>New arrangement</dt>
                <dd>Drops the reused arrangement and resets both seeds to -1.</dd>
                <dt>Gauge auto-shift (beatoraja)</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules.</em> What happens when the gauge would fail: NONE, CONTINUE, SURVIVAL TO GROOVE, BEST CLEAR or SELECT TO UNDER.</dd>
                <dt>Lowest auto-shift gauge</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules.</em> The lowest gauge BEST CLEAR and SELECT TO UNDER may shift down to.</dd>
                <dt>Scroll (beatoraja)</dt>
                <dd>REMOVE draws the chart without its BPM and scroll changes; ADD adds random scroll changes. Judgment is unchanged.</dd>
                <dt>Scroll section lines / Scroll rate</dt>
                <dd><em class="help-menu-when">Shown with Scroll set to ADD.</em> For scroll ADD: how many bar lines each change lasts, and how strong it is.</dd>
                <dt>Mines (beatoraja)</dt>
                <dd>REMOVE takes the mines out; ADD RANDOM, ADD NEAR and ADD ALL add mines.</dd>
                <dt>DP flip</dt>
                <dd>Swaps the 1P and 2P sides of a double-play chart.</dd>
                <dt>Auto scratch 1P / 2P</dt>
                <dd>Plays that side's scratch notes for you.</dd>
                <dt>Long notes</dt>
                <dd>LEGACY NOTE turns charge notes into normal notes, LN REMOVE turns every long note into its head, and ADD LN / CN / HCN / ALL (beatoraja) make long notes.</dd>
                <dt>Battle</dt>
                <dd>Battle and conversion modes. BATTLE follows the rules (two-player play under LR2, one player on both sides under beatoraja and ????), ???? adds 2P PLAY, and BATTLE AS (beatoraja), D-BATTLE and SP TO DP (LR2) are offered under every ruleset.</dd>
                <dt>Gauge 2P</dt>
                <dd><em class="help-menu-when">Shown with Battle set to BATTLE (LR2) or 2P PLAY (????).</em> The second player's gauge.</dd>
                <dt>M-RAN 1P / 2P</dt>
                <dd><em class="help-menu-when">Shown with two-player play: Battle set to BATTLE (LR2) or 2P PLAY (????).</em> Mirrors that player's side after a RANDOM-type option.</dd>
                <dt>D-BATTLE scratch (LR2)</dt>
                <dd><em class="help-menu-when">Shown with Battle set to D-BATTLE.</em> Keeps scratch notes playable instead of turning them into background sound.</dd>
                <dt>EXTRA MODE (LR2)</dt>
                <dd>Turns background keysounds into extra notes, as LR2's EXTRA MODE does.</dd>
                <dt>EXTRA minimum level (LR2)</dt>
                <dd><em class="help-menu-when">Shown with EXTRA MODE (LR2) on.</em> How dense EXTRA MODE may get at least: LEVEL 1 to 3.</dd>
                <dt>LN MODE (beatoraja)</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules.</em> How a chart that leaves its long-note type open plays: LN, CN or HCN.</dd>
                <dt>CUSTOM JUDGE (beatoraja)</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules.</em> Scales the judgment windows with the rates below.</dd>
                <dt>Key / Scratch PGREAT, GREAT, GOOD % · LN margin %</dt>
                <dd><em class="help-menu-when">Shown with CUSTOM JUDGE on.</em> The width of each window for keys and scratches, and the long-note release margin.</dd>
                <dt>PRACTICE (beatoraja)</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules.</em> Plays a range of the chart again and again until Esc. A practice play saves no replay and no record.</dd>
                <dt>START TIME ms / END TIME ms</dt>
                <dd><em class="help-menu-when">Shown with PRACTICE on.</em> The range to practise, in chart milliseconds; 0 as the end means the chart's end.</dd>
                <dt>GAUGE TYPE / GAUGE CATEGORY / GAUGE VALUE</dt>
                <dd><em class="help-menu-when">Shown with PRACTICE on.</em> The gauge, its category and its starting value.</dd>
                <dt>JUDGERANK / TOTAL</dt>
                <dd><em class="help-menu-when">Shown with PRACTICE on.</em> The judge rank and TOTAL to practise with; 0 keeps the chart's.</dd>
                <dt>EXTRA depth (beatoraja) / EXTRA scratch</dt>
                <dd>beatoraja EXTRA: how many background keysounds per row become notes (0 is off), and whether scratch lanes get them.</dd>
                <dt>Long-note add rate (beatoraja)</dt>
                <dd><em class="help-menu-when">Shown with beatoraja rules and an ADD choice in Long notes.</em> How many of the notes become long notes, 0 to 1.</dd>
                <dt>A-SCR &amp; LEGACY NOTE (AC 34)</dt>
                <dd>One button for both Auto scratch sides and LEGACY NOTE.</dd>
                <dt>Sort / Key filter / Difficulty filter</dt>
                <dd>How the built-in and LR2 select screens order and filter the list.</dd>
                <dt>HS-FIX</dt>
                <dd><em class="help-menu-when">Hidden while CLASSIC, Normal or FLOATING HI-SPEED is on.</em> Keeps the scroll speed steady against a BPM: MAXBPM, MINBPM, AVERAGE, STARTBPM, or CONSTANT (LR2, offered under every ruleset).</dd>
                <dt>Display area info</dt>
                <dd>Keeps showing the cover length and green number at the cover edges: OFF, ON, SUDDEN+ ONLY or HID+/LIFT ONLY.</dd>
                <dt>Effect 1P / 2P</dt>
                <dd>The lane covers for each side: OFF, HIDDEN, SUDDEN or HID+SUD.</dd>
                <dt>Lane cover / Cover height</dt>
                <dd>LR2's lane cover, and how much of the lane it covers.</dd>
                <dt>BPM GUIDE (beatoraja)</dt>
                <dd>Shows upcoming BPM changes on the lanes.</dd>
                <dt>BPM change warning (AC)</dt>
                <dd>Shows <code>current » next</code> BPM in a box on the lanes for 2 seconds before each BPM change: blue when it speeds up, red when it slows down.</dd>
                <dt>LIFT 1P / 2P (beatoraja) · LIFT height</dt>
                <dd>Raises that side's judge line, and by how much. Changes live.</dd>
                <dt>Visual CONSTANT (beatoraja) · Note duration (ms) · CONSTANT fade (ms)</dt>
                <dd>Shows notes only for their last N ms before the judge line, with a fade at their edge.</dd>
                <dt>Auto judge timing</dt>
                <dd>Moves Judge timing by itself from your hits in a manual play: beatoraja's way after every hit, or LR2's by 1 ms every ten hits. LR2 SILENT also plays without the chart's sounds and BGA and hides the judgment.</dd>
                <dt>Judge timing (ms)</dt>
                <dd>Shifts when the notes are drawn, −500 to 500 ms. Input, audio and judgment stay as they are.</dd>
                <dt>Normal HI-SPEED (AC 32 measured) · Normal HS level</dt>
                <dd><em class="help-menu-when">The level shows with Normal HI-SPEED on.</em> Picks the speed from twenty levels measured on AC, instead of the Hi-speed slider.</dd>
                <dt>CLASSIC HI-SPEED · Classic speed</dt>
                <dd><em class="help-menu-when">The speed shows with CLASSIC HI-SPEED on.</em> Picks the speed from AC's eleven CLASSIC steps, 1.0 to 4.0.</dd>
                <dt>FLOATING HI-SPEED (AC 32 measured) · Floating speed</dt>
                <dd><em class="help-menu-when">The speed shows with FLOATING HI-SPEED on.</em> Keeps the green number while the covers move; Numpad 0 switches it during play.</dd>
                <dt>Fixed display area (AC 34)</dt>
                <dd>Ignores cover and LIFT changes during play; Enter twice restores the floating green number.</dd>
                <dt>Hi-speed</dt>
                <dd><em class="help-menu-when">Hidden while CLASSIC, Normal or FLOATING HI-SPEED is on.</em> The scroll speed. Changes live, like ↑ / ↓ during play.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Replay / ghost</h4>
              <p class="help-menu-note">Inside Play options.</p>
              <dl class="help-menu-items">
                <dt>Tempo · Hi-speed · SUDDEN+ / HIDDEN+ · LIFT</dt>
                <dd>When on, a replay uses what the recorded player had; when off, your own settings.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Tempo</h4>
              <dl class="help-menu-items">
                <dt>Enabled</dt>
                <dd>Turns the play tempo on.</dd>
                <dt>Tempo (%)</dt>
                <dd>How much faster or slower the chart plays. With the pitch following the tempo it changes live.</dd>
                <dt>Pitch</dt>
                <dd>Whether the pitch follows the tempo (as in LR2) or stays.</dd>
                <dt>Keep-pitch stretcher</dt>
                <dd>How the pitch is kept: WSOLA or Signalsmith Stretch.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Course</h4>
              <dl class="help-menu-items">
                <dt>Skip stage results</dt>
                <dd>Skips the result screen after each course stage.</dd>
                <dt>My courses…</dt>
                <dd>Renames, deletes and exports the courses you made.</dd>
                <dt>NONSTOP placement</dt>
                <dd>Stitches NONSTOP courses as intended, or exactly as LR2 does, quirks included.</dd>
                <dt>Table URL · Import table courses</dt>
                <dd>Imports the courses of a difficulty table from its URL; it is imported again on later visits.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Skin &amp; display</h4>
              <dl class="help-menu-items">
                <dt>Skin system</dt>
                <dd>Draws with the built-in, LR2 or beatoraja skin. Asks for a drop when none is loaded. Can change during a play.</dd>
                <dt>Built-in skin · Skin effects</dt>
                <dd>(Built-in tab) Synesthesia, Plain or Native, and how much animation they draw: Full, Reduced or Off.</dd>
                <dt>Skin settings</dt>
                <dd>(Built-in tab) The selected skin's own settings, with Reset to defaults.</dd>
                <dt>Load LR2 skin… · LR2 theme</dt>
                <dd>(LR2 tab) Loads an LR2 theme, and picks among the themes loaded.</dd>
                <dt>Load beatoraja skin… · Beatoraja skins</dt>
                <dd>(beatoraja tab) Loads beatoraja skins, and picks one per screen and key mode.</dd>
                <dt>Render resolution · Auto-detect resolution</dt>
                <dd>How sharply the canvas draws; lower it if the frame rate drops.</dd>
                <dt>Play layout</dt>
                <dd>Auto, Desktop or Touch (on-screen lanes and buttons).</dd>
                <dt>Judged notes</dt>
                <dd>Whether a judged note keeps scrolling until its time (as in LR2) or disappears.</dd>
                <dt>Toggle fullscreen</dt>
                <dd>Enters or leaves fullscreen.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Audio</h4>
              <dl class="help-menu-items">
                <dt>Mute · Master / Key sound / BGM (%)</dt>
                <dd>Silences the player, and sets each volume.</dd>
                <dt>Play in silent mode</dt>
                <dd>Plays sound with an iPhone's silent switch on (where the browser allows it).</dd>
                <dt>Peak gain (next play)</dt>
                <dd>From the next play, raises the volume so the loudest peak is near −3 dBFS.</dd>
                <dt>Compressor</dt>
                <dd>Evens out loud keysounds and BGM: turn it on, pick the stages, and tune each compressor (with a reset).</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Library &amp; records</h4>
              <dl class="help-menu-items">
                <dt>Music ZIP URL · Skin ZIP URL · Load from URLs</dt>
                <dd>Loads a chart or skin ZIP from a URL, as <code>?music=</code> / <code>?skin=</code> do.</dd>
                <dt>Auto-save replays</dt>
                <dd>Downloads each finished play's replay.</dd>
                <dt>Clear best records</dt>
                <dd>Deletes the best records kept in this browser (asks first).</dd>
                <dt>Local data…</dt>
                <dd>Shows what the player keeps in this browser: its localStorage keys, its IndexedDB databases (your courses, the replay slots) and how much space they use. It only reads; clear data from its own controls.</dd>
                <dt>BGA video transcode</dt>
                <dd>Whether BGA videos are converted with WebCodecs, and the size they are reduced to.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Capture</h4>
              <dl class="help-menu-items">
                <dt>● Record gameplay video · Video format</dt>
                <dd>Records the next play as a video to download, in the chosen format (MP4 · H.264 by default).</dd>
                <dt>📸 Screenshot</dt>
                <dd>Saves the screen as a PNG.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Leaderboard</h4>
              <dl class="help-menu-items">
                <dt>Submit to Leaderboard</dt>
                <dd>Sends each finished play to the Leaderboard (off by default).</dd>
                <dt>Account · Create passkey · Sign in with passkey · Sign out</dt>
                <dd>Shows who is signed in, keeps the account with a passkey, and signs in or out.</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Developer</h4>
              <dl class="help-menu-items">
                <dt>CPU workers</dt>
                <dd>How many workers load charts and stretch audio in parallel.</dd>
                <dt>Judgment windows</dt>
                <dd>The rules every play follows: LR2, beatoraja or ????. It decides the windows, gauges, options offered, and which best records the select screen shows.</dd>
                <dt>Auto pause on blur</dt>
                <dd>Pauses the play when the page loses focus.</dd>
                <dt>Show invisible notes</dt>
                <dd>Shows hidden keysound objects. Changes live; judgment is unchanged.</dd>
                <dt>FPS</dt>
                <dd>The frame rate graph.</dd>
                <dt>Reset settings and reload</dt>
                <dd>Returns every setting to its default and reloads; best records stay.</dd>
              </dl>
            </section>

            <h3 class="help-section-title">Options &amp; recording</h3>
            <ul class="help-list">
              <li>
                <strong>Play options</strong> hold the lane options (RANDOM, S-RANDOM, SCATTER and more), gauges, battle
                modes, chart modifiers, HS-FIX and lane covers, following LR2 or beatoraja as
                <strong>Developer → Judgment windows</strong> picks. A replay records the options it was played with.
              </li>
              <li>
                Click <strong>Record gameplay video</strong> to capture the next play as a downloadable video (MP4 · H.264 unless <strong>Video format</strong> says otherwise) (requires
                MediaRecorder support — see Open source / browser checks).
              </li>
              <li>
                The active skin's <strong>PLAY OPTION</strong> panel in chart select sets the same options (Random /
                Mirror / Auto-scratch / gauge / hi-speed and more).
              </li>
            </ul>
          </div>
          <div class="help-lang" data-lang="ja" hidden>
            <h3 class="help-section-title">Debug Menu</h3>
            <ul class="help-list">
              <li>
                右上の <strong>Debug Menu</strong> をクリックすると設定パネルが開きます。よく使うフォルダは最初から開いていて、あまり使わないフォルダは閉じています。フォルダの開閉状態は記憶されます。
              </li>
              <li>
                設定はすべてこのブラウザに記憶され、次に開いたときに元に戻ります。<strong>Developer → Reset settings and reload</strong> ですべて既定値に戻せます (ベスト記録は残ります)。
              </li>
              <li>
                プレイの内容を決める設定 (レーンのオプション、ゲージ、譜面の変更、判定) はプレイ中は変えられず、次の譜面から反映されます。ハイスピード、音量、一部の表示設定はプレイ中にも変えられます。
              </li>
            </ul>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">最上部</h4>
              <p class="help-menu-note">フォルダの上。</p>
              <dl class="help-menu-items">
                <dt>Status</dt>
                <dd>今の状態の表示 (読み取り専用)。</dd>
                <dt>Open folder</dt>
                <dd>譜面やスキンのフォルダを選んで読み込みます。ドロップと同じ扱いです。</dd>
                <dt>Open files (ZIP / replay)</dt>
                <dd>譜面の ZIP アーカイブ、または再生するリプレイ (<code>*.bmplay.json</code>、コースは <code>*.bmcourse.json</code>) を選びます。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Play options</h4>
              <p class="help-menu-note">特に書かない限りプレイ中は変えられません。譜面や表示を変えるだけのオプション (LR2・beatoraja・AC と付いたもの) はどのルールでも使え、その出典のアルゴリズムで動きます。判定のルールは Developer → Judgment windows で決まります。「…のときに表示」とある項目は、その条件で表示されます。</p>
              <dl class="help-menu-items">
                <dt>Auto play</dt>
                <dd>譜面を自動で演奏します。AUTO のプレイは記録に残りません。</dd>
                <dt>Gauge</dt>
                <dd>プレイに使うゲージ。選べる種類は Developer → Judgment windows のルールで変わります。</dd>
                <dt>Judge algorithm</dt>
                <dd>beatoraja のルールで、近くに複数のノーツがあるときにどれを判定するか。Combo (既定)、Duration、Lowest。</dd>
                <dt>Random 1P / Random 2P</dt>
                <dd>各サイドのレーンのオプション。RANDOM と S-RANDOM はルールのアルゴリズムで動きます。片方の出典にしかないもの (R-RANDOM、SPIRAL、H-RANDOM、SCATTER など) はどのルールでも選べ、その出典のアルゴリズムで動きます。CONVERGE はルールに従います。</dd>
                <dt>H-RANDOM threshold BPM (beatoraja)</dt>
                <dd>H-RANDOM、ALL-SCR、7-to-9 のスクラッチで、連打とみなす 16 分音符の BPM。</dd>
                <dt>Fixed key 1P / 2P (LR2; 0=default)</dt>
                <dd>LR2 の CONVERGE でノーツを集めるレーン。0 はモードの既定。</dd>
                <dt>Seed 1P / 2P (-1=random)</dt>
                <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> レーンのランダムのシード。-1 ならプレイごとに新しく決めます。</dd>
                <dt>7-to-9 (beatoraja)</dt>
                <dd>7 鍵の譜面を、選んだ配置で 9 レーンで遊びます。</dd>
                <dt>7-to-9 scratch</dt>
                <dd>7-to-9 でスクラッチのノーツをどこに置くか。Fixed、Avoid repeated hits、Alternate。</dd>
                <dt>Reuse previous arrangement</dt>
                <dd>前回のプレイ (同じルールで遊んだもの) とまったく同じ配置で、同じ譜面をもう一度遊びます。</dd>
                <dt>New arrangement</dt>
                <dd>再利用している配置をやめ、シードを両方 -1 に戻します。</dd>
                <dt>Gauge auto-shift (beatoraja)</dt>
                <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> ゲージが尽きたときの扱い。NONE、CONTINUE、SURVIVAL TO GROOVE、BEST CLEAR、SELECT TO UNDER。</dd>
                <dt>Lowest auto-shift gauge</dt>
                <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> BEST CLEAR と SELECT TO UNDER で下げてよい一番下のゲージ。</dd>
                <dt>Scroll (beatoraja)</dt>
                <dd>REMOVE は BPM やスクロールの変化をなくして描き、ADD はランダムなスクロールの変化を加えます。判定は変わりません。</dd>
                <dt>Scroll section lines / Scroll rate</dt>
                <dd><em class="help-menu-when">Scroll が ADD のときに表示。</em> スクロールの ADD で、変化ごとの小節線の数と、変化の強さ。</dd>
                <dt>Mines (beatoraja)</dt>
                <dd>REMOVE は地雷を取り除き、ADD RANDOM、ADD NEAR、ADD ALL は地雷を加えます。</dd>
                <dt>DP flip</dt>
                <dd>DP の譜面の 1P 側と 2P 側を入れ替えます。</dd>
                <dt>Auto scratch 1P / 2P</dt>
                <dd>そのサイドのスクラッチを自動で処理します。</dd>
                <dt>Long notes</dt>
                <dd>LEGACY NOTE はチャージノートを通常ノーツに、LN REMOVE はすべてのロングノートを始点だけにし、ADD LN / CN / HCN / ALL (beatoraja) はロングノートを作ります。</dd>
                <dt>Battle</dt>
                <dd>バトルと変換のモード。BATTLE はルールに従います (LR2 では 2 人プレイ、beatoraja と ???? では 1 人で両側)。???? には 2P PLAY もあります。BATTLE AS (beatoraja)、D-BATTLE、SP TO DP (LR2) はどのルールでも選べます。</dd>
                <dt>Gauge 2P</dt>
                <dd><em class="help-menu-when">Battle が BATTLE (LR2) か 2P PLAY (????) のときに表示。</em> 2 人目のゲージ。</dd>
                <dt>M-RAN 1P / 2P</dt>
                <dd><em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2) か 2P PLAY (????)) のときに表示。</em> RANDOM 系のオプションのあと、そのプレイヤーの側を左右反転します。</dd>
                <dt>D-BATTLE scratch (LR2)</dt>
                <dd><em class="help-menu-when">Battle が D-BATTLE のときに表示。</em> スクラッチを BGM にせず、叩くノーツのまま残します。</dd>
                <dt>EXTRA MODE (LR2)</dt>
                <dd>LR2 の EXTRA MODE のように、BGM のキー音をノーツに変えて増やします。</dd>
                <dt>EXTRA minimum level (LR2)</dt>
                <dd><em class="help-menu-when">EXTRA MODE (LR2) がオンのときに表示。</em> EXTRA MODE の最低の密度。LEVEL 1〜3。</dd>
                <dt>LN MODE (beatoraja)</dt>
                <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> ロングノートの種類を決めていない譜面を LN、CN、HCN のどれで遊ぶか。</dd>
                <dt>CUSTOM JUDGE (beatoraja)</dt>
                <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> 下の倍率で判定の幅を変えます。</dd>
                <dt>Key / Scratch PGREAT, GREAT, GOOD % · LN margin %</dt>
                <dd><em class="help-menu-when">CUSTOM JUDGE がオンのときに表示。</em> 鍵盤とスクラッチの判定ごとの幅と、ロングノートを離すときの余裕。</dd>
                <dt>PRACTICE (beatoraja)</dt>
                <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> 譜面の一部の範囲を Esc を押すまで繰り返します。練習のプレイはリプレイも記録も残しません。</dd>
                <dt>START TIME ms / END TIME ms</dt>
                <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習する範囲 (譜面のミリ秒)。終わりの 0 は譜面の最後。</dd>
                <dt>GAUGE TYPE / GAUGE CATEGORY / GAUGE VALUE</dt>
                <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> ゲージの種類、カテゴリ、開始時の値。</dd>
                <dt>JUDGERANK / TOTAL</dt>
                <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習で使う判定ランクと TOTAL。0 なら譜面の値。</dd>
                <dt>EXTRA depth (beatoraja) / EXTRA scratch</dt>
                <dd>beatoraja の EXTRA。1 行あたり何個の BGM のキー音をノーツにするか (0 でオフ) と、スクラッチにも置くか。</dd>
                <dt>Long-note add rate (beatoraja)</dt>
                <dd><em class="help-menu-when">beatoraja のルールで Long notes が ADD のどれかのときに表示。</em> ロングノートにする割合 (0〜1)。</dd>
                <dt>A-SCR &amp; LEGACY NOTE (AC 34)</dt>
                <dd>両サイドのオートスクラッチと LEGACY NOTE をまとめてオンにするボタン。</dd>
                <dt>Sort / Key filter / Difficulty filter</dt>
                <dd>内蔵スキンと LR2 スキンの選曲画面の並び順と絞り込み。</dd>
                <dt>HS-FIX</dt>
                <dd><em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は非表示。</em> BPM に合わせてスクロール速度を一定に保ちます。MAXBPM、MINBPM、AVERAGE、STARTBPM、CONSTANT (LR2。どのルールでも選べます)。</dd>
                <dt>Display area info</dt>
                <dd>カバーの長さと緑数字をカバーの端に表示し続けます。OFF、ON、SUDDEN+ ONLY、HID+/LIFT ONLY。</dd>
                <dt>Effect 1P / 2P</dt>
                <dd>各サイドのレーンカバー。OFF、HIDDEN、SUDDEN、HID+SUD。</dd>
                <dt>Lane cover / Cover height</dt>
                <dd>LR2 のレーンカバーと、その高さ。</dd>
                <dt>BPM GUIDE (beatoraja)</dt>
                <dd>これから来る BPM の変化をレーン上に表示します。</dd>
                <dt>BPM change warning (AC)</dt>
                <dd>BPM が変わる 2 秒前から、レーン上の箱に <code>今の BPM » 次の BPM</code> を表示します。速くなるときは青、遅くなるときは赤です。</dd>
                <dt>LIFT 1P / 2P (beatoraja) · LIFT height</dt>
                <dd>そのサイドの判定ラインを上げます。高さはプレイ中にも変えられます。</dd>
                <dt>Visual CONSTANT (beatoraja) · Note duration (ms) · CONSTANT fade (ms)</dt>
                <dd>ノーツを判定ラインに届く前の N ミリ秒だけ表示し、その境目をフェードさせます。</dd>
                <dt>Auto judge timing</dt>
                <dd>手で遊んだときの叩いたタイミングから、Judge timing を自動で調整します。beatoraja の方式は 1 打ごとに、LR2 の方式は 10 打ごとに 1 ミリ秒ずつ動かします。LR2 SILENT では譜面の音と BGA なしで遊び、判定も表示しません。</dd>
                <dt>Judge timing (ms)</dt>
                <dd>ノーツを描くタイミングをずらします (−500〜500 ミリ秒)。入力、音、判定はそのままです。</dd>
                <dt>Normal HI-SPEED (AC 32 measured) · Normal HS level</dt>
                <dd><em class="help-menu-when">レベルは Normal HI-SPEED がオンのときに表示。</em> Hi-speed のスライダーの代わりに、AC で実測した 20 段階から速度を選びます。</dd>
                <dt>CLASSIC HI-SPEED · Classic speed</dt>
                <dd><em class="help-menu-when">速度は CLASSIC HI-SPEED がオンのときに表示。</em> AC の CLASSIC の 11 段階 (1.0〜4.0) から速度を選びます。</dd>
                <dt>FLOATING HI-SPEED (AC 32 measured) · Floating speed</dt>
                <dd><em class="help-menu-when">速度は FLOATING HI-SPEED がオンのときに表示。</em> カバーを動かしても緑数字を保ちます。プレイ中はテンキーの 0 で切り替えます。</dd>
                <dt>Fixed display area (AC 34)</dt>
                <dd>プレイ中のカバーと LIFT の変更を受け付けません。Enter 2 回でフローティングの緑数字に戻します。</dd>
                <dt>Hi-speed</dt>
                <dd><em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は非表示。</em> スクロールの速さ。プレイ中の ↑ / ↓ と同じく、すぐ反映されます。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Replay / ghost</h4>
              <p class="help-menu-note">Play options の中。</p>
              <dl class="help-menu-items">
                <dt>Tempo · Hi-speed · SUDDEN+ / HIDDEN+ · LIFT</dt>
                <dd>オンならリプレイは録画したプレイヤーの設定で、オフなら自分の設定で再生します。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Tempo</h4>
              <dl class="help-menu-items">
                <dt>Enabled</dt>
                <dd>再生速度の変更を有効にします。</dd>
                <dt>Tempo (%)</dt>
                <dd>譜面を何 % 速く、または遅く再生するか。ピッチがテンポに従う設定なら、プレイ中にも変えられます。</dd>
                <dt>Pitch</dt>
                <dd>ピッチをテンポに合わせて変える (LR2 と同じ) か、保つか。</dd>
                <dt>Keep-pitch stretcher</dt>
                <dd>ピッチを保つ方法。WSOLA か Signalsmith Stretch。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Course</h4>
              <dl class="help-menu-items">
                <dt>Skip stage results</dt>
                <dd>コースのステージごとのリザルト画面を飛ばします。</dd>
                <dt>My courses…</dt>
                <dd>自分で作ったコースの名前の変更、削除、書き出し。</dd>
                <dt>NONSTOP placement</dt>
                <dd>NONSTOP のコースを意図どおりにつなぐか、LR2 の挙動 (不具合も含む) のとおりにつなぐか。</dd>
                <dt>Table URL · Import table courses</dt>
                <dd>難易度表の URL からコースを読み込みます。次に開いたときにも読み込みます。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Skin &amp; display</h4>
              <dl class="help-menu-items">
                <dt>Skin system</dt>
                <dd>内蔵、LR2、beatoraja のどのスキンで描くか。読み込んでいなければドロップを求めます。プレイ中にも変えられます。</dd>
                <dt>Built-in skin · Skin effects</dt>
                <dd>(Built-in タブ) Synesthesia、Plain、Native のどれを使うかと、演出の量 (Full、Reduced、Off)。</dd>
                <dt>Skin settings</dt>
                <dd>(Built-in タブ) 選んだスキンの設定。Reset to defaults で既定値に戻せます。</dd>
                <dt>Load LR2 skin… · LR2 theme</dt>
                <dd>(LR2 タブ) LR2 のテーマを読み込み、読み込んだテーマから選びます。</dd>
                <dt>Load beatoraja skin… · Beatoraja skins</dt>
                <dd>(beatoraja タブ) beatoraja のスキンを読み込み、画面とキーモードごとに選びます。</dd>
                <dt>Render resolution · Auto-detect resolution</dt>
                <dd>キャンバスを描く解像度。フレームレートが落ちるときは下げます。</dd>
                <dt>Play layout</dt>
                <dd>Auto、Desktop、Touch (画面のレーンとボタンで操作)。</dd>
                <dt>Judged notes</dt>
                <dd>判定したノーツを本来の時刻まで流す (LR2 と同じ) か、消すか。</dd>
                <dt>Toggle fullscreen</dt>
                <dd>フルスクリーンに入る / 出る。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Audio</h4>
              <dl class="help-menu-items">
                <dt>Mute · Master / Key sound / BGM (%)</dt>
                <dd>音を消します。また、それぞれの音量を決めます。</dd>
                <dt>Play in silent mode</dt>
                <dd>iPhone の消音モードでも音を鳴らします (ブラウザが対応している場合)。</dd>
                <dt>Peak gain (next play)</dt>
                <dd>次のプレイから、一番大きい音が −3 dBFS 近くになるよう音量を上げます。</dd>
                <dt>Compressor</dt>
                <dd>キー音と BGM の音量差をならします。オンにして段を選び、それぞれのコンプレッサーを調整できます (リセットあり)。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Library &amp; records</h4>
              <dl class="help-menu-items">
                <dt>Music ZIP URL · Skin ZIP URL · Load from URLs</dt>
                <dd><code>?music=</code> / <code>?skin=</code> と同じく、URL から譜面やスキンの ZIP を読み込みます。</dd>
                <dt>Auto-save replays</dt>
                <dd>プレイが終わるたびにリプレイをダウンロードします。</dd>
                <dt>Clear best records</dt>
                <dd>このブラウザのベスト記録を消します (確認があります)。</dd>
                <dt>Local data…</dt>
                <dd>プレイヤーがこのブラウザに保存しているもの (localStorage のキー、自作コースやリプレイスロットの IndexedDB データベース、使っている容量) を表示します。読むだけなので、データは消すための各操作から消してください。</dd>
                <dt>BGA video transcode</dt>
                <dd>BGA の動画を WebCodecs で変換するかと、縮小するサイズ。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Capture</h4>
              <dl class="help-menu-items">
                <dt>● Record gameplay video · Video format</dt>
                <dd>次のプレイを動画として録画してダウンロードします。形式は選べます (既定は MP4 · H.264)。</dd>
                <dt>📸 Screenshot</dt>
                <dd>画面を PNG で保存します。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Leaderboard</h4>
              <dl class="help-menu-items">
                <dt>Submit to Leaderboard</dt>
                <dd>プレイが終わるたびに Leaderboard へ送ります (既定はオフ)。</dd>
                <dt>Account · Create passkey · Sign in with passkey · Sign out</dt>
                <dd>サインイン中のアカウントの表示、パスキーでのアカウントの保存、サインインとサインアウト。</dd>
              </dl>
            </section>
            <section class="help-menu-folder">
              <h4 class="help-menu-folder-title">Developer</h4>
              <dl class="help-menu-items">
                <dt>CPU workers</dt>
                <dd>譜面の読み込みや音の伸縮を並列で行うワーカーの数。</dd>
                <dt>Judgment windows</dt>
                <dd>すべてのプレイが従うルール。LR2、beatoraja、????。判定の幅、ゲージ、選べるオプション、選曲画面に出すベスト記録が変わります。</dd>
                <dt>Auto pause on blur</dt>
                <dd>ページからフォーカスが外れたらプレイを一時停止します。</dd>
                <dt>Show invisible notes</dt>
                <dd>不可視オブジェクトを表示します。プレイ中にも切り替えられ、判定は変わりません。</dd>
                <dt>FPS</dt>
                <dd>フレームレートのグラフ。</dd>
                <dt>Reset settings and reload</dt>
                <dd>すべての設定を既定値に戻して再読み込みします。ベスト記録は残ります。</dd>
              </dl>
            </section>

            <h3 class="help-section-title">オプションと録画</h3>
            <ul class="help-list">
              <li>
                <strong>Play options</strong> には、レーンのオプション (RANDOM、S-RANDOM、SCATTER など)、ゲージ、バトル、譜面の変更、HS-FIX、レーンカバーがあります。<strong>Developer → Judgment windows</strong> で選んだ LR2 や beatoraja の仕様に従います。リプレイにはプレイしたときのオプションが記録されます。
              </li>
              <li>
                <strong>Record gameplay video</strong> ボタンを押すと、次の再生を動画（<strong>Video format</strong> で選んだ形式、既定は MP4 · H.264）として録画してダウンロードできます (ブラウザが MediaRecorder に対応している必要があります — Open source / Browser checks を参照)。
              </li>
              <li>
                選曲画面で現在のスキンの <strong>PLAY OPTION</strong> パネルからも、同じオプション (Random / Mirror / Auto-scratch / ゲージ / hi-speed など) を設定できます。
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
            This player is built on the open source libraries listed below. Each entry keeps the
            verbatim copyright / license text shipped with the package; open it to read.
          </p>
          <ol class="help-oss-list" id="help-oss-list"></ol>
        </section>
      </div>
      <footer class="service-build-footer">${renderBuildInfo(playBuildInfo())}</footer>
    </div>
  ${renderServiceFooter({
    current: 'play',
    hostname: playHostname(),
    className: 'service-page-footer',
    buildInfo: playBuildInfo(),
  })}
  </div>
`;
