import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';

export interface CLIEntryPointOptions {
  /** Allow SEA/CJS startup when no usable module URL is available. */
  allowExecutableFallback?: boolean;
}

/** Whether this module is the process entry point. Never start a CLI from a worker. */
export function isCLIEntryPoint(readModuleURL: () => unknown, options: CLIEntryPointOptions = {}): boolean {
  if (!isMainThread) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const moduleURL = readModuleURL();
    if (typeof moduleURL === 'string' && moduleURL.length > 0) {
      return resolve(entry) === fileURLToPath(moduleURL);
    }
  } catch {
    // SEA/CJS bundles may not provide a usable module URL.
  }
  return options.allowExecutableFallback === true && resolve(entry) === resolve(process.execPath);
}
