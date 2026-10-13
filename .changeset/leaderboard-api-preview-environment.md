---
'@be-music/leaderboard-api': patch
---

Rename the staging environment to preview (`cf deploy --mode preview`, `db:migrate:preview`), shared by every branch but `devel`. Secrets now come from 1Password references (`secrets/*.env.tpl`) and are set with `pnpm run secrets:<environment>`, which uses `cf` only.
