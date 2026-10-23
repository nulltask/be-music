# @be-music/app-leaderboard

## 0.2.0

### Minor Changes

- 9a0c3f9: Use replay terminology for submission payloads, download endpoints, recording helpers, and stored references. Apply migration 0015 to rename the chart/course recording reference columns to `replay_key`; the previous payload fields and endpoint names are removed.
  
  Use judgment terminology consistently in ranking explanations and help text.
  
  Rename the package from `@be-music/leaderboard-api` to `@be-music/app-leaderboard` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- 325e7bb: Automatically reuse an existing Accounts login when opening Leaderboard pages, without requiring a separate sign-in click.
- ebff0e7: Display the fixed build timestamp and source revision in the service footer.
- Updated dependencies [325e7bb]
- Updated dependencies [dca9a2f]
- Updated dependencies [9a0c3f9]
- Updated dependencies [ebff0e7]
  - @be-music/service-auth-client@0.1.1
  - @be-music/chart-model@0.6.0
  - @be-music/player-engine@0.10.0
  - @be-music/service-web-theme@0.2.0

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

- Updated dependencies [b2818d0]
  - @be-music/service-auth-client@0.1.0
  - @be-music/chart-model@0.5.0
  - @be-music/player-engine@0.9.0
