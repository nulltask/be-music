/**
 * The headers that make the player cross-origin isolated (`crossOriginIsolated`), set on every response this Worker
 * serves (docs/services.md, "Player").
 *
 * Isolation coarsens `performance.now()` and `Event.timeStamp` less (Chromium clamps them to 5 µs instead of 100 µs),
 * so key presses are timed and recorded in replays more finely. It also gives the page `SharedArrayBuffer`, which the
 * BGA transcode uses to hand frames to the WebCodecs encoder.
 *
 * `credentialless` rather than `require-corp`: the page loads cross-origin resources that send no
 * `Cross-Origin-Resource-Policy` (Google Fonts, avatars on the providers' CDNs), and `credentialless` lets those load
 * without cookies instead of blocking them. A browser that does not know `credentialless` ignores the header and simply
 * stays unisolated.
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless',
};

/** `response` with {@link CROSS_ORIGIN_ISOLATION_HEADERS} set, as a new response whose headers can be changed. */
export function withCrossOriginIsolation(response: Response): Response {
  const served = new Response(response.body, response);
  for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS)) served.headers.set(name, value);
  return served;
}
