/**
 * ANY KEY (That-Which-Must-Not-Be-Named PC's assist, #751) as Be-Music reads it: whichever key is pressed takes the
 * nearest unjudged note inside the judgment window on any lane, the scratch included, and keeps that lane down until it
 * is released. A chord is taken by as many presses as it has notes, and a long note stays held until the key that took
 * its head comes up.
 *
 * The routing is an input-mapping step before judging: the judge core and the replay simulator each list the notes a
 * press could take (by their own windows), and this module picks the lane and remembers which keys hold which lanes.
 * It reads no clock and keeps no randomness, so the same inputs route the same way live, in a replay and in
 * `simulateReplay`.
 */

/** One unjudged note a press could take: its lane, its time, and `noteTimeUs - inputTimeUs` (positive = early). */
export interface AnyKeyCandidate {
  readonly channel: string;
  readonly noteTimeUs: number;
  readonly dmUs: number;
}

/**
 * Whether `candidate` is a better note for an ANY KEY press than `best`: the nearer in time wins; on a tie the earlier
 * note, then the lower channel, so the choice never depends on the order the candidates were listed in.
 */
export function preferAnyKeyCandidate(best: AnyKeyCandidate, candidate: AnyKeyCandidate): boolean {
  const bestDistance = Math.abs(best.dmUs);
  const distance = Math.abs(candidate.dmUs);
  if (distance !== bestDistance) return distance < bestDistance;
  if (candidate.noteTimeUs !== best.noteTimeUs) return candidate.noteTimeUs < best.noteTimeUs;
  return candidate.channel < best.channel;
}

/** The lane an ANY KEY press is routed to: the lane of the best candidate ({@link preferAnyKeyCandidate}), if any. */
export function selectAnyKeyLane(candidates: Iterable<AnyKeyCandidate>): string | undefined {
  let best: AnyKeyCandidate | undefined;
  for (const candidate of candidates) {
    if (best === undefined || preferAnyKeyCandidate(best, candidate)) best = candidate;
  }
  return best?.channel;
}

/**
 * The keys an input names, for routing: its tokens, or its physical lanes (`#<channel>`) when it was recorded without
 * tokens. A press and the release of the same key name the same keys.
 */
export function anyKeyRouteKeys(tokens: readonly string[], channels: Iterable<string>): string[] {
  if (tokens.length > 0) return [...tokens];
  return [...channels].map((channel) => `#${channel}`);
}

/** Which lane each pressed key holds down under ANY KEY: set when the key goes down, cleared when it comes up. */
export class AnyKeyRoutes {
  private readonly routes = new Map<string, readonly string[]>();

  /** The lanes `key` holds down, if a press routed it. */
  lanesOf(key: string): readonly string[] | undefined {
    return this.routes.get(key);
  }

  /** The lanes the routed ones among `keys` hold down; unrouted keys add nothing. */
  routedLanes(keys: readonly string[]): Set<string> {
    const lanes = new Set<string>();
    for (const key of keys) for (const lane of this.routes.get(key) ?? []) lanes.add(lane);
    return lanes;
  }

  /** A press routed `keys` to `lanes`: they hold those lanes down until released. */
  route(keys: readonly string[], lanes: Iterable<string>): void {
    const routed = [...lanes];
    for (const key of keys) this.routes.set(key, routed);
  }

  /**
   * `keys` came up: the lanes they held, or `fallback` (the keys' own lanes) for keys no press routed. The routes are
   * cleared.
   */
  release(keys: readonly string[], fallback: Iterable<string>): Set<string> {
    const lanes = new Set<string>();
    let unrouted = false;
    for (const key of keys) {
      const routed = this.routes.get(key);
      if (routed === undefined) {
        unrouted = true;
        continue;
      }
      this.routes.delete(key);
      for (const lane of routed) lanes.add(lane);
    }
    if (unrouted || keys.length === 0) for (const lane of fallback) lanes.add(lane);
    return lanes;
  }
}
