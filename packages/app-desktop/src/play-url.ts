/** The player the window opens by default. */
export const DEFAULT_PLAY_URL = 'https://play.be-music.app/';

const PLAY_URL_SWITCH = '--play-url=';

/**
 * The page the window opens: `--play-url=<url>` on the command line, else the `BE_MUSIC_PLAY_URL` environment
 * variable, else the production player. The preview (`https://play.preview.be-music.app/`) and a local dev server
 * (`http://localhost:5173/`) are the usual alternatives. Throws on a value that is not an http(s) URL.
 */
export function resolvePlayURL(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): URL {
  const fromArgs = argv
    .filter((arg) => arg.startsWith(PLAY_URL_SWITCH))
    .at(-1)
    ?.slice(PLAY_URL_SWITCH.length);
  const value = fromArgs ?? (env.BE_MUSIC_PLAY_URL || undefined) ?? DEFAULT_PLAY_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Not an http(s) URL: ${value}`);
  }
  return url;
}
