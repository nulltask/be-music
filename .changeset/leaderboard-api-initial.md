---
'@be-music/leaderboard-api': minor
---

Add the Leaderboard API on Cloudflare Workers, an Internet Ranking that counts the score itself from the key presses in a play log:

- Play-log submission (`POST /api/v0/scores`) checks the log (`checkPlaylogEligibility`: manual, not aborted, at the original tempo, not a course stage, with both fingerprints), verifies its chart and play fingerprints against the fingerprint documents sent with it, and re-simulates the play under the `lr2`, `beatoraja` and `iidx` rulesets, lamped by the same clear-lamp rule as the client's result (a DEATH clear under `lr2` is a NORMAL clear, as in LR2; a chart without notes takes its gauge's lamp). A play at another tempo is refused with a 422 `tempo`, as practice.
- Charts are keyed by their chart fingerprint, keep the file hashes a play log carries (SHA-256, and the MD5 LR2 and LR2IR use) as aliases, and are grouped into chartsets, the charts of one work, as BMS Search files them by file hash (looked up after a submission and re-checked by an hourly Cron Trigger).
- Personal bests per ruleset and per-chart rankings, the play logs kept in R2 as replays, and a player can hide a play (`PATCH /api/v0/scores/:id` with `{ hidden }`), which takes it out of the rankings, bests, figures and lists and answers 404 to anyone else.
- The API is served at `/api/v0` (the beta, which may still change incompatibly) as a versioned sub-app, so a stable `/api/v1` can sit next to it; unknown paths under `/api` answer a JSON `404`. Its OpenAPI 3.1 document, generated from the valibot schemas that validate the requests, is at `/api/v0/openapi.json`, with an API reference page at `/leaderboard/api`.
- The schema is in the D1 migrations `0000`-`0012`. The Worker deploys with `cf`, with a preview environment (`cf deploy --mode preview`, `db:migrate:preview`) shared by every branch but `devel`, and its secrets come from 1Password references (`secrets/*.env.tpl`, set with `pnpm run secrets:<environment>`).
