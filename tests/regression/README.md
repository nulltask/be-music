[日本語版はこちら](./README.ja.md)

# Regression Corpus

`corpus.test.ts` pushes every chart in [`examples/test`](../../examples/test/README.md) through the whole toolchain and pins what each stage produces in `__expected__/<chart>.json`. Unit tests assert what a function should do; this suite records what the toolchain currently does on real chart files, so a refactor that moves logic between packages fails here as soon as any stage's output shifts.

## What each expected file records

- `parse`: metadata, resources, measures, BMS / bmson extensions, the control-flow directives, and every event (`measure:channel@num/den=value`).
- `stringify`: the chart written back to its own format (one array entry per line), plus `roundTripPlayableNotesEqual`, which is whether re-parsing that output gives back the same playable notes.
- `variants`: one entry per `#RANDOM` draw (`random-low` / `random-high` for charts with control flow, `default` otherwise). Each entry holds:
  - the drawn patterns, play variant, and reference BPM
  - tempo and STOP points
  - every sample trigger
  - the replay chart facts
  - the note list the engine prepares for play
  - the LR2 / beatoraja / IIDX simulator results for three fixed input streams: `missed` (no input), `perfect` (every note on time), and `offset` (presses cycled across every judge window, with every 7th note skipped)
  - next to them, under `engine`, the live engine's summary (plus its max combo) from replaying the same stream through `manualPlay` under each judge ruleset

Times are integer microseconds and beats are rounded to 1e-6, so floating-point noise never shows up as a diff.

## Running and updating

```bash
pnpm test:regression
```

```bash
pnpm test:regression -u
```

A diff in an expected file is not automatically a bug. When the change is intended, regenerate with `-u` and review the diff in the pull request like code. Adding a chart to `examples/test` adds an expected file automatically.

## Engine replays

The engine first runs once per variant with no input, to capture the note list it prepares; the input streams are built from it. Each stream is then replayed through `manualPlay` at 64x speed under every judge ruleset. A replay steps the deterministic judge core from one judgment instant to the next (`advanceJudgeCoreReplay`): each recorded input's microsecond and the microsecond after each timed judgment. Its outcome does not depend on tick timing or speed and can be pinned like any other stage. `engine-determinism.test.ts` replays every stream again at 1024x and requires the same summaries and the same re-recorded input streams; repeat runs at 64x are covered by the corpus itself, since every run is compared against the same files. Charts run concurrently because replays mostly wait on their tick loop.

The engine results are pinned next to the simulator results for the same stream, and the suite fails when the engine's own result in the replay (`results.native`) differs from the simulator's result in any field: judgment counts, fast / slow, EX-SCORE, judgment count, max combo, DJ LEVEL, score, and the exact final gauge. `packages/player/src/replay/equivalence.test.ts` reduces each rule to a minimal case; this suite catches the combinations real charts reach.

## Differential fuzzing

`engine-simulator-fuzz.test.ts` holds the engine and the simulator to the same agreement on seeded random charts in every play mode (7 / 14 keys, 5 keys, PMS, 24-key keyboard): taps, long notes in each `#LNMODE`, mines, BPM and `#EXRANK` changes, and input streams that press across and past every window, release long notes early and late, re-press, and hold keys across mines. Each case is replayed under every judge ruleset with a drawn gauge and AUTO SCRATCH setting, and any field that differs fails the test with its seed. It runs 40 seeds per mode; rare corners need more, so raise the count locally when touching the judges:

```bash
BE_MUSIC_FUZZ_SEEDS=1000 pnpm exec vp test run tests/regression/engine-simulator-fuzz.test.ts
```

A failing seed reproduces exactly; reduce it to a minimal case in `equivalence.test.ts` alongside the fix.
