import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli/runner.ts';

export * from './cli/runner.ts';

function isCliEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    const moduleUrl = (import.meta as { url?: unknown }).url;
    if (typeof moduleUrl === 'string' && moduleUrl.length > 0) {
      return resolve(entry) === fileURLToPath(moduleUrl);
    }
  } catch {
    // SEA/CJS bundles may not provide import.meta.url.
  }

  return resolve(entry) === resolve(process.execPath);
}

if (isCliEntryPoint()) {
  void main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
