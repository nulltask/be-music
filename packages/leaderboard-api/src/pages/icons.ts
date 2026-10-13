import type { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { ICONS } from './icons.generated.ts';

/** The web app manifest's path; the pages link it so a home-screen shortcut gets the icon and the name. */
export const MANIFEST_PATH = '/leaderboard/manifest.webmanifest';

/** The `<link>` tags every page carries: the tab icon, the iOS home-screen icon, and the manifest. */
export const ICON_LINKS = {
  favicon: ICONS.favicon.path,
  appleTouch: ICONS.appleTouch.path,
  manifest: MANIFEST_PATH,
} as const;

/** The web app manifest of the Leaderboard pages. */
export function webManifest() {
  return {
    name: 'be-music Leaderboard',
    short_name: 'Leaderboard',
    start_url: '/leaderboard',
    scope: '/leaderboard',
    display: 'browser',
    background_color: '#0a0e18',
    theme_color: '#0a0e18',
    icons: [ICONS.manifest192, ICONS.manifest512].map((icon) => ({
      src: icon.path,
      sizes: `${icon.size}x${icon.size}`,
      type: icon.contentType,
    })),
  };
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Serves the icons (content-hashed, cached for good) and the manifest. */
export function mountIcons(app: Hono<AppEnv>): void {
  for (const icon of Object.values(ICONS)) {
    const bytes = decode(icon.base64);
    app.get(icon.path, (c) =>
      c.body(bytes, 200, { 'content-type': icon.contentType, 'cache-control': 'public, max-age=31536000, immutable' }),
    );
  }
  app.get(MANIFEST_PATH, (c) =>
    c.body(JSON.stringify(webManifest()), 200, {
      'content-type': 'application/manifest+json',
      'cache-control': 'public, max-age=3600',
    }),
  );
}
