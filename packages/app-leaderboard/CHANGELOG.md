# @be-music/app-leaderboard

## 0.1.0

### Minor Changes

- b2818d0: Provide the Leaderboard service with score verification, rankings and Japanese/English pages on its own production and preview hosts.
  
  - Verify chart and play fingerprints and re-simulate submitted play logs under the LR2, beatoraja and IIDX rulesets. Store replays, chart aliases, chartset associations and per-ruleset personal bests.
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
