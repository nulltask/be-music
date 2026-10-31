[日本語](./bmson-zero-total.ja.md)

Implemented policy: [ADR 0030](../adr/0030-bmson-zero-total.md). The repository observations below refer to the research baseline.

# Optional bmson zero-TOTAL semantics

Research for #837, checked 2026-10-31 against Be-Music `c3b783a5`. This note proposes an opt-in playback policy; it does not change the existing beatoraja-compatible default.

## Specification and native behavior

The [official bmson specification, pinned revision](https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst#information-object-bmsoninfo) defines `info.total` as relative lifebar gain: missing means 100, negative values become their absolute value, and zero disables increase. Default gain and damage interpretation depend on the player. Consequently, zero does not require resetting the gauge, suppressing damage, or guaranteeing a clear. The specification does not prescribe course carry, gauge selection, ranking, or a damage formula for zero.

The upstream [BMSONDecoder](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java) assigns TOTAL only when positive; otherwise it warns. Its [BMSModel](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSModel.java) starts at 100 with BMSON units. Thus decoded zero does not reach gameplay as zero. Be-Music already preserves zero and normalizes negative values in its parser, so negative-input behavior also differs from this upstream decoder.

[BMSPlayerRule.validate](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/BMSPlayerRule.java) converts a positive bmson percentage into its default absolute TOTAL and substitutes that default for nonpositive input. Default TOTAL is `max(260, 7.605*N/(0.01*N+6.5))` for beat/popn modes and `max(300, 7.605*(N+100)/(0.01*N+6.5))` for keyboard modes. Both are finite at `N=0`.

[GrooveGauge](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/GrooveGauge.java) applies TOTAL modifiers to gauge tables and updates parallel gauges. Its TOTAL modifier divides positive deltas by note count; its HARD recovery modifier also divides by note count. Neither expression guards zero notes. Native behavior at zero notes therefore must not be copied as a finite arithmetic contract. Course construction selects class tables and restores previous-stage gauge histories; it does not make chart TOTAL an instruction to erase carried HP.

[GaugeProperty](https://github.com/exch-bms2/beatoraja/blob/83574048ba489082eb46df7fe9806b464bf1f526/src/bms/player/beatoraja/play/GaugeProperty.java) contains positive recovery independent of TOTAL: class and HAZARD tables have no modifier, and LR2 HARD uses a damage-only modifier. Merely returning absolute TOTAL zero cannot implement the specification across all gauges. For example, seven-key CLASS gains 0.15 on PGREAT and LR2 HARD gains 0.1 before any zero-specific policy.

## Original corpus

The 28 bmson paths in the existing [audit manifest](./format-feature-usage.json) were reread from `~/Downloads/bms/BMS_Starter_Pack` and sibling `gdbg_bms_package_20xx` packages. All 28 SHA-256 values match the manifest. Counts below describe original JSON values before parser normalization; denominator is files, not notes.

| Original `info.total` | Files | Of 28 bmson files |
| --------------------- | ----: | ----------------: |
| Zero                  |     0 |             0.00% |
| Negative              |     0 |             0.00% |
| Missing               |     0 |             0.00% |
| Null or invalid type  |     0 |             0.00% |
| Exactly 100           |    15 |            53.57% |
| Other positive value  |    13 |            46.43% |

The positive-value distribution is `61×1, 78.9×1, 95.3×1, 100×15, 135×1, 155×2, 160×1, 165×1, 170×1, 200×1, 235×1, 255×1, 270×1`. Zero is also **0/2,748 charts overall (0.00%)**. The corpus provides no positive zero-TOTAL example; authored fixtures are necessary to verify the opt-in behavior.

## Be-Music implementation seams

These are repository findings, distinct from the upstream facts above:

- [Parser normalization](../../packages/chart-parser/src/core/bmson.ts) already keeps finite zero and takes the absolute value of negatives; [document normalization](../../packages/chart-parser/src/core/bmson-document.ts) supplies missing TOTAL as 100. Do not convert zero into a missing value.
- [Resolved chart facts](../../packages/chart-model/src/resolved-chart.ts) and [ruleset facts adapter](../../packages/player-engine/src/ruleset/chart-facts.ts) preserve value plus `absolute`/`percent` units. Mixed BMS/bmson NONSTOP composition carries `totalUnit`; testing only `sourceFormat === 'bmson'` can misclassify BMS TOTAL in a bmson container.
- [Ruleset definitions](../../packages/player-engine/src/ruleset/definitions.ts) centralize effective TOTAL, active/fallback/parallel gauge tables, PRACTICE overrides and per-play options. Their current `raw <= 0` fallback preserves existing compatibility. Ordinary That-Which-Must-Not-Be-Named gauges and [course class gauges](../../packages/player-engine/src/ruleset/course.ts) do not derive all recovery from TOTAL.
- [RulesetGauge](../../packages/player-engine/src/ruleset/gauge.ts) applies judge deltas and HCN rates to all gauges. [Judge bootstrap](../../packages/player-engine/src/core/bootstrap.ts) routes HCN through the same table; raw mine damage bypasses it. Positive-table suppression therefore covers ordinary judgments and held HCN while leaving released-HCN damage, mines and death handling intact. `applyRawDelta` is a public escape hatch: future positive raw recovery must honor the same policy.
- [Replay format](../../packages/player-engine/src/replay/format.ts), [recorder](../../packages/player-engine/src/replay/recorder.ts) and [replay ruleset adapter](../../packages/player-engine/src/replay/rulesets.ts) preserve chart TOTAL/units but currently record no interpretation choice. Add an optional per-play setting and normalize absence to existing compatibility in every live/simulation/course path.
- [NONSTOP composition](../../packages/player-engine/src/course/nonstop/compose.ts) selects one effective TOTAL from the source stages. Do not accidentally implement stage-local zero transitions in a stitched chart. True course stages can resolve their own zero policy while retaining carry and parallel-bank histories.

## Recommended opt-in contract

This section is a proposed **Be-Music policy**, not a claim about native players.

1. Add an explicit, validated per-play interpretation choice, for example `bmsonTotalMode: 'beatoraja' | 'spec'`. Keep `beatoraja` as the default. Replay absence must resolve to that constant, never to the viewer's current preference. Record explicit opt-in and propagate it through hosts, settings, course stages, recording, parsing and server simulation.
2. Apply `spec` zero semantics only to a normalized **percentage-unit** TOTAL equal to zero. BMS absolute zero retains its existing fallback. Normalize negative percentage input with `abs` at any direct replay/facts boundary too, or reject malformed negative replay facts consistently; parser normalization alone does not protect direct APIs.
3. Separate no-recovery state from the absolute TOTAL used for damage. Retain the usual default TOTAL for damage scaling and diagnostics, expose no-recovery explicitly, then clamp every positive delta in the final active, fallback and bank gauge tables to zero. Preserve negative deltas, guts, initial HP, border, floor, failure latch and stage carry. Damage remaining at the compatibility-default level is permitted by the specification and avoids an unrelated HARD-damage change.
4. Apply the same rule after course and PRACTICE gauge construction. If PRACTICE explicitly replaces TOTAL, its configured TOTAL takes precedence; a positive replacement restores recovery. Without a replacement, a zero source retains no recovery. PRACTICE starts and course carry remain initial conditions, not judged recovery. Document these precedence rules because the format does not define them.
5. Guard note-count divisors with a positive denominator as the engine already does. Zero-note charts must produce finite gauge values, retain initial/carry state, and use the existing clear/failure rule. Do not invent a special failure solely for zero TOTAL.
6. Keep chart/play content fingerprints unchanged: interpretation is a play setting. Store and simulate opt-in manual plays normally. Partition best records and Leaderboard comparisons by interpretation when it changes gauge behavior; include mixed courses containing any affected stage. Until a comparison partition exists, use a precise stored-but-unranked classification for affected runs and exclude them from ordinary best-record merges. This is supported playback with explicit result policy, not an unsupported-feature rejection. No-op opt-in on positive TOTAL need not split existing comparisons.

[Replay eligibility](../../packages/player-engine/src/replay/eligibility.ts) currently recognizes only tempo/course-stage unranked reasons, and [best records](../../packages/player-engine/src/records/best-record.ts) assume one record per chart/course and judge ruleset. Updating only simulation would therefore leave a comparison-integrity gap. Server verification and presentation must understand the setting before submissions can be safely classified; silently simulating under the default would verify a different run. See the [Leaderboard contract](../leaderboard.md).

## Required verification

Test positive/zero/missing/negative totals with explicit and absent modes; absolute BMS zero inside a mixed-format container; all gauge families including fixed-recovery HARD/HAZARD/class tables; active/fallback/all parallel banks; held/released HCN; mines; zero-note charts; PRACTICE TOTAL precedence; stage carry and stage-specific courses versus stitched NONSTOP; legacy replay absence; serialization and invalid mode rejection; deterministic live/replay/server equivalence; and best-record/Leaderboard classification. Original-corpus totals and fingerprints must remain unchanged under the default. No runtime changes were made for this research note.

## Implementation verification

All 28 original hashes match. Default/spec comparison across three rulesets and 308 gauge configurations is unchanged for these positive totals, covering 39,999 resolved notes and 160,249 sample-trigger instances. Source JSON and chart/play fingerprints remain unchanged. These are structural and gauge checks, not full media playback. Zero-total execution uses authored fixtures.
