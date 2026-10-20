import { getBuildInfo } from '../../scripts/release/build-info.ts';
import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ mode }) => {
  const buildInfo = getBuildInfo(import.meta.dirname);
  const preview = mode === 'preview';
  const site = preview ? 'preview.be-music.app' : 'be-music.app';
  const suffix = preview ? '-preview' : '';
  return {
    accountId: '80d4b5fd75f07e61a637b6bb9774186e',
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
          id: preview ? '3fc82533-baf9-4e50-99dc-9fb38b80b0a7' : '4b5b02cc-a446-4026-b72d-4f973fc7a8fe',
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
