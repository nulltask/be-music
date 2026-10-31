[日本語](./0025-chart-text-playback.ja.md)

# 0025: Chart text follows engine time and judgment effects

## Context

The [TEXT command observations](https://hitkey.nekokan.dyndns.info/cmds.htm#TEXTXX) describe pomu's channel `99` selection, empty or undefined selections clearing text, and nanasigroove's `TEXT00` miss text. They do not establish a complete miss-display lifetime or a rule for every interaction with chart playback. Merely preserving the definitions leaves text invisible; treating `99` as a sound channel can also play an unrelated WAV slot.

## Decision

Resolve ordinary selections through chart-model's `buildChartTextTimeline` and `pickChartText`. The engine publishes the selected plain string as optional `PlayerUIFramePayload.chartText`. Missing or empty frame values clear the host display. Text has no effect on judgments, score, replay inputs or sound triggers.

Use these Be-Music presentation rules where native behavior is unspecified:

- Before the first channel-99 selection, ordinary text is empty. `TEXT00` is only a miss override, never initial text.
- The actual judge effects that trigger or clear POOR BGA also drive the miss override. It lasts 0.5 chart seconds, with an exclusive end, or until an earlier clear effect. Absent `TEXT00` leaves ordinary text intact; explicitly empty `TEXT00` temporarily hides it.
- Channel `99` continues updating the underlying selection during a miss. Clearing or expiry restores the selection at the current chart time.
- Pause holds both selection and miss lifetime. Manual seek discards live miss history; AUTO and replay seek reconstruct it from silent judge effects. A fresh play owns fresh state.
- Negative-BPM reversal freezes selection and miss state at its reversal time and ignores later judgment inputs.
- Without a practice-range override, the final executable text cue keeps the chart open until at least one chart second after its selection, including a final clear. This lets hosts present cues after the last note.

Browser native, Canvas, LR2 and beatoraja views share a pointer-transparent overlay, with literal text rather than HTML. It wraps within 90% of the stage width and fits within 30% of its height. The terminal uses a reserved, width-clipped `TEXT` row; line breaks and terminal controls cannot alter its screen layout. These placements are Be-Music UI policy, not native-player layout parity.

## Consequences

Text state uses the same chart clock and judgment history across hosts. No timer or replay schema extension is needed. Original definitions, quotes and unknown directives remain unchanged when writing source charts. Historical `#SONGxx` policy remains tracked by #837. NONSTOP retains every stage’s source timeline and miss definition in `NonstopStitchMap.chartText`; hosts pass it as `PlayerOptions.chartTextStages`. Browser hosts wire it automatically, and Node gameplay-worker play options carry it across the worker boundary. The exclusive stage window selects its own text program, including a selection before a trimmed start. Empty stages clear the preceding text. Miss inputs belong to the stage at the actual judgment time and cannot cross a boundary. FIT maps the course clock back to the source clock, so the miss lifetime is 0.5 source-chart seconds; source reversal freezes that stage only until its window ends. AUTO/replay seek reconstructs the appropriate stage’s history. These are Be-Music composition rules. The plain program is structured-cloneable and replay restitching rebuilds it, but a flattened chart alone does not serialize per-stage text behavior.
