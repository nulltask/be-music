import { bindings, defineConfig, triggers } from 'cf/config';

/**
 * Leaderboard Worker. One complete configuration per mode (`cf deploy --mode staging` deploys the staging Worker from
 * `devel`; the default mode deploys production from `main`). The Worker has no public URL of its own: the player's
 * Worker forwards `/api/*` and `/leaderboard/*` to it through a Service Binding (docs/leaderboard.md section 2).
 */
export default defineConfig(({ mode }) => {
  const staging = mode === 'staging';
  const suffix = staging ? '-staging' : '';
  // Created with `cf d1 create` (primary location APAC); the ids are not secret.
  const databaseId = staging ? '71f22d28-f646-4488-a624-dbdd4a1883d1' : 'd3791c87-75f0-4d6b-8fd9-9013f0492006';
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
        SUBMIT_LIMITER: bindings.rateLimit({ namespace: staging ? '2001' : '1001', simple: { limit: 10, period: 60 } }),
        RIVAL_LIMIT: bindings.text('100'),
        BETTER_AUTH_SECRET: bindings.secret(),
        // DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are optional secrets:
        // sign-in with a provider turns on once its pair is set (`src/auth.ts`). Declare them here only once they exist,
        // since a declared secret is required for every deploy.
      },
    },
  };
});
