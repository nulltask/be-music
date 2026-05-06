---
'@be-music/player': patch
'@be-music/player-web': patch
---

Fix two LN-effect regressions on the web runtime:

1. **AUTO LN lane laser fading out mid-LN.** The renderer's
   `applyEngineCommand` handler for `hold-lane-until-beat` did not add
   the lane to `pressedChannels`, so the `flash-lane` command emitted
   in the same tick on the LN HEAD scheduled a `flashKeyOnTimer`
   setTimeout that called `releaseKeyOnTimer` ~`KEY_ON_FLASH_HOLD_MS`
   later (because the auto-release skip path checks
   `pressedChannels.has(channel)`). The lane laser therefore faded out
   ~150 ms into the LN even though the LN body kept scrolling. Adding
   the channel to `pressedChannels` on `hold-lane-until-beat` makes the
   auto-release skip the same way it does for a real key press, and
   the laser stays lit for the full LN sustain. The matching
   `release-lane` (emitted at the LN tail by
   `drainPendingAutoLongNotes` / `drainPendingAutoScratchLongNotes`)
   removes the channel and the laser fades out at the tail timing.

2. **MANUAL LN-hold effect (sustain glow / hold sparkles) not showing.**
   The engine was emitting `hold-lane-until-beat` only on the autoplay
   LN-head path (`applyDueAutoPlayableJudgements` and
   `applyAutoScratchJudgements`); the manual LN-head path inside
   `handleMappedInputTokens` did not emit it. Without that command the
   renderer never called `startLnHoldTimer`, the LR2 LN-hold timer
   (70..89) stayed unset, and skin elements gated on it (the sustain
   glow and hold-sparkle authored by the LR2 default skin) stayed
   invisible for the whole hold. The manual LN-head path now emits
   `hold-lane-until-beat` for every LN start (mode 1 / 2 / 3), and the
   matching `release-lane` is fired from `finalizeActiveLongNote` so
   the timer fades out at every manual LN resolution moment (early
   release through `kitty-state`, mode-1 grace expiry, or end-beat
   reached).
