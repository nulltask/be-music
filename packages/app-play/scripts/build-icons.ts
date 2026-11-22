// Renders the installable player's icons into public/icons/ (docs/player-web.md, "Installing the player"). The PNGs
// are kept in git, so a build needs no renderer; after changing an icon, run:
//   pnpm --filter @be-music/app-play run build:icons
//
// Render the installed-app artwork at each manifest size. The renderer comes from the Leaderboard package.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/** The part of `@resvg/resvg-js` this script uses. */
interface ResvgModule {
  Resvg: new (svg: string, options: { fitTo: { mode: 'width'; value: number } }) => { render(): { asPng(): Buffer } };
}

const packageDir = resolve(import.meta.dirname, '..');
const leaderboardRequire = createRequire(resolve(packageDir, '../app-leaderboard/package.json'));
const { Resvg } = leaderboardRequire('@resvg/resvg-js') as ResvgModule;
const outputDir = join(packageDir, 'public/icons');
const icon = readFileSync(join(packageDir, 'scripts/icons/installed.svg'), 'utf8');

const renders = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'maskable.svg'), icon);

for (const { file, size } of renders) {
  const png = new Resvg(icon, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(outputDir, file), png);
  console.log(`wrote public/icons/${file} (${png.length} B)`);
}
