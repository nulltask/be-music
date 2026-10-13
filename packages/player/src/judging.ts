export interface JudgeCandidate {
  channel: string;
  seconds: number;
}

interface JudgeableNote extends JudgeCandidate {
  judged: boolean;
}

export interface FindClosestCandidateOptions<T extends JudgeCandidate> {
  nowSec: number;
  judgeWindowSec: number;
  candidateChannels?: ReadonlySet<string>;
  channel?: string;
  startIndex?: number;
  sortedBySeconds?: boolean;
  isConsumed?: (candidate: T) => boolean;
}

/** First index in a time-sorted note array whose `seconds` is at least `target`. */
export function lowerBoundBySeconds<T extends JudgeCandidate>(notes: ReadonlyArray<T>, target: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (notes[mid]!.seconds < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function findClosestCandidateInWindow<T extends JudgeCandidate>(
  notes: ReadonlyArray<T>,
  options: FindClosestCandidateOptions<T>,
): T | undefined {
  let best: T | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  let startIndex = Math.max(0, Math.trunc(options.startIndex ?? 0));
  if (options.sortedBySeconds === true && options.startIndex === undefined) {
    // Skip the entire prefix before the window opens — O(log N) instead of O(N).
    startIndex = lowerBoundBySeconds(notes, options.nowSec - options.judgeWindowSec);
  }
  for (let index = startIndex; index < notes.length; index += 1) {
    const note = notes[index]!;
    const signedDelta = note.seconds - options.nowSec;
    if (options.sortedBySeconds === true && signedDelta > options.judgeWindowSec) {
      break;
    }
    if (options.channel !== undefined && note.channel !== options.channel) {
      continue;
    }
    if (options.candidateChannels !== undefined && !options.candidateChannels.has(note.channel)) {
      continue;
    }
    if (options.isConsumed?.(note) === true) {
      continue;
    }
    const delta = Math.abs(signedDelta);
    if (delta > options.judgeWindowSec) {
      continue;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      best = note;
    }
  }
  return best;
}

export function findBestCandidate<T extends JudgeableNote>(
  notes: ReadonlyArray<T>,
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
  judgeWindowSec: number,
): T | undefined {
  return findClosestCandidateInWindow(notes, {
    candidateChannels,
    nowSec,
    judgeWindowSec,
    sortedBySeconds: true,
    isConsumed: noteIsJudged,
  });
}

function noteIsJudged(note: JudgeableNote): boolean {
  return note.judged;
}

export function findLaneSoundCandidate<T extends JudgeCandidate>(
  notes: ReadonlyArray<T>,
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
  activationWindowSec = 0,
): T | undefined {
  if (notes.length === 0 || candidateChannels.size === 0) {
    return undefined;
  }

  // LR2-style lane sound hold: do not look ahead to the closest future note. A lane's fallback sound only advances
  // when that note's early judgment window has opened, then remains current until the next same-lane window opens.
  const latestEligibleSeconds = nowSec + Math.max(0, activationWindowSec) + 1e-9;
  for (let index = lowerBoundBySeconds(notes, latestEligibleSeconds); index > 0; ) {
    index -= 1;
    const note = notes[index]!;
    if (!candidateChannels.has(note.channel)) {
      continue;
    }
    return note;
  }

  return undefined;
}
