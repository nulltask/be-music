import { defaultBrowserWorkerCount, normalizeBrowserWorkerCount } from '@be-music/player-browser/compute';

export const WORKER_COUNT_STORAGE_KEY = 'be-music-demo.worker-count';
export interface WorkerSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** Blocked storage and invalid values use half the browser-reported logical CPU count. */
export function readWorkerCount(storage: WorkerSettingsStorage | undefined, cores: number | undefined): number {
  try {
    const value = storage?.getItem(WORKER_COUNT_STORAGE_KEY);
    return value === null || value === undefined
      ? defaultBrowserWorkerCount(cores)
      : normalizeBrowserWorkerCount(Number(value), cores);
  } catch {
    return defaultBrowserWorkerCount(cores);
  }
}
export function storeWorkerCount(storage: WorkerSettingsStorage | undefined, count: number): void {
  try {
    storage?.setItem(WORKER_COUNT_STORAGE_KEY, String(count));
  } catch {
    /* Private browsing can disable storage. */
  }
}
