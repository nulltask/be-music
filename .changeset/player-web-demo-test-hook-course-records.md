---
'@be-music/player-web-demo': patch
---

The test hook (`window.__beMusicTest`) never reported a course bar's best lamp or trophy: it looked the course up in the raw record store, while records are kept under the judge ruleset they were played on. It now reads the current ruleset's records, as the select screen does, so a course bar reports the lamp and trophy the screen shows.
