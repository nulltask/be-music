/**
 * The installed player's title per environment, so a Be-Music Play window says which deployment it runs:
 * `Be-Music Play` in production, `Be-Music Play (Preview)` on the preview Worker, `Be-Music Play (Development)` on a
 * local dev server. One build serves both deployments (`cf deploy --mode preview` only changes the Worker), so the
 * Worker retitles the page and the web app manifest as it serves them, and the dev server does the same in
 * `@be-music/app-play`'s Vite config. Production is served untouched: the built files already carry its title.
 */
export type PlayEnvironment = 'development' | 'preview' | 'production';

const PLAY_APP_NAME = 'Be-Music Play';
const PLAY_APP_SHORT_NAME = 'Be-Music';
const PREVIEW_PLAY_HOST = 'play.preview.be-music.app';

const ENVIRONMENT_LABELS: Readonly<Record<PlayEnvironment, string | undefined>> = {
  development: 'Development',
  preview: 'Preview',
  production: undefined,
};

/** The deployment a Worker serves, from its public origin (`PUBLIC_ORIGIN`, cloudflare.config.ts). */
export function playEnvironmentOfOrigin(origin: string): Exclude<PlayEnvironment, 'development'> {
  return new URL(origin).hostname.toLowerCase() === PREVIEW_PLAY_HOST ? 'preview' : 'production';
}

function withEnvironmentLabel(name: string, environment: PlayEnvironment): string {
  const label = ENVIRONMENT_LABELS[environment];
  return label === undefined ? name : `${name} (${label})`;
}

/** The page title and the manifest `name`: `Be-Music Play`, with the environment after it outside production. */
export function playAppTitle(environment: PlayEnvironment): string {
  return withEnvironmentLabel(PLAY_APP_NAME, environment);
}

/** The manifest `short_name` and the home screen title on iOS (`apple-mobile-web-app-title`). */
export function playAppShortName(environment: PlayEnvironment): string {
  return withEnvironmentLabel(PLAY_APP_SHORT_NAME, environment);
}

/** The web app manifest's JSON with `name` and `short_name` set for `environment`; every other member is kept. */
export function retitleManifest(manifestJSON: string, environment: PlayEnvironment): string {
  const manifest = JSON.parse(manifestJSON) as Record<string, unknown>;
  return `${JSON.stringify(
    { ...manifest, name: playAppTitle(environment), short_name: playAppShortName(environment) },
    null,
    2,
  )}\n`;
}

/**
 * The player's HTML with its `<title>` and `apple-mobile-web-app-title` set for `environment`. For the dev server, which
 * transforms the page as a string; the Worker streams it through `HTMLRewriter` instead.
 */
export function retitleHTML(html: string, environment: PlayEnvironment): string {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${playAppTitle(environment)}</title>`)
    .replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/, `$1${playAppShortName(environment)}$2`);
}
