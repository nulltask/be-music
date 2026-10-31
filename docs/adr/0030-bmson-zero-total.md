[日本語](./0030-bmson-zero-total.ja.md)

# 0030: Make bmson zero-total recovery an explicit play policy

## Context

The bmson 1.0.0 specification says that `info.total: 0` disables lifebar increase. Native beatoraja substitutes its default TOTAL instead. HARD and class gauges can recover independently of TOTAL, so setting effective TOTAL to zero alone does not implement the specification. The [research](../research/bmson-zero-total.md) records the primary sources and the original corpus: zero appears in 0/28 bmson files and 0/2,748 charts overall.

Changing the default would reinterpret existing replays and mix unlike gauge rules in personal bests. Damage formulas, stage carry and ranking policy are player decisions outside the bmson specification.

## Decision

Add `bmsonTotalMode: 'beatoraja' | 'spec'` to per-play settings. The default remains `beatoraja`. Browser Play options exposes **bmson TOTAL 0**; terminal accepts `--bmson-total-mode spec`. The choice applies to every judge ruleset and skin family. It does not change chart content or chart/play fingerprints.

| Input after normalization           | Compatibility mode          | Spec mode                 |
| ----------------------------------- | --------------------------- | ------------------------- |
| Percentage TOTAL 0                  | Existing default recovery   | Disable positive recovery |
| Positive percentage TOTAL           | Existing percentage scaling | Same                      |
| Absolute BMS TOTAL 0                | Existing fallback           | Same                      |
| Explicit PRACTICE TOTAL replacement | PRACTICE rules              | PRACTICE rules            |

The parser already supplies missing TOTAL as 100 and converts negative native bmson values to their absolute value. Direct ruleset facts and typed replays must contain normalized nonnegative percentages in spec mode; malformed negative percentages are rejected. Legacy replay parsing and compatibility mode retain their old behavior.

Apply no-recovery after constructing the final active, fallback and parallel-bank gauge tables, including class and PRACTICE gauges. Clamp each positive judgment delta to zero and mark `GaugeSpec.recoveryDisabled`; `RulesetGauge` also suppresses positive raw deltas and positive scaled deltas. Negative judgment deltas, released-HCN damage, mines, guts, floor, border and failure latches retain their existing rules. Effective TOTAL remains the compatibility default for damage scaling and diagnostics. This damage policy is a Be-Music decision, not native parity.

Course carry and PRACTICE start HP are initial conditions and remain unchanged. An explicit PRACTICE TOTAL, including zero, replaces the source policy and follows existing PRACTICE arithmetic. With no replacement, a percentage-zero source disables recovery. Zero-note charts use finite guarded arithmetic and existing clear/failure rules. A staged course resolves each stage independently; a stitched NONSTOP play uses its one selected TOTAL and explicit units, with no stage-local zero transitions.

## Replay and records

Record the optional typed `play.bmsonTotalMode` and validate its enum. The replay simulator and browser replay playback use the recorded value. Absence always means `beatoraja`, even when the viewer currently selects spec mode; generic `play.options` cannot override typed judging fields.

Affected manual plays remain supported and replayable. Their submissions are stored and simulated with `unranked: 'bmson-total'`, without ordinary ranking, personal-best or local best-record updates. A staged course containing any affected played stage, or a NONSTOP run whose selected TOTAL is affected, follows the same rule. An opt-in with positive TOTAL is a no-op and remains comparable. Existing tempo, standalone-stage and unreleased-course reasons keep their precedence when multiple exclusions apply. The database already stores these reasons as unrestricted nullable text, so extending the application enum requires no data migration.

Replay downloads remain available. Automatic replay-slot saving retains its existing requirement that a play may keep a score. Future separate comparison categories can admit these plays without rewriting their chart fingerprints.

## Verification

Cover normalized/native inputs, all gauge families, fixed recovery, HCN rates, mine/raw deltas, fallback and parallel gauges, carry, PRACTICE precedence, zero notes, typed replay validation, legacy defaults, live/simulation agreement, local records and stored-unranked server responses. Use authored zero-total fixtures because the original corpus contains no such chart. Reread all 28 original bmson files, verify their hashes and compare default/spec rules without altering source files.
