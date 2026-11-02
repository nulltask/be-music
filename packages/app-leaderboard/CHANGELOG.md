# @be-music/app-leaderboard

## 0.5.0

### Minor Changes

- 647c240: A play or course run that one ruleset cannot judge (a gauge it does not define, or CUSTOM JUDGE outside beatoraja) is no longer refused or judged with the option dropped: that ruleset stores no figures, and the submission answers it in `notSimulated` with the reason. A play that used gauge auto-shift is judged under every ruleset along that ruleset's own gauge ladder. A run that ended where its gauge emptied is judged under another ruleset only up to that point; when that ruleset's gauge would have survived, its figures are stored as `outcome: 'truncated'`, move no personal best and stay out of the rankings and lists (ADR 0019, migration `0019`).

### Patch Changes

- c1d8b7e: The About page described anonymous auto-submit, Google and Discord as coming soon, ESC plays as unrecorded, report-based moderation, and every play ranking. It now says:
  
  - Submitting a play requires sign-in. A guest without a passkey stays anonymous in that browser, and rankings include anonymous plays only when anonymous players are turned on. Accounts can be created with a passkey, Google, or Discord.
  - Only plays that rank appear on all three rule rankings. A separate tempo, a single course stage, a bmson TOTAL 0 play with no recovery, and an unpublished course are stored but not ranked.
  - Auto play is not recorded. A failed play and an ESC quit are recorded, and an ESC quit ranks as a failed play. The leaderboard does not check for mechanical input.
- cf0df8c: Assisted plays are now classified by their options' sources rather than by AUTO SCRATCH and the judge-window override alone, and each ruleset's lamp follows that ruleset's assist rule. A `no-save` play (BATTLE under That-Which-Must-Not-Be-Named rules) is stored unranked as `no-save`, and a course run with an assisted stage is stored unranked as `assist`. LIGHT ASSIST EASY is stored as lamp rank 10 and shown between ASSIST EASY and EASY in bests, previous bests and lamp spreads. Results stored before this change are not recomputed.
- 9604a26: Submissions check a replay's chart-authored gameplay options:
  
  - A replay's `chart.chartPlayOptions` must match the gameplay options in the chart's play document, narrowed to the play (a course stage without NOTES COPY, none in a NONSTOP run); a mismatch is rejected with `chart-play-options-mismatch`, so a replay can no longer strip or add the chart's program.
  - A grade course run no longer fails its lane-lock check when a stage's chart forced its own arrangement, since the chart's option wins over the course lock.
- f3c4ac4: Google and Discord on the Leaderboard were disabled and labelled coming soon, so those buttons now start Accounts sign-in, and signing up with either provider returns to Settings.
- 9300c75: The Leaderboard header shows a Beta badge beside Be-Music Leaderboard, and the footer and About page say Public Beta and that data may be deleted without notice, in English and Japanese.
- 40f0575: Chart documents stored in R2 are gzip-compressed, the same way replays already are, and score cards gunzip them before reading the excerpt, still accepting plain JSON written earlier.
- Updated dependencies: `@be-music/chart-model@0.9.0`, `@be-music/player-engine@0.13.0`, `@be-music/service-auth-client@0.2.0`, `@be-music/service-web-theme@0.3.1`

## 0.4.0

### Minor Changes

- e8fe0d7: Update pages in place instead of loading a new page: the filter switches, the chart page's file choice and the ruleset menu now fetch the page with htmx 4 and morph only the page body and the header, so the scroll position and focus stay, the switch slides over and the body dims only while a slow answer loads. Filter URLs still go into the history, and Back restores them in place. Signing out, hiding or showing a play and saving the profile or icon update the page the same way instead of reloading it. Without the client script the links work as before.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-engine@0.12.0`, `@be-music/shared-utils@0.7.0`

## 0.3.0

### Minor Changes

