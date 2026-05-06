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

export function findClosestCandidateInWindow<T extends JudgeCandidate>(
  notes: ReadonlyArray<T>,
  options: FindClosestCandidateOptions<T>,
): T | undefined {
  let best: T | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  const startIndex = Math.max(0, Math.trunc(options.startIndex ?? 0));
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
  notes: T[],
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
  judgeWindowSec: number,
): T | undefined {
  return findClosestCandidateInWindow(notes, {
    candidateChannels,
    nowSec,
    judgeWindowSec,
    isConsumed: (note) => note.judged,
  });
}

export function findLaneSoundCandidate<T extends JudgeableNote>(
  notes: T[],
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
): T | undefined {
  let nearestUnjudged: T | undefined;
  let nearestUnjudgedDelta = Number.POSITIVE_INFINITY;
  let nearestAny: T | undefined;
  let nearestAnyDelta = Number.POSITIVE_INFINITY;

  for (const note of notes) {
    if (!candidateChannels.has(note.channel)) {
      continue;
    }

    const delta = Math.abs(note.seconds - nowSec);
    if (delta < nearestAnyDelta) {
      nearestAnyDelta = delta;
      nearestAny = note;
    }

    if (note.judged) {
      continue;
    }
    if (delta < nearestUnjudgedDelta) {
      nearestUnjudgedDelta = delta;
      nearestUnjudged = note;
    }
  }

  return nearestUnjudged ?? nearestAny;
}
