import { BrowserTaskPool, type TaskWorker } from './pool.ts';

/** Half of the browser-reported logical CPU count, rounded down, with at least one worker. */
export function defaultBrowserWorkerCount(cores: number | undefined): number {
  return Number.isFinite(cores) && cores! >= 1 ? Math.max(1, Math.floor(cores! / 2)) : 1;
}
/** Invalid settings return to the hardware-derived default. */
export function normalizeBrowserWorkerCount(value: number, cores: number | undefined): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : defaultBrowserWorkerCount(cores);
}
let count = defaultBrowserWorkerCount(typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency);
let pool = new BrowserTaskPool(count);
/** Install a host-bundled worker factory once, before loading files. */
export function configureBrowserWorkers(factory: () => TaskWorker): void {
  pool.dispose();
  pool = new BrowserTaskPool(count, factory);
}
export function setBrowserWorkerCount(value: number): void {
  count = normalizeBrowserWorkerCount(
    value,
    typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
  );
  pool.resize(count);
}
export function getBrowserWorkerCount(): number {
  return count;
}
export function disposeBrowserWorkers(): void {
  pool.dispose();
}
/** Data-only task messages; the same implementation is used by hosts without workers. */
export function runBrowserTask<T>(name: string, input: unknown, fallback: () => T | Promise<T>): Promise<T> {
  return pool.run(name, input, fallback);
}
export { executeBrowserTask, type ParseChartTaskInput, type ParseChartTaskResult, type ZipTaskInput } from './tasks.ts';
export {
  configureBGAVideoWorkers,
  type BGAVideoWorker,
  type BGAVideoWorkerFactories,
} from '../media/bga-stream/stream.ts';
export { runBGAVideoDecodeWorker } from '../media/bga-stream/decode-worker.ts';
export { runBGAVideoEncodeWorker } from '../media/bga-stream/encode-worker.ts';
