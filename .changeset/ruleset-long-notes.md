---
'@be-music/player': minor
---

Play long notes the way the active ruleset does, and count their judgments accordingly.

The engine used to read the chart's `#LNMODE` directly and always resolve a long note into a single combined
judgment. It now maps the chart mode through the ruleset's long-note style first:

- LR2 (`ln`) plays every long note as an LN — one deferred judgment, no CN or HCN, whatever `#LNMODE` asks for.
- beatoraja (`per-note`) honours the chart: mode 1 is an LN, modes 2 and 3 are CN / HCN.
- IIDX (`charge`) has no LN — every long note is a charge note (HCN where the chart says 3).

Charge modes score the head on the press and the tail on the release, so one long note contributes two judgments,
which is what `PlayerSummary.total` (the ruleset's EX-SCORE denominator) has always counted. Under IIDX a broken
head cancels the tail (`headBadSkipsTail`).

Two timing fixes fall out of this:

- The tail is judged against the exact release instant instead of whichever frame noticed it. At high `speed` a frame
  can span hundreds of chart milliseconds, which quantized a clean release into a GOOD or worse.
- Holding a charge note past its tail is no longer an immediate judgment: the player has until the tail's late window
  closes to let go, matching the play-log simulator and the reference players.

The end-of-play backfill now counts unjudged notes instead of topping the tally up to `summary.total`, which was
inventing a POOR for every IIDX charge note whose tail was cancelled.
