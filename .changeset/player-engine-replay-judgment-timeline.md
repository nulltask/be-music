---
'@be-music/player-engine': minor
---

Add `resolveReplayJudgmentTimeline` to `@be-music/player-engine/replay`: it re-simulates a replay and lists every judgment in scoring order with its lane, note, time and the running combo, EX score and gauge. `simulateReplay` takes an `onJudgment` observer for the same events; observing changes nothing it derives. A replay ghost plays back from this timeline.
