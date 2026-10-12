---
'@be-music/player-web': patch
---

Hide notes, mines and bar lines whose time has passed under beatoraja's drawing rules (charts with `#SCROLL` / `#SPEED`, and charts judged under the `beatoraja` ruleset), judged or not, as beatoraja does. A note a negative `#SCROLL` carried back above the line no longer lingers there until its miss, and a note under a STOP that began on it no longer sits on the line. A long note stays while its end is still ahead, with its head on the judgement line once the head has passed.
