---
'@be-music/player': minor
---

Select the judged note with the ruleset's own algorithm, and add LR2's multi-BAD collector.

The engine always resolved a press against the note closest in time (beatoraja's non-default `duration` behaviour).
It now runs the active ruleset's `JudgeAlgorithm`: LR2 and IIDX use `lowest` (the oldest note in reach always wins),
beatoraja uses `combo` (the press moves to the next note once the current one has fallen out of the late side of its
GOOD window). LR2's `ignoreLateBadOnLnHead` is honoured too — a late BAD on a long-note head falls through instead of
consuming the head.

Under LR2, a press now also triggers lr2oraja's `MultiBadCollector`: every other unjudged note on the pressed lanes
that sits inside the BAD window but outside the GOOD window resolves as a BAD, with the collector's own pruning for
notes after the consumed one and for long notes before it.

The selection primitives are exported from the ruleset module as `preferJudgeCandidate` and `selectJudgeCandidate`,
and `lowerBoundBySeconds` is now exported from `@be-music/player/judging`.
