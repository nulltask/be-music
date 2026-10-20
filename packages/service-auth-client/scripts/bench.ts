import { Bench } from 'tinybench';
import { handleAuth, readSession, returnPath, verifyAccess, type OIDCEnv } from '../src/index.ts';
const env: OIDCEnv = {
  AUTH_ISSUER: 'https://accounts.example/api/auth',
  PUBLIC_ORIGIN: 'https://play.example',
  OIDC_CLIENT_ID: 'play',
  API_AUDIENCE: 'https://api.example',
  SESSION_SECRET: 'benchmark-secret-with-at-least-32-characters',
};
const request = new Request(`${env.PUBLIC_ORIGIN}/api/auth/get-session`);
let sink: unknown;
const bench = new Bench({ time: 100 });
bench.add('returnPath: valid local path', () => {
  sink = returnPath('/scores/123?mode=lr2');
});
bench.add('returnPath: reject network-path redirect', () => {
  sink = returnPath('//attacker.example');
});
bench.add('readSession: anonymous visitor', async () => {
  sink = await readSession(request, env);
});
bench.add('handleAuth: session endpoint for anonymous visitor', async () => {
  sink = await handleAuth(request, env);
});
bench.add('verifyAccess: missing bearer credentials', async () => {
  sink = await verifyAccess(request, env);
});
bench.add('handleAuth: browser visit suppressed after explicit sign-out', async () => {
  sink = await handleAuth(
    new Request(env.PUBLIC_ORIGIN, {
      headers: {
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        cookie: '__Host-be-music.sso-check=signed-out',
      },
    }),
    env,
  );
});
await bench.run();
console.table(bench.table());
void sink;
