// Renders the installable player's icons into public/icons/ (docs/player-web.md, "Installing the player"). The PNGs
// are kept in git, so a build needs no renderer; after changing an icon, run:
//   pnpm --filter @be-music/app-play run build:icons
//
// Derive the maskable SVG and PNG fallbacks from the tab icon. The renderer comes from the Leaderboard package.
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
const icon = readFileSync(join(packageDir, 'public/favicon.svg'), 'utf8');
// The expanded viewBox places the playfield inside the maskable icon's 40% safe circle.
const maskable = icon.replace('viewBox="0 0 64 64"', 'viewBox="-12 -12 88 88"');

const renders = [
  { file: 'apple-touch-icon.png', svg: icon, size: 180 },
  { file: 'icon-192.png', svg: icon, size: 192 },
  { file: 'icon-512.png', svg: icon, size: 512 },
  { file: 'maskable-192.png', svg: maskable, size: 192 },
  { file: 'maskable-512.png', svg: maskable, size: 512 },
];

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'maskable.svg'), maskable);

for (const { file, svg, size } of renders) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(outputDir, file), png);
  console.log(`wrote public/icons/${file} (${png.length} B)`);
}
