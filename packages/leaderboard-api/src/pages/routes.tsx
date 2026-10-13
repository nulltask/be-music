/** @jsxImportSource hono/jsx */
import type { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { Scalar } from '@scalar/hono-api-reference';
import type { AppEnv } from '../app.ts';
import { isRuleset } from '../rulesets.ts';
import { avatarImage } from './avatar.ts';
import { chartPage } from './chart.tsx';
import { chartsetPage } from './chartset.tsx';
import { mountIcons } from './icons.ts';
import { STYLESHEET_PATH } from './layout.tsx';
import { notFound, RULESET_COOKIE_MAX_AGE } from './page.tsx';
import { playerPage } from './player.tsx';
import { RULESET_COOKIE, safeReturnPath } from './preferences.ts';
import { scorePage } from './score.tsx';
import { APP_CSS } from './styles.generated.ts';
import { topPage } from './top.tsx';

/** Server-rendered Leaderboard pages under `/leaderboard` (docs/leaderboard.md section 10). */
export function mountPages(app: Hono<AppEnv>): void {
  app.get('/leaderboard', topPage);
  app.get('/leaderboard/', topPage);
  app.get('/leaderboard/scores/:id', scorePage);
  app.get('/leaderboard/charts/:chartFingerprint', chartPage);
  app.get('/leaderboard/players/:handle', playerPage);
  app.get('/leaderboard/players/:handle/avatar', avatarImage);
  app.get('/leaderboard/chartsets/:id', chartsetPage);

  // Switches the display ruleset and goes back to the page it was switched on. A dedicated URL keeps the setting out of
  // shareable page URLs, so opening someone's link never changes the viewer's setting.
  app.get('/leaderboard/ruleset/:ruleset', (c) => {
    const ruleset = c.req.param('ruleset');
    if (isRuleset(ruleset)) {
      setCookie(c, RULESET_COOKIE, ruleset, {
        path: '/leaderboard',
        maxAge: RULESET_COOKIE_MAX_AGE,
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
      });
    }
    return c.redirect(safeReturnPath(c.req.query('next')), 303);
  });

  // The API reference, rendered by Scalar from the OpenAPI document. Its script is pinned so the page does not change
  // under us.
  app.get(
    '/leaderboard/api',
    Scalar({
      url: '/api/v0/openapi.json',
      pageTitle: 'be-music Leaderboard API',
      cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4',
      // A plain reference: no hosted AI agent and no developer toolbar.
      agent: { disabled: true },
      showDeveloperTools: 'never',
    }),
  );

  mountIcons(app);

  // The compiled stylesheet. Its name carries a content hash, so browsers and caches may keep it forever.
  app.get(STYLESHEET_PATH, (c) =>
    c.body(APP_CSS, 200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    }),
  );

  app.get('/leaderboard/*', (c) => notFound(c, 'This page'));
}
