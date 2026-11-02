[日本語](./0037-scratch-spin-input.ja.md)

# 0037: Judge a back-spin scratch's tail on a recorded scratch spin

## Context

A back-spin scratch (BSS) is a charge note (CN / HCN) on a scratch lane. On a turntable it is spun one way at the head and the other way at the tail. beatoraja models the turntable as two keys per scratch lane and judges the tail when the key other than the one that hit the head goes down ("BSS終端処理" in `JudgeManager`); a release of the scratch is ignored unless it falls in the tail's POOR range. Be-Music judged a BSS like any charge note, on the release, and the second scratch key (Ctrl, or Option / Alt in a macOS terminal) was only an alias of the lane (issue #940).

The owner decided that a BSS tail is judged on a reverse spin under the rulesets that judge a long note's tail — beatoraja's CN / HCN and every That-Which-Must-Not-Be-Named long note — while LR2 keeps playing every long note as an LN; that a keyboard uses odd-even (the scratch lane's keys alternate as the two directions); and that a controller reporting rotation uses its actual direction.

The judge core, the replay and the replay simulator must reach the same judgments from the same recorded input, so the reverse spin has to reach all three as input. Three models were possible:

1. **Derive the direction in the judge from the key tokens.** Replays already record tokens, but they are diagnostic: a host may name its keys differently, a touch lane sends the first token of a lane, and a controller's direction is not a key at all. The judge would also have to know the bindings.
2. **Split each scratch lane into two input channels** (beatoraja's model). Every lane map, the any-key routing, the replay's `channels` and every lane option would need a second scratch channel per side.
3. **Record the direction on the press.** The input layer decides the direction once — the controller's reported rotation, or the keyboard's odd-even key — and the press carries it as a separate field.

## Decision

Model 3. A scratch press carries `spin: 'cw' | 'ccw'` (`ScratchSpin`): on the engine's `lane-input` command (a controller sets it), on the judge core's `press` input and in the replay's input event (`ReplayInputEvent.spin`, only on a `down`). For a key the engine takes the spin from the odd-even rule: `LaneBinding.inputKeys` lists a scratch lane's physical keys in order (Shift, then Ctrl or Option / Alt), and `createScratchSpinByToken` gives the keys at even positions `'cw'` and those at odd positions `'ccw'`. A press without a spin (a touch lane, an old replay) never reverses a BSS.

`isBackSpinScratch(playedMode, scratch)` (a charge mode, as the ruleset plays it, on a scratch lane) marks the long note when its head is hit, with the head's spin. Then, in both the judge core and the simulator:

- a press on the lane spinning the other way judges the tail at once against the long-scratch-end windows (POOR outside them, no release margin);
- a press spinning the same way is a re-press;
- a release settles nothing — a hell-charge BSS's gauge ticks still follow whether the lane is down;
- a tail never spun back is a missed POOR once its late window closes.

beatoraja's exception for a release in the tail's POOR range is not reproduced: Be-Music's long-note-end windows have no POOR leg, and a release is simply ignored.

## Consequences

Replays carry the spin, so a replay and a re-simulation reproduce a BSS exactly, and a later ruleset fix re-scores it. A replay recorded before this change has no spin, so a BSS in it is scored as a missed tail; the format is still at revision 0 and older replays need not keep their scores. Charts with scratch CN / HCN now need the reverse spin under beatoraja and That-Which-Must-Not-Be-Named, which changes the scores of the engine's characterization fixtures and of the regression corpus scenarios (which now spin back at each scratch long note's tail). A host with a turntable or an analog axis only sets `spin` on its presses; no host has a controller input path yet. The keyboard needs no new default key: each scratch already had a second one.
