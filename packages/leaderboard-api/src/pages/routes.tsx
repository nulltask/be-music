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

/** Server-rendered Leaderboard pages under `/leaderboard` (docs/leaderboard.md section 10). */
export function mountPages(app: Hono<AppEnv>): void {
  // Every page knows who is looking (the header shows the account); assets skip the lookup.
  app.use('/leaderboard', loadViewer);
  app.use('/leaderboard/*', loadViewer);

  app.get('/leaderboard', topPage);
  app.get('/leaderboard/', topPage);
  app.get('/leaderboard/scores/:id', scorePage);
  app.get('/leaderboard/scores/:id/card', scoreCardImage);
  app.get('/leaderboard/charts/:chartFingerprint', chartPage);
  app.get('/leaderboard/courses/:courseFingerprint', coursePage);
  app.get('/leaderboard/course-scores/:id', courseRunPage);
  app.get('/leaderboard/players/:handle', playerPage);
  app.get('/leaderboard/players/:handle/avatar', avatarImage);
  app.get('/leaderboard/chartsets/:id', chartsetPage);
  app.get('/leaderboard/settings', settingsPage);
  app.get('/leaderboard/about', aboutPage);
  app.get('/leaderboard/help', helpPage);

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

  // Switches the page language, like the ruleset switch: kept in a cookie, then back to the page it was switched on.
  app.get('/leaderboard/lang/:locale', (c) => {
    const locale = c.req.param('locale');
    if (isLocale(locale)) {
      setCookie(c, LOCALE_COOKIE, locale, {
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
  mountClientScript(app);

  // The compiled stylesheet. Its name carries a content hash, so browsers and caches may keep it forever.
  app.get(STYLESHEET_PATH, (c) =>
    c.body(APP_CSS, 200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    }),
  );

  app.get('/leaderboard/*', (c) => notFound(c, 'page'));
}
