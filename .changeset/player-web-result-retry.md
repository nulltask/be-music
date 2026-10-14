---
'@be-music/player-web': minor
---

Add an `onRetry` option to the result scenes (`PixiResultView`, `DefaultPixiResultView`, `PixiBeatorajaResultScene`): pressing R on the result screen (no modifier keys, not an auto-repeat) after the input-enable delay fires it once, so a host can start the same chart again without going back to song select. On beatoraja skins it fires after the skin's fadeout, like `onContinue`. Without the option R does nothing, and Enter / Space / Escape behave as before.
