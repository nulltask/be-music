import { bindings, defineConfig, triggers } from 'cf/config';

/**
 * Leaderboard Worker. One complete configuration per mode (`cf deploy --mode preview` deploys the preview Worker,
 * shared by every branch but `devel`; the default mode deploys production from `devel`). The Worker has no public URL of its own: the player's
 * Worker forwards `/api/*` and `/leaderboard/*` to it through a Service Binding (docs/leaderboard.md section 2).
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const suffix = preview ? '-preview' : '';
  // Created with `cf d1 create` (primary location APAC); the ids are not secret.
  const databaseId = preview ? 'f4f59881-e902-450c-892b-d764c481eb46' : 'd3791c87-75f0-4d6b-8fd9-9013f0492006';
  return {
    worker: {
      name: `be-music-leaderboard${suffix}`,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      entrypoint: './src/index.ts',
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
      // Hourly: ask BMS Search which work new and stale charts belong to (src/chartsets/refresh.ts).
      triggers: [triggers.scheduled({ schedule: '17 * * * *' })],
      env: {
        DB: bindings.d1({ name: `be-music-leaderboard${suffix}`, id: databaseId }),
        BLOBS: bindings.r2({ name: `be-music-leaderboard${suffix}` }),
        SUBMIT_LIMITER: bindings.rateLimit({ namespace: preview ? '2001' : '1001', simple: { limit: 10, period: 60 } }),
        RIVAL_LIMIT: bindings.text('100'),
        BETTER_AUTH_SECRET: bindings.secret(),
        // DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are optional secrets:
        // sign-in with a provider turns on once its pair is set (`src/auth.ts`). Declare them here only once they exist,
        // since a declared secret is required for every deploy.
      },
    },
  };
});
