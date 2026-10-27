---
'@be-music/player-engine': minor
---

A running play can seek without starting again: a `{ kind: 'seek', seconds }` input command moves an AUTO play, a replay or a manual play to another chart second, and `startAtSeconds` starts a play there as its first seek. The engine rebuilds the judge state from the chart's start (AUTO and replays judge the notes before the target again, a manual play skips them without scoring), so the score, gauge, combo and max combo match a play from the start. It restores the long notes held across the target and the sounds still ringing there through the audio session's new optional `seek` and `triggerEventAt(event, offsetSeconds)`, applies the volume changes and recorded tempo changes before it, re-bases chart time on the play clock (`TempoClock.rebase`), keeps a paused play paused, and clamps a given-up replay to its recorded end.
The UI gets a `seek` command with a snapshot of the summary and the judgments before the target, the long notes held across it and a frame at the target. Frames carry a seek `generation` and the `clock` their chart time holds at, and the summary carries `combo` and `maxCombo`.
A play that seeks records no replay. A course run that seeks becomes practice while keeping its stage progression and its gauge and combo carry (course stage outcomes are kept apart from replays), and a practice course exports no replay.
`waitForStart` holds chart time and audio until a `{ kind: 'start' }` command, so a host can prepare the engine during loading and pick the seek position before the chart starts.
