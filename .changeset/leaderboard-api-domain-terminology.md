---
'@be-music/app-leaderboard': minor
---

Use replay terminology for submission payloads, download endpoints, recording helpers, and stored references. Apply migration 0015 to rename the chart/course recording reference columns to `replay_key`; the previous payload fields and endpoint names are removed.

Use judgment terminology consistently in ranking explanations and help text.

Rename the package from `@be-music/leaderboard-api` to `@be-music/app-leaderboard` to identify its role consistently. Update imports and package filters to the new name.
