import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** The pages import generated modules git does not keep: build them from the current sources before the tests. */
export default function setup(): void {
  const packageDir = resolve(import.meta.dirname, '../..');
  execFileSync(process.execPath, [resolve(packageDir, 'scripts/generate.ts')], { cwd: packageDir, stdio: 'ignore' });
}
