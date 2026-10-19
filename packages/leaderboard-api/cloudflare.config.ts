import { bindings, defineConfig, triggers } from 'cf/config';

/**
 * Leaderboard Worker, one complete configuration per environment (docs/services.md section 2): the default mode is
 * production (`leaderboard`, from `main`), `cf deploy --mode preview` the preview (`leaderboard-preview`, from `devel`).
 *
 * It serves its pages on its own host, and holds Better Auth for every service until Accounts is split out: the
 * Accounts, Player and Dashboard Workers reach it through Service Bindings, and its session cookies are shared on the
 * environment's parent domain (docs/services.md section 3).
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const suffix = preview ? '-preview' : '';
  // `be-music.app` for production, `preview.be-music.app` for the preview.
  const site = preview ? 'preview.be-music.app' : 'be-music.app';
  // Created with `cf d1 create` (primary location APAC); the ids are not secret.
  const databaseId = preview ? 'f4f59881-e902-450c-892b-d764c481eb46' : 'd3791c87-75f0-4d6b-8fd9-9013f0492006';
  return {
    worker: {
      name: `leaderboard${suffix}`,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      // Bundled by Vite+ (`build:worker`, vite.worker.config.ts) from src/index.ts.
      entrypoint: './dist/worker.js',
      domains: [`leaderboard.${site}`],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
      // Run next to D1 rather than next to the visitor: a page makes several queries, each a round trip to the
      // database, while the other Workers reach this one once per request through a Service Binding. Both databases'
      // primaries are in Hong Kong (`served_by_colo: HKG` in D1's query metadata), so the Worker is pinned to the
      // cloud region there; Smart Placement alone never moved it at this traffic.
      placement: { region: 'aws:ap-east-1' },
      // Hourly: ask BMS Search which work new and stale charts belong to (src/chartsets/refresh.ts).
      triggers: [triggers.scheduled({ schedule: '17 * * * *' })],
      env: {
        // The databases and buckets keep their names from before the services were split.
        DB: bindings.d1({ name: `be-music-leaderboard${suffix}`, id: databaseId }),
        BLOBS: bindings.r2({ name: `be-music-leaderboard${suffix}` }),
        SUBMIT_LIMITER: bindings.rateLimit({ namespace: preview ? '2001' : '1001', simple: { limit: 10, period: 60 } }),
        RIVAL_LIMIT: bindings.text('100'),
        AUTH_ORIGIN: bindings.text(`https://accounts.${site}`),
        COOKIE_DOMAIN: bindings.text(site),
        // Production's parent-domain cookies reach the preview's hosts too, so the preview names its own.
        ...(preview ? { COOKIE_PREFIX: bindings.text('be-music-preview') } : {}),
        TRUSTED_ORIGINS: bindings.text(
          ['', 'play.', 'leaderboard.', 'donate.'].map((sub) => `https://${sub}${site}`).join(','),
        ),
        PASSKEY_RP_ID: bindings.text(site),
        BETTER_AUTH_SECRET: bindings.secret(),
        // DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are optional secrets:
        // sign-in with a provider turns on once its pair is set (`src/auth.ts`). Declare them here only once they exist,
        // since a declared secret is required for every deploy.
      },
    },
  };
});
