import { cloudflareAccountId, d1DatabaseId } from '../../scripts/cloudflare/env.ts';
import { getBuildInfo } from '../../scripts/release/build-info.ts';
import { bindings, defineConfig } from 'cf/config';

/**
 * The Dashboard Worker, one configuration per environment (docs/services.md section 2): the default mode is production
 * (`dashboard`, from `main`), `cf deploy --mode preview` the preview (`dashboard-preview`, from `devel`). It is also the
 * Accounts service and the OIDC issuer (`https://<site>/api/auth`, ADR 0039).
 */
export default defineConfig(({ mode }) => {
  const buildInfo = getBuildInfo(import.meta.dirname);
  const preview = mode === 'preview';
  const site = preview ? 'preview.be-music.app' : 'be-music.app';
  const suffix = preview ? '-preview' : '';
  return {
    // The Be-Music Cloudflare account. Pinned, so a session signed in to another account cannot deploy here.
    accountId: cloudflareAccountId(),
    worker: {
      name: `dashboard${suffix}`,
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      entrypoint: './src/index.ts',
      domains: [site],
      workersDev: false,
      observability: { enabled: true },
      env: {
        BUILD_TIMESTAMP: bindings.text(buildInfo.builtAt),
        BUILD_REVISION: bindings.text(buildInfo.revision),
        SHOW_DONATE_LINK: bindings.text(String(preview)),
        DB: bindings.d1({
          name: `dashboard${suffix}`,
          id: d1DatabaseId(preview ? 'DASHBOARD_D1_PREVIEW_ID' : 'DASHBOARD_D1_PRODUCTION_ID'),
        }),
        // Avatars. The bucket keeps its Accounts name (docs/services.md section 2).
        BLOBS: bindings.r2({ name: `accounts${suffix}` }),
        AUTH_ORIGIN: bindings.text(`https://${site}`),
        PASSKEY_RP_ID: bindings.text(site),
        API_AUDIENCE: bindings.text(`https://leaderboard.${site}`),
        OIDC_CLIENTS: bindings.text(
          JSON.stringify(
            Object.fromEntries(['play', 'leaderboard', 'donate'].map((name) => [name, `https://${name}.${site}`])),
          ),
        ),
        PLAY_ORIGIN: bindings.text(`https://play.${site}/`),
        LEADERBOARD_ORIGIN: bindings.text(`https://leaderboard.${site}/`),
        DONATE_ORIGIN: bindings.text(`https://donate.${site}/`),
        BETTER_AUTH_SECRET: bindings.secret(),
        DISCORD_CLIENT_ID: bindings.secret(),
        DISCORD_CLIENT_SECRET: bindings.secret(),
        GOOGLE_CLIENT_ID: bindings.secret(),
        GOOGLE_CLIENT_SECRET: bindings.secret(),
      },
    },
  };
});
