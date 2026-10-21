[Japanese version](./browser-workers-2026-10-21.ja.md)

# Browser worker benchmark — 2026-10-21

Bulk chart import, ZIP expansion, and WSOLA are faster with multiple workers. Single-play preparation and submission preparation are slower because their computation is small relative to message cloning and result transfer. The five-worker default helps the bulk workloads on this machine; it does not make every operation faster.

## Setup

- Apple M5, 10 logical CPUs, 32 GiB RAM; macOS arm64, headless Chrome 156.0.8078.48. No CPU throttling.
- Production bundles served locally. Worker implementation: `7a4b7a13`; before-worker chart loader: `f6b7993b` (loaded verbatim through a benchmark-only Vite plugin). Other baselines use the same calculation without worker dispatch.
- GdbG BMS Package 2022: all 315 charts, 48,422,070 source bytes. The original files were read without modification. No source charts or audio are stored in this report or repository.
- ZIP case: the same charts split round-robin into four generated ZIPs, 5,440,529 compressed bytes. This measures expansion alone, including input reading and output delivery, not chart parsing.
- Audio: 32 WAV files, selected deterministically across sorted paths with file sizes from 44,000 to 256,000 bytes; 18.778 seconds total, decoded to 44.1 kHz before timing. WSOLA rate 0.8, all channels of each sample processed together. Audio decoding is excluded.
- Single preparation: the chart with the most scored notes, `qfeileadh_MESMERA/_MESMERA_07_KOOKY.bms`, 4,671 scored notes and 5,879 source events. Submission uses this real chart with synthetic replay inputs following its notes; it verifies both fingerprints and serializes/compresses the payload. No account, network submission, or human replay is involved.
- One discarded warm-up per operation/mode, then five timed samples. Mode order rotates each round. Garbage collection runs before timing. Idle pages/workers stay alive; no modes execute simultaneously. Worker timings include cloning, queueing, result transfer, and main-thread reconstruction where applicable.
- Each sample checks outputs against the baseline and asserts that real workers completed the jobs without errors. End-to-end Pixi rendering, live input latency, actual network time, and peak memory are not measured. Results cover one dataset and machine.

## Completion time

Median milliseconds, lower is better. Raw samples and outputs are in [the JSON record](./browser-workers-2026-10-21.json).

| Operation                    | Before | 1 Worker | 2 Workers | 4 Workers | 5 Workers |
| ---------------------------- | -----: | -------: | --------: | --------: | --------: |
| Chart import                 |  943.8 |   1015.5 |     552.9 |     355.9 |     317.7 |
| ZIP expansion                |  114.2 |    113.8 |      60.9 |      36.2 |      35.3 |
| WSOLA                        |  126.4 |    201.0 |     104.0 |      68.5 |      52.3 |
| Single-play preparation      |    3.9 |     17.7 |      18.5 |      18.5 |      18.2 |
| Fingerprint and gzip payload |   23.5 |     49.0 |      47.8 |      47.1 |      46.6 |

At five workers, chart import is **2.97×**, ZIP expansion **3.24×**, and WSOLA **2.42×** faster. Single-play preparation takes **4.67×** as long and submission preparation **1.98×** as long. Single preparation and submission are sequential operations, so merely increasing the pool size does not help them. One worker reduces UI contention but can be slower than local calculation.

## Main-thread responsiveness

Median of each run's largest gap between 10 ms timer callbacks, in milliseconds. A normal interval is about 10 ms; a job shorter than that can finish before a callback. This is a scheduling proxy, not measured click latency or INP.

| Operation                    | Before | 1 Worker | 2 Workers | 4 Workers | 5 Workers |
| ---------------------------- | -----: | -------: | --------: | --------: | --------: |
| Chart import                 |   69.7 |     11.7 |      12.4 |      12.5 |      13.2 |
| ZIP expansion                |  114.2 |     11.2 |      11.5 |      11.7 |      11.7 |
| WSOLA                        |  126.4 |     11.3 |      11.1 |      10.8 |      10.6 |
| Single-play preparation      |    3.9 |     11.1 |      10.9 |      10.9 |      10.9 |
| Fingerprint and gzip payload |   16.3 |     14.6 |      13.6 |      13.1 |      12.1 |

The bulk paths reduce the long timer gaps substantially. The local WSOLA run also reports a median 126 ms long task; the worker modes report none for that case. Zero long-task entries alone do not prove responsiveness: multiple short tasks can still delay timers. The [Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming) reports individual tasks of at least 50 ms, not every scheduling delay.

## First use

The first chart-import pass, including worker startup and cold calculation/JIT, was 958.2 ms before the change and 391.4 ms with five workers. These are single warm-up observations, not five-sample medians. Separately recreating the pool and completing tiny messages took medians of 6.9 / 7.1 / 9.0 / 9.6 ms for 1 / 2 / 4 / 5 workers. Those startup probes exclude the first heavy operation's JIT and must not be subtracted from warm timings as a complete cold-start estimate.

## Implication

Production keeps worker parallelism only for chart imports, ZIP expansion, and WSOLA. Single-play preparation and fingerprint/submission JSON generation stay local because worker overhead made them slower. The measurements above preserve the original five-operation prototype; the rejected operations remain only in the benchmark harness for reproducibility.

## Reproduce

```bash
node --conditions=source scripts/bench/browser-workers/prepare.ts "/path/to/GdbG BMS Package 2022"
pnpm exec vp build --config scripts/bench/browser-workers/vite.config.ts
node scripts/bench/browser-workers/run.ts
BENCH_STARTUP_ONLY=1 BENCH_OUTPUT=tmp/bench/browser-workers-startup.json node scripts/bench/browser-workers/run.ts
```

The preparation step writes a local manifest to `/tmp/be-music-browser-manifest.json`. Override `BENCH_MANIFEST`, `BENCH_OUTPUT`, and `BENCH_REPETITIONS` as needed. `BENCH_BASE_REF` selects the baseline loader (default `7a4b7a13^`) and must also be set when building. The output defaults to `tmp/bench/browser-workers-real.json`. Chrome must be installed. Run on an otherwise idle machine; keep the same dataset and browser when comparing.
