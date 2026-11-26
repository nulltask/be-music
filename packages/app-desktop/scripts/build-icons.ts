// Renders the desktop app's icons into build/ from the web player's installed-app artwork
// (packages/app-play/scripts/icons/installed.svg). The PNGs are kept in git, so packaging needs no renderer; after
// changing the artwork, run:
//   pnpm --filter @be-music/app-desktop run build:icons
//
// macOS draws an app icon as given, so its icon sits on Apple's grid: an 824 px rounded square with a soft shadow in a
// 1024 px canvas. Windows and Linux take the full-bleed artwork. The renderer comes from the Leaderboard package.
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
const artwork = readFileSync(resolve(packageDir, '../app-play/scripts/icons/installed.svg'), 'utf8');
const outputDir = join(packageDir, 'build');

const CANVAS = 1024;
const BODY = 824;
const INSET = (CANVAS - BODY) / 2;
const RADIUS = 185;

/** The artwork's `viewBox` and the markup inside its root element. */
function splitArtwork(svg: string): { viewBox: string; inner: string } {
  const root = /<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>/u.exec(svg);
  const end = svg.lastIndexOf('</svg>');
  if (root === null || end < 0) {
    throw new Error('installed.svg: no root <svg> with a viewBox');
  }
  return { viewBox: root[1] as string, inner: svg.slice(root.index + root[0].length, end) };
}

function macOSIcon(svg: string): string {
  const { viewBox, inner } = splitArtwork(svg);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <clipPath id="mac-body"><rect x="${INSET}" y="${INSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}"/></clipPath>
    <filter id="mac-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect x="${INSET}" y="${INSET + 12}" width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="#000" opacity=".32" filter="url(#mac-shadow)"/>
  <g clip-path="url(#mac-body)">
    <svg x="${INSET}" y="${INSET}" width="${BODY}" height="${BODY}" viewBox="${viewBox}">${inner}</svg>
  </g>
</svg>`;
}

const renders = [
  { file: 'icon-mac.png', svg: macOSIcon(artwork), size: CANVAS },
  { file: 'icon.png', svg: artwork, size: CANVAS },
];

mkdirSync(outputDir, { recursive: true });
for (const { file, svg, size } of renders) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(outputDir, file), png);
  console.log(`wrote build/${file} (${png.length} B)`);
}
