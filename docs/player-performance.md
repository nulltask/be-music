# Browser player performance measurements

[日本語](./player-performance.ja.md)

This investigation covers #344 (Lua memoization) and #345 (gameplay allocations). The baseline is `8e4bdb15`; the rendering changes are `13eaa2a7` and `76110dd3`. These changes depend on the scene-timer work in PR #681.

## Protocol

The measurements run on an Apple M5 with 32 GB memory, macOS 27.0.1 (26A434), Node 26.12.1, pnpm 10.30.3 and Playwright Chromium 156. The browser uses a 1280 × 720 viewport, device scale 1, GPU rendering and no CPU throttling. One browser worker runs at a time. Other full builds, tests and benchmarks must wait until the capture finishes.

The fixture contains 1,024 notes over 64 measures at 150 BPM, using seven keys and scratch. Each skin runs AUTO to chart time 5 seconds, followed by three consecutive 15-second captures. Synesthesia uses full effects. Native uses DOM and Canvas. LR2 uses the stock LR2 theme, and beatoraja uses ModernChic with its default preset. Assets remain unchanged. The collection scenarios drop 300 distinct copies of the chart, then scroll 150 entries at 50 ms intervals.

Each capture records CDP CPU samples, Performance metrics, allocation samples at 16 KiB intervals including objects collected by minor and major GC, animation-frame intervals, and a screenshot. The first interval is discarded. Allocation totals estimate cumulative allocations, including garbage; they are not retained heap sizes. Profiling adds overhead. The desktop is shared, so small timing differences do not establish an FPS improvement.

## Reproduce

Install workspace dependencies and Playwright Chromium. Set `PERF_MODERN_CHIC` to the local ModernChic directory and `PERF_LR2_FILES` to the stock `LR2files` directory, then run:

```bash
PERF_OUTPUT=tmp/remaining-work/performance/current pnpm exec playwright test -c scripts/performance/browser.config.ts
```

The harness builds its own player with source maps and serves it on a free local port. It writes fixtures to a temporary directory and removes them afterward. It leaves existing development servers and browser tabs untouched. To capture a subset, set `PERF_FAMILIES=built-in,native,lr2,beatoraja` to the desired comma-separated families; a subset omits the collection scenarios.

Keep separate output directories for each revision. Preserve `packages/app-play/dist/assets/*.map` beside the profiles before another build replaces them. Open the `.cpuprofile` and `.heapprofile` files in browser developer tools to inspect source attribution. `summary.json` contains frame percentiles, slow-frame counts, Performance metrics and browser errors. Screenshots and raw frame intervals are saved per capture. When comparing an older revision that predates the harness, copy `scripts/performance/` into its worktree before running it.

The internal label benchmark runs with `node scripts/performance/frame-labels.ts`. It alternates formatted and cached labels over five trials of one million calls after warm-up. Its timings are diagnostic; end-to-end allocation profiles determine the rendering result.

## Lua memoization: deferred

ModernChic spends about 4% of sampled active JavaScript time in Lua. A three-second diagnostic window evaluates 3,620 callbacks, but finds no calls eligible for cache lookup and no cache hits. The largest shared-reference count is eight; those references do not repeat in the exercised default preset's playback path.

A conservative full-observation prototype increases Lua time and allocations. Three paired 15-second samples show:

| Metric                 | Baseline              | Prototype             |
| ---------------------- | --------------------- | --------------------- |
| Lua CPU time, ms       | 79.1 / 50.7 / 70.6    | 115.7 / 94.3 / 98.5   |
| Sampled allocation, MB | 128.9 / 127.5 / 128.9 | 151.7 / 150.1 / 152.5 |

A selective prototype also produces no cache hits and no consistent improvement. Lua callbacks can mutate captured values and tables or call timer and audio functions indirectly. Detecting those effects adds complexity and runtime overhead. The user therefore chooses to record these results and defer #344's cache. No memoization, Lua VM inspection or runtime extraction ships with the rendering changes. Other skins or presets may behave differently; repeat the measurements before revisiting this decision.

## Gameplay allocations

The reader audit finds that gameplay bindings and external skin callbacks can retain published frames. Each new draw therefore keeps a fresh HUD snapshot and fresh published collections. Canvas and DOM share the HUD calculation only within that draw. No snapshot from an earlier frame is rewritten.

Debug labels keep their complete text in release builds. A weakly owned cache retains each label for its view or skin element, keyed by its original input values. It creates no formatted cache keys and releases the cache with its owner. Particle layers preserve the unchanged prefix of their active particle list and skip redundant public tint and opacity setters. Packed color, opacity clamping, draw order and geometry remain unchanged.

The following values are the medians of the three 15-second windows. MB uses decimal units.

| Skin        | Allocation before, MB | After, MB | Active JS before, ms | After, ms |
| ----------- | --------------------: | --------: | -------------------: | --------: |
| Synesthesia |               4,211.3 |   3,914.9 |              5,471.8 |   5,281.5 |
| Native      |                 37.18 |     36.50 |              1,830.1 |   1,613.6 |
| LR2         |                 66.13 |     61.96 |              1,765.6 |   1,711.6 |
| ModernChic  |                128.58 |    130.32 |              2,044.0 |   1,704.5 |

Synesthesia allocates about 7.0% less, LR2 about 6.3% less and Native about 1.8% less in this run. ModernChic is not a target of the label/HUD changes and its 1.3% allocation increase is within sampling variation. Active CPU time varies across runs; the lower ModernChic time is not attributed to these changes. All scenarios retain a 95th-percentile frame interval of about 16.67 ms. Across the three windows, frames exceeding 33.4 ms are 4 → 4 for Synesthesia, 0 → 0 for Native and LR2, and 1 → 0 for ModernChic. No FPS improvement is claimed.

The collection scenarios are controls: bulk-drop elapsed time is 323 → 314 ms, sampled allocations 54.88 → 56.12 MB; scrolling takes 8,914 → 8,938 ms with 1,999.00 → 1,995.04 MB allocated. Neither scenario receives a targeted optimization. All captures finish without browser errors. The five-trial label microbenchmark has median times of 13.32 ms for formatting and 13.00 ms for cached lookup per million calls, with overlapping individual samples.

The original captures and comparisons are retained locally under `tmp/remaining-work/performance/`. The Lua experiment remains outside this PR. These results do not characterize iOS devices or supersede the existing finding that high rendering resolution can limit iPad frame rates.
