---
'@be-music/chart': patch
---

Fingerprint charts with many `#RANDOM` / `#SWITCH` outcomes faster (about 15-20% on the heaviest charts tried): each outcome's notes were diffed against the whole top-level lane through a map of freshly built keys. The top-level keys are now built once, and the runs an outcome shares with the top level at a lane's start and end are skipped before counting the rest. The fingerprints are unchanged (checked on 5,537 real charts and 900 generated `#RANDOM`-heavy charts against the previous implementation).
