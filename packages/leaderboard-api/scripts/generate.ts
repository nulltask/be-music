// Generates the modules the Worker bundles but git does not keep: the pages' stylesheet, icons and client script
// (src/pages/{styles,icons,client}.generated.ts). Runs on `pnpm install` (prepare), before `dev` and the deploys,
// and before the tests (test/global-setup.ts); run it by hand after changing the pages, the icons or client/:
//   pnpm --filter @be-music/leaderboard-api run generate
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
for (const script of ['build-css.ts', 'build-icons.ts', 'build-client.ts']) {
  execFileSync(process.execPath, [resolve(packageDir, 'scripts', script)], { cwd: packageDir, stdio: 'inherit' });
}
