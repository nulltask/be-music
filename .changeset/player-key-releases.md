---
'@be-music/player': minor
---

Judge input without key releases (a terminal without the kitty keyboard protocol) the same way live, in its replay and in re-simulations. Its play log used to hold only presses, so a replay held every key forever and took every key repeat as a new press.

- The engine infers when each key came up: a hold grace after each press (380 ms after a long note's head, 120 ms otherwise), extended by the key's repeats. It judges the release at that instant and records it as an `up` marked `inferred: true` (`PlaylogInputEvent.inferred`, accepted by `parsePlaylog` on an `up` only, and the fifth argument of `PlaylogRecorder.recordInput`). The mark is diagnostic only: replays and the simulators read such a release like any other.
- Judging changes a little for such input: a lapsed hold is judged at the instant it lapsed instead of at the next frame, by the ruleset's release rules (beatoraja's release margin included); a charge note let go after its tail is judged by that release instead of as a POOR; the repeats of a held long note press nothing else; a mine sees a lane down for as long as its key is held.
- `PlayerInputRuntime.reportsKeyReleases` lets an input runtime declare before the play that it reports key releases, and a manual play then judges it as key-state input from its first key. Until now the engine found that out only when the first `kitty-state` command arrived, so the first press of every play went through the inference. A runtime that leaves it out (or sets `false`) is detected as before.
- Fix presses on a lane after its long note was let go never charging an empty POOR until the note's tail: the terminal key-repeat workaround also ran for key-state input and replays, where LR2 and beatoraja judge every press. With key-state input, the very first key of a play also no longer loses a Hell Charge note's gain until the next key event.
