// Renders the installable player's icons into public/icons/ (docs/player-web.md, "Installing the player"). The PNGs
// are kept in git, so a build needs no renderer; after changing an icon, run:
//   pnpm --filter @be-music/app-play run build:icons
//
// The art is the Leaderboard's (packages/app-leaderboard/src/pages/icons/icon.svg), the player's tab icon
// public/favicon.svg: 180 px for the iOS home screen and 192 / 512 px for the web app manifest. The maskable icon,
// which launchers crop to their own shape, comes from scripts/icons/maskable.svg, the same art padded into the safe zone.
//
// The renderer is the Leaderboard's (`@resvg/resvg-js`, its devDependency, which renders the same art there), loaded
// from that package rather than added here: this one-off generator is the player's only use of it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/** The part of `@resvg/resvg-js` this script uses. */
interface ResvgModule {
  Resvg: new (
    svg: Buffer,
    options: { fitTo: { mode: 'width'; value: number }; shapeRendering: 0 | 1 | 2 },
  ) => { render(): { asPng(): Buffer } };
}

const packageDir = resolve(import.meta.dirname, '..');
const leaderboardRequire = createRequire(resolve(packageDir, '../app-leaderboard/package.json'));
const { Resvg } = leaderboardRequire('@resvg/resvg-js') as ResvgModule;
const outputDir = join(packageDir, 'public/icons');
const icon = readFileSync(join(packageDir, 'public/favicon.svg'));
const maskable = readFileSync(join(packageDir, 'scripts/icons/maskable.svg'));

const renders = [
  { file: 'apple-touch-icon.png', svg: icon, size: 180 },
  { file: 'icon-192.png', svg: icon, size: 192 },
  { file: 'icon-512.png', svg: icon, size: 512 },
  { file: 'maskable-192.png', svg: maskable, size: 192 },
  { file: 'maskable-512.png', svg: maskable, size: 512 },
];

mkdirSync(outputDir, { recursive: true });
for (const { file, svg, size } of renders) {
  // `shapeRendering: 0` (crispEdges) keeps the pixel art's lane edges sharp at sizes that are not a multiple of 32.
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, shapeRendering: 0 }).render().asPng();
  writeFileSync(join(outputDir, file), png);
  console.log(`wrote public/icons/${file} (${png.length} B)`);
}
