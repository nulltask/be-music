[日本語](./0026-chart-authored-display-options.ja.md)

# 0026: Record effective chart display operations separately from user settings

## Context

The archived first-party nanasigroove manual defines HI-SPEED as visual spacing in the range 0.25–100, independently of audio tempo. Chart values exceed the engine and browser user-control limits. Native A6 ordering at one timestamp is not established by a simple last-line rule. The [research notes](../research/chart-authored-options.md) identify the primary manuals, legacy aliases, dynamic restrictions and missing native formulas.

Executing newly supported source IDs when loading an old replay could change its presentation or, for future option families, its judging. Recording compulsory values as user view changes also loses the underlying setting needed when a stage or seek clears the override.

## Decision

Compile resolved initial OPTION declarations and timed A6 references into a versioned `ChartOptionProgram`. Version 1 contains complete effective display snapshots at integer chart microseconds, rounding authored cue times to the nearest microsecond. Currently its only executable field is `hiSpeed`. Unknown IDs, malformed parameters, missing references and disallowed timed aliases produce structured diagnostics; they do not cancel preceding accepted operations.

Accept exact modern `774:HI-SPEED_x...` values from 0.25 through 100 with up to two decimal places. Initial legacy numeric HSP aliases are supported; old 0.2 uses the observed minimum 0.25. Legacy aliases remain invalid on A6. Keep whole vendor payloads and exact case; do not invent unprefixed aliases. Equal-time events execute in normalized IR order, later accepted operations winning. This is Be-Music policy, not a native ordering claim.

The engine publishes `PlayerUIFramePayload.chartOptions` on its authoritative chart clock. Pause holds state, seek uses stateless lookup, and reversal freezes at the reversal time. A final executable cue retains one chart second for presentation, unless practice specifies its own end. HI-SPEED changes no audio tempo, notes, judgments, score or rank eligibility. Courses' user speed locks do not suppress compulsory chart display operations.

Browser views use the authored factor directly, with no user clamp, HS-FIX, classic/floating conversion or animated transition. Keep the exact prior hi-speed state underneath and block conflicting user/host/replay speed edits until the override clears. Restore that prior state on clear; subsequent normal view updates resume. The terminal applies the exact factor to both its grid window and readout, without user-range clamping or a minimum authored grid-window floor. All four browser families consume the same scene state.

Record only accepted effective operations in optional `ReplayChart.chartOptions`, including their profile version. Strict replay parsing rejects unknown profile versions, fields, invalid values and unordered times. Playback uses this recorded program instead of recompiling source declarations. Browser playback of an older replay without a program explicitly supplies an empty one. User option/view snapshots retain the underlying user speed, while the chart program reproduces the override. Re-simulation ignores these visual operations; record eligibility and fingerprints remain unchanged.

NONSTOP stores the composed effective program in `NonstopStitchMap.chartOptions` and stage diagnostics in `chartOptionDiagnostics`. Browser hosts pass both automatically; Node gameplay-worker options retain both as plain structured data. Stage ownership uses exclusive microsecond windows. A trimmed start seeds the latest preceding source selection, and each new stage installs its own initial state, including an empty state that releases a previous override. FIT divides cue time by the stage rate without changing the authored spacing factor. Source reversal excludes later operations until that stage ends. Unsupported declarations retain stage, course time and source time in diagnostics.

The stitched replay records this whole effective program. Cutting out a stage rebases its owned cues by the stage offset, keeps the already FIT-scaled time, seeds the played window and releases compulsory state at a finite ownership end. The unplayed trimmed prefix carries no invented authored operation. Standalone flattened chart serialization does not retain the NONSTOP presentation sidecar; use the stitch map or recorded effective replay program.

## Consequences

Newly implemented source IDs cannot silently activate in an already recorded effective program. The UI can reproduce a compulsory value such as 0.77 or 100 without overwriting persistent user preferences. Empty effective states restore the user setting at NONSTOP stage boundaries.

HI-SPEED executes in ordinary and NONSTOP playback. Other option families, course conflict rules for judging modifiers and their record/replay policy remain tracked by #835. No native HIDDEN/CHANGE-HS/CRAZY formula or visual parity is claimed.
