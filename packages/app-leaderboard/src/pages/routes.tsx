/** @jsxImportSource hono/jsx */
import type { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { Scalar } from '@scalar/hono-api-reference';
import type { AppEnv } from '../app.ts';
import { isRuleset } from '../rulesets.ts';
import { isLocale, LOCALE_COOKIE } from './i18n/index.ts';
import { aboutPage } from './about.tsx';
import { avatarImage } from './avatar.ts';
import { helpPage } from './help.tsx';
import { scoreCardImage } from './card.ts';
import { mountClientScript } from './client-script.ts';
import { chartPage } from './chart.tsx';
import { chartsetPage } from './chartset.tsx';
import { coursePage } from './course.tsx';
import { courseRunPage } from './course-run.tsx';
import { mountIcons } from './icons.ts';
import { STYLESHEET_PATH } from './layout.tsx';
import { notFound, RULESET_COOKIE_MAX_AGE } from './page.tsx';
import { playerPage } from './player.tsx';
import { RULESET_COOKIE, safeReturnPath } from './preferences.ts';
import { scorePage } from './score.tsx';
import { settingsPage } from './settings.tsx';
import { APP_CSS } from './styles.generated.ts';
import { topPage } from './top.tsx';
import { loadViewer } from './viewer.ts';

/** Server-rendered Leaderboard pages, at the root of the Leaderboard's own host (docs/leaderboard.md section 10). */
export function mountPages(app: Hono<AppEnv>): void {
  // Every page knows who is looking (the header shows the account); assets skip the lookup.
  app.use('/', loadViewer);
  app.use('/*', loadViewer);

  app.get('/', topPage);
  app.get('/scores/:id', scorePage);
  app.get('/scores/:id/card', scoreCardImage);
  app.get('/charts/:chartFingerprint', chartPage);
  app.get('/courses/:courseFingerprint', coursePage);
  app.get('/course-scores/:id', courseRunPage);
  app.get('/players/:handle', playerPage);
  app.get('/players/:handle/avatar', avatarImage);
  app.get('/chartsets/:id', chartsetPage);
  app.get('/settings', settingsPage);
  app.get('/about', aboutPage);
  app.get('/help', helpPage);

  // Switches the display ruleset and goes back to the page it was switched on. A dedicated URL keeps the setting out of
  // shareable page URLs, so opening someone's link never changes the viewer's setting.
  app.get('/ruleset/:ruleset', (c) => {
    const ruleset = c.req.param('ruleset');
    if (isRuleset(ruleset)) {
      setCookie(c, RULESET_COOKIE, ruleset, {
        path: '/',
        maxAge: RULESET_COOKIE_MAX_AGE,
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
      });
    }
    return c.redirect(safeReturnPath(c.req.query('next')), 303);
  });

  // Switches the page language, like the ruleset switch: kept in a cookie, then back to the page it was switched on.
  app.get('/lang/:locale', (c) => {
    const locale = c.req.param('locale');
    if (isLocale(locale)) {
      setCookie(c, LOCALE_COOKIE, locale, {
        path: '/',
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
    '/api-reference',
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
  mountClientScript(app);

  // The compiled stylesheet. Its name carries a content hash, so browsers and caches may keep it forever.
  app.get(STYLESHEET_PATH, (c) =>
    c.body(APP_CSS, 200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    }),
  );

  app.get('/*', (c) => notFound(c, 'page'));
}
