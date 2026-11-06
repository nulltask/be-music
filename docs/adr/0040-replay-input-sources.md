[Japanese version](./0040-replay-input-sources.ja.md)

# 0040: Key scratch holds by a recorded input source

Status: accepted. Date: 2026-11-06. Supersedes the judging part of [ADR 0037](./0037-scratch-spin-input.md).

## Context

beatoraja remembers the physical key that started a scratch long note (`sckey` in `JudgeManager`, [`83574048`](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/JudgeManager.java#L351-L370)) and keys three rules by it: a press from another key ends a back-spin scratch (BSS) and judges its tail; a release of the starting key ends a BSS only when it would judge POOR ([L494-L511](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/JudgeManager.java#L494-L511)); and a scratch LN is let go only by the starting key ([L522-L531](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/JudgeManager.java#L522-L531)). ADR 0037 judged a BSS on a recorded spin (`'cw'` / `'ccw'`), which reproduces the first rule for a two-key scratch but not the other two, and it cannot tell two keys that spin the same way apart.

The owner decided (issue #605) that turntable directions, keyboard keys and controller buttons share one input-source model, meant for dedicated controllers such as PHENIXWAN, that a replay records no device-identifying data, and that the replay format needs no backward compatibility (it is still at revision 0).

The judge core, a replay and the replay simulator must reach the same judgments from the same recorded input, so the source has to be part of the input. Options considered:

1. **Keep the spin and add the release rules on top.** A spin is a direction, not an identity: two keyboard keys of one scratch lane that spin the same way could not be told apart, and the scratch LN rule needs the key itself.
2. **Record the raw key tokens and make them authoritative.** Tokens are host-specific spellings (`'ctrl-left'` and `'control-left'` are one key), a touch lane reuses its keyboard key's token, and a controller has no tokens.
3. **A source table per replay, referenced from every input.** `play.inputSources` lists each physical input once (`kind`, coarse `device`, normalised `label`, and a turntable's `direction`), and every input event names one by `source`.

## Decision

Model 3. Every `ReplayInputEvent` carries a required `source` integer into `play.inputSources`; `tokens` is dropped, and `spin` stays for display only. `parseReplay` checks unique ids, references that resolve and a `direction` on exactly the turntable sources, and rejects a log without sources rather than guessing one. `play.analogScratch` optionally names the algorithm a host used to turn an analog axis into presses; the log keeps the resulting events, never axis samples.

Each physical key bound to a lane is its own source (`keyboardInputSource`, named by its first token); each lane's touch zone is one; a controller passes its sources on the input commands. There is no Gamepad API input yet: the `source` field of the `lane-input` and `kitty-state` commands is the boundary a controller host plugs into.

The judge core and the simulator remember the head's source on a scratch hold. A press from another source ends a BSS under every ruleset that plays one (beatoraja's CN / HCN and every That-Which-Must-Not-Be-Named long note). Under beatoraja only (`RulesetConfig.scratchHoldsBySource`), a release of the head's source that would judge POOR ends a BSS there, and a scratch LN is let go only by its head's source. LR2 is unchanged.

**Single-source lanes play a lenient rule.** Strict rules would make every BSS unclearable on a lane with one source. Whether a source has a counterpart is a property of the source (`hasScratchCounterpart`): a turntable direction always has the other direction, and every keyboard scratch lane has at least two keys, so both play strict; a touch zone, a controller button and an unknown source play lenient, where any fresh press on the lane ends the BSS and a release settles nothing. Deciding it from the source rather than from the bindings keeps it knowable from the replay alone, so a live play and its re-simulation always agree.

## Consequences

Replays recorded before this change no longer parse, and the Leaderboard refuses them with `invalid-replay`; replays already stored there can no longer be re-read (the played-file backfill gives them no length). Scores change where beatoraja's rules now apply: a BSS let go far before its tail is a POOR, and a scratch LN survives another key's release. Lane holds and ANY KEY routes are keyed by source, so the live engine and its replays key them the same way. A controller host only has to name its sources; a lane bound to a single controller button plays the lenient rule, which a future binding table could make strict. A coarse `device` class can later split keyboard and controller rankings without collecting more data.
