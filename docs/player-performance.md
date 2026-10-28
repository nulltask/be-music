[Japanese version](./player-performance.ja.md)

# Browser player performance and measurement

This specification covers the browser measurement harness in `scripts/performance/` and the worker benchmark in `scripts/bench/browser-workers/`. Rendering controls are defined in [Browser player](./player-web.md#renderer-and-performance-controls); worker scheduling and fallback are defined in [ADR 0010](./adr/0010-browser-task-pool.md).

## Rendering contracts

Published gameplay frames can be retained by bindings and skin callbacks. Each draw creates its HUD snapshot and published collections; Canvas and DOM share the HUD calculation within that draw. Later draws do not overwrite previously published snapshots.

`packages/player-browser/src/stage/draw-label.ts` caches a label by its owner and original input values. The cache uses weak ownership and preserves the complete label text. `skins/pixi-kit/particle-layer.ts` preserves the unchanged prefix of active particles and skips redundant tint and opacity updates. Lua callbacks are evaluated without a general result-memoization cache.

## Gameplay profiles

Install workspace dependencies and Playwright Chromium. For LR2, set `PERF_LR2_FILES` to the stock `LR2files` directory; for beatoraja, set `PERF_MODERN_CHIC` to the ModernChic directory. Run:

```bash
PERF_OUTPUT=tmp/performance/current pnpm exec playwright test -c scripts/performance/browser.config.ts
```

The harness builds the player with source maps, serves it on a dedicated free port, creates temporary fixtures and removes them afterward. It runs one browser worker with a 1280 × 720 viewport. The fixture has 1,024 notes over 64 measures at 150 BPM. Each skin plays AUTO past chart time 5 seconds before three 15-second captures. The families are Synesthesia with full effects, Native DOM/Canvas, stock LR2 and ModernChic.

`PERF_FAMILIES` selects a comma-separated subset of `built-in,native,lr2,beatoraja`. Setting it omits collection scenarios. With it unset, the harness also drops 300 chart copies and scrolls 150 entries at 50 ms intervals.

Each capture records CDP CPU samples, Performance metrics, allocations sampled at 16 KiB intervals, animation-frame intervals and a screenshot. Allocation sampling includes objects collected by minor and major GC; it measures cumulative allocations rather than retained heap. The first frame interval is excluded from percentile calculations. The harness asserts that no browser errors occur.

The output contains `.cpuprofile`, `.heapprofile`, per-capture JSON and PNG files, and `summary.json` with frame percentiles, intervals over 33.4 ms, Performance metrics and errors. Keep source maps from `packages/app-play/dist/assets/` beside the profiles before another build replaces them. Use separate output directories and the same browser, hardware, assets and settings for comparisons. Profiling adds overhead; CPU samples and allocation differences alone do not establish an FPS improvement.

`node scripts/performance/frame-labels.ts` runs the label microbenchmark: five trials of one million formatted or cached calls after warm-up. Use it as a diagnostic alongside gameplay profiles.

## Worker benchmark

Production dispatches chart import, ZIP expansion and WSOLA to the shared worker pool. Single-play preparation and fingerprint/submission preparation stay local. The benchmark includes all five operations to measure dispatch overhead as well as parallel throughput.

```bash
node --conditions=source scripts/bench/browser-workers/prepare.ts "/path/to/GdbG BMS Package 2022"
pnpm exec vp build --config scripts/bench/browser-workers/vite.config.ts
node scripts/bench/browser-workers/run.ts
BENCH_STARTUP_ONLY=1 BENCH_OUTPUT=tmp/bench/browser-workers-startup.json node scripts/bench/browser-workers/run.ts
```

Chrome must be installed. The preparation step writes `/tmp/be-music-browser-manifest.json`. `BENCH_MANIFEST`, `BENCH_OUTPUT` and `BENCH_REPETITIONS` configure input and output; `BENCH_BASE_REF` selects the baseline loader and must also be set during the build. The default baseline is `7a4b7a13^`, so the local Git history must contain that revision. The default output is `tmp/bench/browser-workers-real.json`.

Compare output equivalence before interpreting timings. Worker timings include cloning, queueing, result transfer and main-thread reconstruction. Timer-callback gaps measure scheduling delay; they are not click latency or INP. Keep cold startup measurements separate from warmed repeated samples. Machine-specific results belong in generated measurement output, not in the runtime contract.
