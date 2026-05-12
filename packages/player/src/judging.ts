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

function lowerBoundBySeconds<T extends JudgeCandidate>(
  notes: ReadonlyArray<T>,
  target: number,
): number {
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

export function findLaneSoundCandidate<T extends JudgeableNote>(
  notes: ReadonlyArray<T>,
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
): T | undefined {
  if (notes.length === 0 || candidateChannels.size === 0) {
    return undefined;
  }

  // Bidirectional walk from the bisect pivot. Notes are sorted by `seconds`, so the
  // first matching unjudged note we encounter is the nearest unjudged candidate; once
  // we have one, every further note can only be farther away and we can stop.
  const pivot = lowerBoundBySeconds(notes, nowSec);
  let left = pivot - 1;
  let right = pivot;
  let nearestAny: T | undefined;
  let nearestAnyDelta = Number.POSITIVE_INFINITY;

  while (left >= 0 || right < notes.length) {
    const leftDelta = left >= 0 ? nowSec - notes[left]!.seconds : Number.POSITIVE_INFINITY;
    const rightDelta = right < notes.length ? notes[right]!.seconds - nowSec : Number.POSITIVE_INFINITY;
    const stepLeft = leftDelta <= rightDelta;
    let note: T;
    let delta: number;
    if (stepLeft) {
      note = notes[left]!;
      delta = leftDelta;
      left -= 1;
    } else {
      note = notes[right]!;
      delta = rightDelta;
      right += 1;
    }

    if (!candidateChannels.has(note.channel)) {
      continue;
    }
    if (!note.judged) {
      // Closest unjudged found — outward walk is monotonic in delta, so this is optimal.
      return note;
    }
    if (delta < nearestAnyDelta) {
      nearestAnyDelta = delta;
      nearestAny = note;
    }
  }

  return nearestAny;
}
