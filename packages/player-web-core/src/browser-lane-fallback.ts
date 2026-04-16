import type { BeMusicEvent } from '@be-music/json';

interface LaneFallbackNote {
  channel: string;
  seconds: number;
  judged: boolean;
  event: Pick<BeMusicEvent, 'channel' | 'value'>;
}

export type BrowserLaneFallbackCandidate = LaneFallbackNote;

export function findBestBrowserLaneFallbackCandidate(
  playableNotes: ReadonlyArray<LaneFallbackNote>,
  invisibleNotes: ReadonlyArray<LaneFallbackNote>,
  candidateChannels: ReadonlyArray<string>,
  nowSeconds: number,
): BrowserLaneFallbackCandidate | undefined {
  const candidateSet = new Set(candidateChannels);
  const unjudgedCandidates = collectCandidates(playableNotes, invisibleNotes, candidateSet, false);
  const nearestUnjudged = findNearestCandidate(unjudgedCandidates, nowSeconds);
  if (nearestUnjudged) {
    return nearestUnjudged;
  }
  const allCandidates = collectCandidates(playableNotes, invisibleNotes, candidateSet, true);
  return findNearestCandidate(allCandidates, nowSeconds);
}

function collectCandidates(
  playableNotes: ReadonlyArray<LaneFallbackNote>,
  invisibleNotes: ReadonlyArray<LaneFallbackNote>,
  candidateSet: ReadonlySet<string>,
  includeJudged: boolean,
): BrowserLaneFallbackCandidate[] {
  const candidates: BrowserLaneFallbackCandidate[] = [];
  for (const note of playableNotes) {
    if (!candidateSet.has(note.channel)) {
      continue;
    }
    if (!includeJudged && note.judged) {
      continue;
    }
    candidates.push(note);
  }
  for (const note of invisibleNotes) {
    if (!candidateSet.has(note.channel)) {
      continue;
    }
    if (!includeJudged && note.judged) {
      continue;
    }
    candidates.push(note);
  }
  return candidates;
}

function findNearestCandidate(
  candidates: ReadonlyArray<BrowserLaneFallbackCandidate>,
  nowSeconds: number,
): BrowserLaneFallbackCandidate | undefined {
  let best: BrowserLaneFallbackCandidate | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate.seconds - nowSeconds);
    if (delta >= bestDelta) {
      continue;
    }
    best = candidate;
    bestDelta = delta;
  }
  return best;
}
