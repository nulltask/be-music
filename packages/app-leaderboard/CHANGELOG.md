# @be-music/app-leaderboard

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
