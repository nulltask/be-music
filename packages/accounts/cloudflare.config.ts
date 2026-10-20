import { getBuildInfo } from '../../scripts/release/build-info.ts';
import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ mode }) => {
  const buildInfo = getBuildInfo(import.meta.dirname);
  const preview = mode === 'preview';
  const site = preview ? 'preview.be-music.app' : 'be-music.app';
  const suffix = preview ? '-preview' : '';
  return {
    accountId: '<CLOUDFLARE_ACCOUNT_ID>',
    worker: {
      name: `accounts${suffix}`,
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat'],
      entrypoint: './src/index.ts',
      domains: [`accounts.${site}`],
      workersDev: false,
      observability: { enabled: true },
      env: {
        BUILD_TIMESTAMP: bindings.text(buildInfo.builtAt),
        BUILD_REVISION: bindings.text(buildInfo.revision),
        SHOW_DONATE_LINK: bindings.text(String(preview)),
        DB: bindings.d1({
          name: `accounts${suffix}`,
          id: preview ? '<D1_DATABASE_ID>' : '<D1_DATABASE_ID>',
        }),
        BLOBS: bindings.r2({ name: `accounts${suffix}` }),
        AUTH_ORIGIN: bindings.text(`https://accounts.${site}`),
        PASSKEY_RP_ID: bindings.text(site),
        API_AUDIENCE: bindings.text(`https://leaderboard.${site}`),
        OIDC_CLIENTS: bindings.text(
          JSON.stringify(
            Object.fromEntries(
              ['dashboard', 'play', 'leaderboard', 'donate'].map((name) => [
                name,
                `https://${name === 'dashboard' ? '' : name + '.'}${site}`,
              ]),
            ),
          ),
        ),
        BETTER_AUTH_SECRET: bindings.secret(),
      },
    },
  };
});
