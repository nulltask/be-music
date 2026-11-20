[Japanese version](./player-runtime.ja.md)

# Player runtime behavior

[Shared player specification](./player-spec.md)

<details>
<summary>Table of contents</summary>

- [Behavior by mode](#behavior-by-mode)
  - [`AUTO`](#auto)
  - [`MANUAL`](#manual)
  - [`AUTO SCRATCH`](#auto-scratch)
- [Time control and interrupts](#time-control-and-interrupts)
  - [`speed`](#speed)
  - [Seek](#seek)
  - [`highSpeed`](#highspeed)
  - [pause / restart / interrupt](#pause--restart--interrupt)
- [Audio processing](#audio-processing)
  - [Play timing](#play-timing)
  - [Volume separation](#volume-separation)
  - [`#VOLWAV`](#volwav)
  - [`#xxx97` / `#xxx98`](#xxx97--xxx98)
  - [BGM headroom control](#bgm-headroom-control)
  - [Long stop](#long-stop)
- [UI and display](#ui-and-display)
  - [UI runtime](#ui-runtime)
  - [Visualization rules](#visualization-rules)
  - [Negative BPM — LR2 reverse scroll](#negative-bpm--lr2-reverse-scroll)
  - [Non-TUI output](#non-tui-output)
- [`PlayerSummary`](#playersummary)

</details>

## Behavior by mode

### `AUTO`

`AUTO` judges every playable note without looking for a manual input candidate or applying a judgment window. Tap notes receive one `PERFECT` at their scheduled time. LN-style long notes receive one at the tail, and charge notes receive one at the head and one at the tail.

Pause, resume, restart, and hi-speed controls remain available.

### `MANUAL`

`MANUAL` selects the most appropriate candidate note within the `BAD` window from the set of lanes corresponding to the input token.
If there are no candidates, the runtime may play the latest same-lane keysound whose early `BAD` window has already opened, then applies LR2-compatible empty POOR unless, without key-state input, the press falls before the tail of a long note played on that lane.
It does not play the next pending lane keysound before that note's judgment window opens.

In manual input, objects that pass the `BAD` window without any note input are automatically set to `POOR`.
Invisible notes are not included in this miss judgment.

### `AUTO SCRATCH`

`AUTO SCRATCH` is a derivative of `MANUAL`.
Only the notes on the scratch playable channel are automatically processed, and the rest are subjected to normal manual judgment.

## Time control and interrupts

### `speed`

`speed` is the speed at which in-game time progresses.
Both `AUTO` and `MANUAL` are used to convert seconds on the musical score to real time.

`speed` is the tempo at the start. A host can change it during the play with the `{ kind: 'tempo', tempo }` input command.
The engine re-anchors its clock at the chart time it drains the command (`createTempoClock`), so chart time stays continuous and runs at the new tempo from then on.
It records the change in the replay (`play.tempoChanges`), calls `AudioSession.setTempo` and reports the change through `onTempoChange`.
Judgments and recorded inputs stay in chart time, so a re-simulation is unaffected.
A replay follows its log's changes when the host passes them as `replayTempoChanges`.
The Node audio adapter renders its audio for the starting tempo and does not follow a change.

### Seek

A host moves a running play to another chart second with the `{ kind: 'seek', seconds }` input command; `startAtSeconds` is a play's first seek ([ADR 0016](./adr/0016-seek-play-loop-command.md)).
The engine keeps the last seek of each drain and applies it at its next tick, clamped to the chart; during the lead-in it sets where the chart starts.
The audio session stops what plays (`AudioSession.seek`), the volume changes before the target apply again and the sounds still ringing there start partway (`AudioSession.triggerEventAt`).
Chart time re-bases on the play clock at the tempo in force, so a paused play stays paused.
The judge state becomes the one a play from the start reaches at the target: the score, the gauge, the combos and the notes' judged marks are rebuilt from 0.
The UI gets a `seek` command, the long notes held across the target again and a frame at the target with the next `generation`; the hold after the chart is re-armed.
A play that seeks records no replay.
AUTO play, manual play and replays all seek: manual play starts its judge state again at the target, and a replay rebuilds it by running the recorded inputs up to the target.

### `highSpeed`

`highSpeed` is a display parameter that primarily changes the visible range and scrolling density of the TUI.
The judgment window itself cannot be changed.
The runtime normalizes high-speed values with `resolveHighSpeedMultiplier` from `@be-music/player-engine/signals`.
Valid values range from `0.5` to `10.0` and snap to `0.5` increments.

### pause / restart / interrupt

The player can handle input events for pause/resume, restart, and high-speed changes.
During pause, the playback clock and audio session are stopped at the same time, and resume restarts them both.

`escape` returns the current `summary` and exits.
`ctrl-c` and `restart` raise `PlayerInterruptedError` and have exit codes of `130` and `0`, respectively.

## Audio processing

### Play timing

Real-time playback uses the resolved chart's trigger sequence (`ResolvedChart.sampleTriggers`, built by `collectSampleTriggers()`) from the score after branch resolution.
Clamp the playback time so that it does not become negative.

### Volume separation

`playVolume` applies to the sound on the playable lane side.
`bgmVolume` applies to the other BGM side.

### `#VOLWAV`

BMS's `#VOLWAV` is treated as the volume multiplier for the entire score.
If omitted, the default value is `100`. The effective gain is `bms.volWAV / 100` when `0 < bms.volWAV < 200` and `1` otherwise, as in beatoraja (LR2 ignores `#VOLWAV`).

- `#VOLWAV 100`: Keep the original volume
- `#VOLWAV 150`: `1.5` times the original volume
- `#VOLWAV 0`, `#VOLWAV 200` or above: Keep the original volume

This scaling factor applies to keysound for real-time playback, song selection screen preview, and offline audio rendering using `renderJSON()`.
The actual device applies only linear gain and does not reproduce player- or hardware-dependent volume differences.

### `#xxx97` / `#xxx98`

BMS's `97` / `98` channels are treated as bus volume automation during play.
`97` corresponds to the BGM side, `98` corresponds to the playable/key side, and converts the value `01-FF` to a gain of `value / 255`.

- `#xxx97`: Update the volume on the BGM side
- `#xxx98`: Update the volume on the playable/key side
- `FF`: Original volume
- `00`: No event is generated because it is an empty token.

The player applies `97` / `98` before the sample trigger at the same time.
Therefore, if the same beat is pronounced as volume change, the new volume will be used when pronouncing it.

This change only affects the initial gain of newly triggered notes from that point on.
Voices that are already playing will not be changed. If CLI's `playVolume` / `bgmVolume` or `#VOLWAV` exists, apply them by multiplying them.

The reason for this interpretation is that if the PCM gain is changed instantly during playback, discontinuous steps are likely to occur, which can easily be heard as clicks or unstable volume changes.
Also, since `#xxx98` can be read as a command close to the pronunciation conditions of a playable/key sound, it is easier to understand the correspondence between the implementation and the result if you interpret it as ``change the initial gain of the sound that will be played afterward.''

### BGM headroom control

When `limiter === false`, enable BGM headroom control for auto mix.
In this mode, while maintaining the amplitude of the playable/key-sound side, only the BGM side is reduced to the extent that the peak after addition does not clip.

### Long stop

If the retention expires with manual long note, the playback sound of the corresponding channel will be stopped.
With `LNMODE=3`, the gauge continues to decrease even during hold break.

## UI and display

### UI runtime

The player body is independent of the UI implementation and notifies the state through `stateSignals` and `uiSignals`.
Judgment/combo, frame information, POOR BGA, lane flash, and lane hold indication are communicated via this signal.
The UI command queue also carries long-note lifecycle commands: `long-note-start` (with `mode`: `ln` / `cn` / `hcn`, the mode the active ruleset actually plays the note in, which can differ from the chart's `#LNMODE`) when a hold begins, and `long-note-end` (with `outcome`: `complete` / `dropped`) when it finishes.
A hell charge note (an HCN, a hell-charge back-spin scratch included) also sends `hell-charge` (with its `channel`, the head's `beat` and `state`) from the judge core each time its gauge ticks switch: `gaining` while the lane gains, `draining` while it does not (let go early, or the head missed: a press makes it gain again), and `passed` once its end point has passed. Only a switch is sent, and a replay sends the same commands as the play it records; a seek sends the state of each hell charge note passing the judge line after the held long notes. AUTO and AUTO SCRATCH lanes send none, since their notes always gain.
A seek pushes `seek` (with its `generation`, the `seconds` sought and a `snapshot`: the summary, the combo, the max combo and every judgment before the target) after dropping the commands and judge cues still queued.
Every frame carries its seek `generation` (0 until the first seek) and the `clock` its chart time holds at (`outputSeconds` of the audio session's output clock, `tempo`, `paused`), and the summary carries `combo` and `maxCombo`.

`PlayerOptions.onRulesetResolved` is called once before playback starts with a `PlayerRulesetInfo` (`id`, `rulesetId`, `longNoteStyle`, and the judge `windows` in µs at the start of the chart), so a host can show the windows the engine actually uses instead of re-deriving them.

Conditional bmson BGA state is carried on `PlayerUIFramePayload.bmsonBGA`: the active image filename, layer/POOR plane, trigger time and source-frame start time. The engine derives it from actual judgments using [ADR 0022](./adr/0022-bmson-bga-events.md). The terminal worker forwards it as the optional third argument to `BgaANSIRenderer.getANSILines` / `getKittyImage`, preserving source alpha and movie timing through the existing compositor. Browser Native/Canvas/LR2/beatoraja consume the same state through their BGA stacks, preload every alternative and retain independent base/layer/POOR video handles. NONSTOP sequence placement remains pending in #826.

The [terminal player notes](./player-tui.md) cover loading, Music Select, and TUI rendering.

### Visualization rules

Even on judged notes, drawing will remain until the judge line is crossed or the `visibleUntilBeat` expires.
A long note is drawn as a single note with a body and tail lane, and the highlight continues while being held.
The visual distance of a note is determined by the integral of the piecewise-constant coefficient of `#SCROLLxx` / `#xxxSC` multiplied by the piecewise-linear interpolation coefficient of `#SPEEDxx` / `#xxxSP`. If there is no `#SPEEDxx`, it is always `1`, and multiple keyframes with the same beat are the last to win. Before the first keyframe, the coefficient ramps linearly from `1` at beat 0 to the first keyframe's value, as beatoraja ramps from 1.0 at time 0 (a keyframe at beat 0 applies at once; Bemuse instead holds the first value). If the value of `#SPEEDxx` is a negative number, a non-number, or an undefined reference, that keyframe will be ignored from drawing calculations.

### Negative BPM — LR2 reverse scroll

A negative `#BPMxx` referenced through channel 08 (truncated to an integer first, so `-1 < BPM < 0` does not count) arms LR2's one-way reverse-scroll gimmick (issue #134; the LR2 basis and the documented deviations live in [`bms-spec.md`](./bms-spec.md)):

- Timing stays monotonic: the resolver integrates |BPM|, so every note keeps a forward `seconds` and audio scheduling is unaffected before the reversal.
- From the reversal on, the engine publishes `displayBeat = 2 × beat(reversal) − beat(now)` on the UI frame — a mirror in chart-position space, as LR2 draws it. The TUI grid and the web scenes scroll from it, so the chart visibly runs backwards at the post-reversal tempo (pausing through post-reversal STOPs, following later BPM changes, continuing past beat zero) while the status clock and summary stay on the true clock.
- Presses keep being judged on the mirrored clock `t' = 2 × reversal − now`: notes around the reversal stay hittable just after it, empty POORs fire while the lane's next note is within the ruleset's empty-POOR reach of `t'`, and there is no miss sweep past the reversal. A hold spanning the reversal BADs on release and stays open otherwise. Mines freeze at the reversal; a press at the reversal instant itself still detonates a mine within its PGREAT reach.
- Realtime audio freezes with LR2's event pump: BGM / keysound triggers behind the reversal never fire, while BGM and BGA on the reversal tick itself still do (LR2's op order). BGA cues stop changing; a movie that is already playing keeps running. NOWBPM holds `|trunc(BPM)|` of the negative value.
- After reversal, live play waits for an exit. Outstanding scorable notes drain the gauge on exit. The replay records both the event time and the update that mirrored judgment and drawing.

### Non-TUI output

If TUI is disabled, the mode start message, lane assignment, judgment log, and final result are output as text.
`renderSummary()` formats the result in the following order: `TOTAL / GAUGE / PGREAT / GREAT / GOOD / BAD / POOR / EMPTY / FAST / SLOW / EX-SCORE / SCORE`.
`EMPTY` is the empty-POOR count. The `SCORE` line is printed only under the `lr2` ruleset, the only one that defines a money score.

## `PlayerSummary`

`PlayerSummary` is the final playback result.
The main items are:

- `total`
- `perfect`
- `fast`
- `slow`
- `great`
- `good`
- `bad`
- `poor`
- `emptyPoor`
- `exScore`
- `score`
- `gauge`

`gauge` includes `current` / `max` / `clearThreshold` / `initial` / `effectiveTotal` / `cleared`, plus `type` (the
ruleset-scoped gauge id), `survival`, and `failedMidPlay`.
