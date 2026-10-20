/**
 * When a lane's key went down and came up, kept for a short while so the judge can ask whether the lane was down at
 * an instant that has already passed — the moment a mine crossed the judge line, say — however late the question
 * comes and in whatever order the driver delivered the inputs around it.
 *
 * A lane counts as down while any physical input holding it is: a second key on the same lane (two scratch keys) going
 * down or up while the first stays down changes nothing.
 */
export interface LaneHoldHistory {
  /** The key tokens holding the lane now (`''` stands for an input that came without tokens). */
  readonly activeTokens: Set<string>;
  /** The lane's down spans, oldest first; the last one's `upMs` is `undefined` while the lane is down. */
  readonly spans: Array<{ downMs: number; upMs: number | undefined }>;
}

/** How long (ms) spans are kept after they end. */
export const LANE_HOLD_HISTORY_MS = 2000;

/** The token an input without tokens is tracked under. */
const UNNAMED_TOKEN = '';

export function createLaneHoldHistory(): LaneHoldHistory {
  return { activeTokens: new Set(), spans: [] };
}

function prune(history: LaneHoldHistory, atMs: number): void {
  const horizonMs = atMs - LANE_HOLD_HISTORY_MS;
  let spanCount = 0;
  while (spanCount < history.spans.length) {
    const upMs = history.spans[spanCount]!.upMs;
    if (upMs === undefined || upMs >= horizonMs) break;
    spanCount += 1;
  }
  if (spanCount > 0) history.spans.splice(0, spanCount);
}

/** A press at `atMs` by `tokens` (none: an unnamed input). */
export function recordLaneDown(history: LaneHoldHistory, tokens: readonly string[], atMs: number): void {
  prune(history, atMs);
  const wasDown = history.activeTokens.size > 0;
  if (tokens.length === 0) {
    history.activeTokens.add(UNNAMED_TOKEN);
  } else {
    for (const token of tokens) history.activeTokens.add(token);
  }
  if (!wasDown) history.spans.push({ downMs: atMs, upMs: undefined });
}

/** A release at `atMs` of `tokens` (none: every input holding the lane). */
export function recordLaneUp(history: LaneHoldHistory, tokens: readonly string[], atMs: number): void {
  if (history.activeTokens.size === 0) return;
  if (tokens.length === 0) {
    history.activeTokens.clear();
  } else {
    for (const token of tokens) history.activeTokens.delete(token);
    // An unnamed press is released by any release of the lane.
    history.activeTokens.delete(UNNAMED_TOKEN);
  }
  if (history.activeTokens.size > 0) return;
  const open = history.spans[history.spans.length - 1];
  if (open !== undefined && open.upMs === undefined) open.upMs = Math.max(open.downMs, atMs);
}

/**
 * Whether the lane was down at `atMs`. At an instant shared by an input and the question, the input comes first: a key
 * that goes down at `atMs` is down, one that comes up at `atMs` is not.
 */
export function wasLaneDownAt(history: LaneHoldHistory, atMs: number): boolean {
  for (let index = history.spans.length - 1; index >= 0; index -= 1) {
    const span = history.spans[index]!;
    if (span.downMs > atMs) continue;
    return span.upMs === undefined || span.upMs > atMs;
  }
  return false;
}
