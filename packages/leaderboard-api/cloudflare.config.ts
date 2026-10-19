import { bindings, defineConfig, triggers } from 'cf/config';

/**
 * Leaderboard Worker, one complete configuration per environment (docs/services.md section 2): the default mode is
 * production (`leaderboard`, from `main`), `cf deploy --mode preview` the preview (`leaderboard-preview`, from `devel`).
 *
 * It owns public profiles and scores. Accounts owns authentication separately; this Worker accepts its own host-only
 * OIDC session or an Accounts access token bound to this API. The Player and Dashboard call it through bindings.
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const suffix = preview ? '-preview' : '';
  // `be-music.app` for production, `preview.be-music.app` for the preview.
  const site = preview ? 'preview.be-music.app' : 'be-music.app';
  // Created with `cf d1 create` (primary location APAC); the ids are not secret.
  const databaseId = preview ? '046723a8-244b-42ca-ad49-01c1914333f1' : '2cb01ebf-4a70-4582-bb38-4e2e925bff61';
  return {
    accountId: '80d4b5fd75f07e61a637b6bb9774186e',
    worker: {
      name: `leaderboard${suffix}`,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
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
        DB: bindings.d1({ name: `leaderboard${suffix}`, id: databaseId }),
        // The buckets keep their names from before the services were split.
        BLOBS: bindings.r2({ name: `be-music-leaderboard${suffix}` }),
        SUBMIT_LIMITER: bindings.rateLimit({ namespace: preview ? '2001' : '1001', simple: { limit: 10, period: 60 } }),
        RIVAL_LIMIT: bindings.text('100'),
        AUTH_ISSUER: bindings.text(`https://accounts.${site}/api/auth`),
        PUBLIC_ORIGIN: bindings.text(`https://leaderboard.${site}`),
        OIDC_CLIENT_ID: bindings.text('leaderboard'),
        API_AUDIENCE: bindings.text(`https://leaderboard.${site}`),
        SESSION_SECRET: bindings.secret(),
      },
    },
  };
});
