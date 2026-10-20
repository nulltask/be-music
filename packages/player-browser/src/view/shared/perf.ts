/**
 * Lightweight per-section frame timing tracker.
 *
 * Wrap each render-loop section in `tracker.time(label, fn)`; once a second the tracker prints a console summary with
 * avg / p95 / max per section, sorted by total time spent. Each section also emits a `performance.mark` /
 * `performance.measure` so the same data shows up under the "Timings" track in Chrome DevTools' Performance tab.
 *
 * Enable by adding `?perf` to the dev URL (or by setting `globalThis.__BE_MUSIC_PERF__ = true` from the console). When
 * disabled, `time()` is a thin wrapper that does no measurement and returns the function result directly — safe to
 * leave wired up in production.
 */
export class PerfTracker {
  private readonly enabled: boolean;
  private readonly label: string;
  private readonly samples = new Map<string, number[]>();
  private frameCount = 0;
  private lastReport = performance.now();
  /**
   * Timestamp of the previous tick start (rAF callback entry). Used to derive `frameInterval` — the actual wall-clock
   * time between ticks, which captures everything the JS-only `time()` wrappers can't see (PixiJS auto-render, GPU
   * dispatch, browser composite, GC pauses).
   */
  private prevTickStart = 0;

  public constructor(label: string) {
    this.label = label;
    this.enabled = isPerfEnabled();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Call once at the very start of the rAF callback. Records the gap between this tick and the previous one as a
   * `frameInterval` sample, so the periodic report shows e.g. `frameInterval avg=24ms` even when our `time()`-wrapped
   * JS work sums to under 1 ms — that difference is where we should look for the real bottleneck.
   */
  public beginTick(): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (this.prevTickStart > 0) {
      const interval = now - this.prevTickStart;
      let arr = this.samples.get('frameInterval');
      if (!arr) {
        arr = [];
        this.samples.set('frameInterval', arr);
      }
      arr.push(interval);
    }
    this.prevTickStart = now;
  }

  /**
   * Times a render section. When perf is disabled this is just `fn()` — no measurement, no `performance.mark` overhead.
   */
  public time<T>(section: string, fn: () => T): T {
    if (!this.enabled) {
      return fn();
    }
    const startMark = `${this.label}:${section}:start`;
    performance.mark(startMark);
    const t0 = performance.now();
    const result = fn();
    const dt = performance.now() - t0;
    performance.measure(`${this.label}:${section}`, startMark);
    performance.clearMarks(startMark);
    performance.clearMeasures(`${this.label}:${section}`);
    let arr = this.samples.get(section);
    if (!arr) {
      arr = [];
      this.samples.set(section, arr);
    }
    arr.push(dt);
    return result;
  }

  /**
   * Call once per frame at the end. Returns a report string when 1 second has elapsed since the previous report
   * (otherwise undefined). The optional `extra` callback contributes one-off counters (e.g. scene-graph child counts)
   * appended below the timing table.
   */
  public endFrame(extra?: () => Record<string, number | string>): string | undefined {
    if (!this.enabled) {
      return undefined;
    }
    this.frameCount += 1;
    const now = performance.now();
    const elapsed = now - this.lastReport;
    if (elapsed < 1000) {
      return undefined;
    }
    const fps = (this.frameCount / elapsed) * 1000;
    const stats = Array.from(this.samples.entries()).map(([section, arr]) => {
      arr.sort((a, b) => a - b);
      const sum = arr.reduce((acc, x) => acc + x, 0);
      const avg = sum / arr.length;
      const p95 = arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] ?? 0;
      const max = arr[arr.length - 1] ?? 0;
      return { section, avg, p95, max, sum, count: arr.length };
    });
    stats.sort((a, b) => b.sum - a.sum);
    const lines: string[] = [
      `[${this.label}.perf] ${this.frameCount}f over ${elapsed.toFixed(0)}ms | ${fps.toFixed(1)}fps`,
    ];
    for (const s of stats) {
      lines.push(
        `  ${s.section.padEnd(22)} ` +
          `avg=${s.avg.toFixed(2)}ms ` +
          `p95=${s.p95.toFixed(2)}ms ` +
          `max=${s.max.toFixed(2)}ms ` +
          `total=${s.sum.toFixed(0)}ms (${s.count}×)`,
      );
    }
    if (extra) {
      const entries = Object.entries(extra());
      if (entries.length > 0) {
        lines.push(`  meta: ${entries.map(([k, v]) => `${k}=${v}`).join(' ')}`);
      }
    }
    this.samples.clear();
    this.frameCount = 0;
    this.lastReport = now;
    return lines.join('\n');
  }
}

function isPerfEnabled(): boolean {
  // Allow runtime opt-in from the console without rebuilding — `globalThis.__BE_MUSIC_PERF__ = true;
  // location.reload()`.
  if ((globalThis as { __BE_MUSIC_PERF__?: boolean }).__BE_MUSIC_PERF__) {
    return true;
  }
  if (typeof globalThis.location !== 'undefined') {
    try {
      const params = new URLSearchParams(globalThis.location.search);
      if (params.has('perf')) return true;
    } catch {
      // Non-browser host (Node test runner, SSR) — perf stays off.
    }
  }
  return false;
}
