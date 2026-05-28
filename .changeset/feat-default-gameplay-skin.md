---
'@be-music/player-web': minor
---

Separate default-chrome injection from the LR2 gameplay scene and improve the default skin's layout / rendering:

- New `scene/gameplay-chrome.ts` and `scene/gameplay-lanes.ts` modules pull the shared chrome / lane drawing out of the LR2 scene so the default gameplay scene can paint its own chrome without dragging the LR2 skin pipeline along. The LR2 gameplay scene now consumes those modules instead of inlining the chrome construction.
- The default gameplay scene's font setup, lane sizing, and decide / result transitions land closer to the LR2 skin's authored values, so charts that load without a skin render with a more readable playfield instead of the previous bare placeholder.
- Result-delay / autoplay behaviour coverage is extended along the way (new test paths in the LR2 result scene + select scene refactor) so future changes against the same areas surface regressions earlier.
