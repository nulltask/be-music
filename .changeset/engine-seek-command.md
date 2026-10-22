---
'@be-music/player-engine': minor
---

Seeking is a play-loop command: a `{ kind: 'seek', seconds }` input command moves a running AUTO play to another chart second without starting it again, and `startAtSeconds` is now the play's first seek. The engine keeps the last seek of each drain, moves the audio (the new optional `AudioSession.seek`, the volume changes and the sounds still ringing there) and re-bases chart time on the play clock (`TempoClock.rebase`; a paused play stays paused), and rebuilds the judge state from the chart's start, so the score, gauge, combo and max combo match a play from the start. The UI gets a `seek` command with a snapshot of the summary and the judgments before the target, the long notes held across it again, and a frame at the target. Frames carry a seek `generation` and the `clock` their chart time holds at, the summary carries `combo` and `maxCombo`, and a play that seeks records no replay.
