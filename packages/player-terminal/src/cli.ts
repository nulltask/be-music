import { isCLIEntryPoint } from '@be-music/shared-utils/cli';
import { main } from './cli/runner.ts';

export * from './cli/runner.ts';

if (isCLIEntryPoint(() => (import.meta as { url?: unknown }).url, { allowExecutableFallback: true })) {
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
