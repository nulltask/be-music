import { bindings, defineConfig } from 'cf/config';

/**
 * The Accounts Worker, one configuration per environment (docs/services.md section 2): the default mode is production
 * (`accounts`, from `main`), `cf deploy --mode preview` the preview (`accounts-preview`, from `devel`). It reaches the
 * Leaderboard Worker of the same environment, which holds Better Auth, through a Service Binding.
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const suffix = preview ? '-preview' : '';
  return {
    // The be-music Cloudflare account. Pinned, so a session signed in to another account cannot deploy here.
    accountId: '80d4b5fd75f07e61a637b6bb9774186e',
    worker: {
      name: `accounts${suffix}`,
      compatibilityDate: '2026-10-01',
      entrypoint: './src/index.ts',
      domains: [preview ? 'accounts.preview.be-music.app' : 'accounts.be-music.app'],
      workersDev: false,
      observability: { enabled: true },
      env: {
        LEADERBOARD: bindings.worker({ worker: `leaderboard${suffix}` }),
      },
    },
  };
});
