import { bindings, defineConfig } from 'cf/config';

/**
 * Leaderboard Worker. One complete configuration per mode (`cf deploy --mode staging` deploys the staging Worker from
 * `devel`; the default mode deploys production from `main`). The Worker has no public URL of its own: the player's
 * Worker forwards `/api/*` and `/leaderboard/*` to it through a Service Binding (docs/leaderboard.md section 2).
 */
export default defineConfig(({ mode }) => {
  const staging = mode === 'staging';
  const suffix = staging ? '-staging' : '';
  return {
    worker: {
      name: `be-music-leaderboard${suffix}`,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      entrypoint: './src/index.ts',
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
      env: {
        DB: bindings.d1({ name: `be-music-leaderboard${suffix}` }),
        BLOBS: bindings.r2({ name: `be-music-leaderboard${suffix}` }),
        SUBMIT_LIMITER: bindings.rateLimit({ namespace: staging ? '2001' : '1001', simple: { limit: 10, period: 60 } }),
        RIVAL_LIMIT: bindings.text('100'),
        BETTER_AUTH_SECRET: bindings.secret(),
        DISCORD_CLIENT_ID: bindings.secret(),
        DISCORD_CLIENT_SECRET: bindings.secret(),
        GOOGLE_CLIENT_ID: bindings.secret(),
        GOOGLE_CLIENT_SECRET: bindings.secret(),
      },
    },
  };
});