- 2bbeded: Give course runs a share card: the run's own player's browser draws it (course name and kind, stages reached and trophy, DJ Rank, EX-Score, lamp, gauge, counts and the stage list with each stage's rate) and uploads it through `PUT /api/v0/course-scores/{id}/card`; the course run page links it as its `og:image` and Twitter card and offers the same share buttons as a play's page.
- 19a3a5b: Plays at another tempo, course stages sent on their own, course runs with a stage at another tempo and runs of unreleased courses are now stored instead of refused with 422: they are simulated and answered with `unranked` (rank and players 0), but move no personal best and stay out of the rankings, the figures and every list, and their page says why (#788). Migration `0017` adds the nullable `unranked` column to `score` and `course_score`.

### Patch Changes

- a83e326: Display `????` for the That-Which-Must-Not-Be-Named ruleset and use `____` in API values, rankings and score-card excerpt data.
- 69df53c: Rebuild and verify intended-placement NONSTOP submissions containing bmson stages with the shared stitching pipeline, including mixed BMS/bmson courses and their stage-specific judge ranks.
- 9474feb: A play's BP now counts the notes it never judged because it failed or was given up mid-way, under every ruleset, so a play that dies early no longer lowers a player's fewest BP. A single play given up with ESC is accepted and ranked as a failed play instead of being refused as `aborted`. BP stored before this change is left as it was.
- 17aebd5: Use the shared service footer on the Leaderboard, and keep About, Help, the API, GitHub and the beta notice in this site's own row.
- aeac0d3: Correct stored LR2 full-combo lamps and recompute best-lamp references from visible scores, preserving other rulesets, gauge measurements, EX scores and BP.
- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/chart-model@0.7.0`, `@be-music/service-web-theme@0.3.0`, `@be-music/shared-utils@0.6.0`, `@be-music/service-auth-client@0.1.2`

## 0.2.0

### Minor Changes

- 9a0c3f9: Use replay terminology for submission payloads, download endpoints, recording helpers, and stored references. Apply migration 0015 to rename the chart/course recording reference columns to `replay_key`; the previous payload fields and endpoint names are removed.
  
  Use judgment terminology consistently in ranking explanations and help text.
  
  Rename the package from `@be-music/leaderboard-api` to `@be-music/app-leaderboard` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- 325e7bb: Automatically reuse an existing Accounts login when opening Leaderboard pages, without requiring a separate sign-in click.
- ebff0e7: Display the fixed build timestamp and source revision in the service footer.
- Updated dependencies: `@be-music/service-auth-client@0.1.1`, `@be-music/chart-model@0.6.0`, `@be-music/player-engine@0.10.0`, `@be-music/service-web-theme@0.2.0`

## 0.1.0

### Minor Changes

- b2818d0: Provide the Leaderboard service with score verification, rankings and Japanese/English pages on its own production and preview hosts.
  
  - Verify chart and play fingerprints and re-simulate submitted play logs under the LR2, beatoraja and That-Which-Must-Not-Be-Named rulesets. Store replays, chart aliases, chartset associations and per-ruleset personal bests.
  - Rank complete course runs with stage validation, gauge carry-over and course fingerprints; keep course runs separate from single-chart scores.
  - Offer chart, player, score and course pages, score visibility controls, rivals, share cards and a generated OpenAPI reference.
  - Authenticate through Accounts OIDC with issuer-scoped identity mappings. Keep profiles as read projections retrieved from Accounts through a Service Binding or HTTPS, and direct profile/avatar editing to Accounts.
  - Keep the service's score data in its own D1 and R2 resources, independently for production and preview.
  
  Pages are served at the host root, the API at `/api/v0` and its reference at `/api-reference`. Profile projections refresh on the owner's authenticated requests. Existing player IDs and scores survive the Accounts migration; legacy authentication records are cleared after migration.

### Patch Changes

- Updated dependencies: `@be-music/service-auth-client@0.1.0`, `@be-music/chart-model@0.5.0`, `@be-music/player-engine@0.9.0`
