[日本語版はこちら](./README.ja.md)

# Golden Corpus

`corpus.test.ts` pushes every chart in [`examples/test`](../../examples/test/README.md) through the whole toolchain and pins what each stage produces in `__golden__/<chart>.json`. Unit tests assert what a function should do; this suite records what the toolchain currently does on real chart files, so a refactor that moves logic between packages fails here as soon as any stage's output shifts.

## What each golden file records

- `parse`: metadata, resources, measures, BMS / bmson extensions, the control-flow directives, and every event (`measure:channel@num/den=value`).
- `stringify`: the chart written back to its own format (one array entry per line), plus `roundTripPlayableNotesEqual`, which is whether re-parsing that output gives back the same playable notes.
- `variants`: one entry per `#RANDOM` draw (`random-low` / `random-high` for charts with control flow, `default` otherwise). Each entry holds:
  - the drawn patterns, play variant, and reference BPM
  - tempo and STOP points
  - every sample trigger
  - the playlog chart facts
  - the note list the engine prepares for play
  - the LR2 / beatoraja / IIDX simulator results for three fixed input streams: `missed` (no input), `perfect` (every note on time), and `offset` (presses cycled across every judge window, with every 7th note skipped)

Times are integer microseconds and beats are rounded to 1e-6, so floating-point noise never shows up as a diff.

## Running and updating

```bash
pnpm test:golden
```

```bash
pnpm test:golden -u
```

A golden diff is not automatically a bug. When the change is intended, regenerate with `-u` and review the diff in the pull request like code. Adding a chart to `examples/test` adds a golden file automatically.

## Why live engine results are not pinned

The engine runs once per variant with no input, only to capture the note list it prepares. Play outcomes come from the pure ruleset simulators. The live engine judges on a wall-clock tick loop, and its replay summary still shifts between runs and between playback speeds (the gauge order around the 100 % clamp, and trailing releases dropped once the loop ends). Pinning it would make this suite flaky. Engine/simulator agreement on curated cases is covered by `packages/player/src/playlog/equivalence.test.ts`.
