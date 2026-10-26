// Generates the modules the Worker bundles but git does not keep: the pages' stylesheet, icons, fonts and client
// script (src/pages/{styles,icons,fonts,client}.generated.ts). Runs on `pnpm install` (prepare), before `dev` and the deploys,
// and before the tests (test/global-setup.ts); run it by hand after changing the pages, the icons or client/:
//   pnpm --filter @be-music/app-leaderboard run generate
//
// `prepare` also runs in other packages' builds, such as the player player's Workers Build, whose Node (22.16) strips
// TypeScript types only with --experimental-strip-types; the flag is passed on to the generators below.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
for (const script of ['build-css.ts', 'build-icons.ts', 'build-fonts.ts', 'build-client.ts']) {
  // Pass this process's flags on: Node before 22.18 (Workers Builds' default) strips types only when asked.
  execFileSync(process.execPath, [...process.execArgv, resolve(packageDir, 'scripts', script)], {
    cwd: packageDir,
    stdio: 'inherit',
  });
}
