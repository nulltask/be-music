/// <reference types="@cloudflare/workers-types" />

// The Accounts Worker (docs/services.md section 3). Better Auth still runs inside the Leaderboard Worker; this one gives
// it its own host, `accounts.<site>`, which is Better Auth's base URL: OAuth callbacks and every service's sign-in
// requests land here and go to the Leaderboard through the `LEADERBOARD` Service Binding. The session cookies Better
// Auth sets are shared on `<site>`, so every service reads the same session. The bare host leads to the dashboard.

import { dashboardFor, isAuthPath } from './routing.ts';

interface Env {
  /** The Leaderboard Worker, which holds Better Auth until Accounts is split out. */
  LEADERBOARD: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isAuthPath(url.pathname)) {
      return env.LEADERBOARD.fetch(request);
    }
    const dashboard = dashboardFor(url.hostname);
    if (url.pathname === '/' && dashboard !== undefined) {
      return Response.redirect(dashboard, 302);
    }
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
