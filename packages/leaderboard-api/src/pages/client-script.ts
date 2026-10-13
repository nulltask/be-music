import type { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { CLIENT_JS, CLIENT_JS_HASH } from './client.generated.ts';

/** Where the pages' client script (client/main.ts) is served; the hash in the name lets browsers keep it forever. */
export const CLIENT_SCRIPT_PATH = `/leaderboard/assets/client.${CLIENT_JS_HASH}.js`;

export function mountClientScript(app: Hono<AppEnv>): void {
  app.get(CLIENT_SCRIPT_PATH, (c) =>
    c.body(CLIENT_JS, 200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    }),
  );
}
