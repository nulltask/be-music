interface JudgeableNote {
  channel: string;
  seconds: number;
  judged: boolean;
}

export function findBestCandidate<T extends JudgeableNote>(
  notes: T[],
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
  judgeWindowSec: number,
): T | undefined {
  let best: T | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const note of notes) {
    if (note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    const delta = Math.abs(note.seconds - nowSec);
    if (delta > judgeWindowSec) {
      continue;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      best = note;
    }
  }

  return best;
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
