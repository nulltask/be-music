---
'@be-music/player-skin-sdk': minor
---

Add `resolveResultCourseScroll` and `BeMusicResultFrame.shownMs`: a course card whose stages, laid out at their usual height, run past the card scrolls its stage list up, resting at the top and bottom and starting over, by the time the result has been shown (`shownMs` goes on after the entrance, where `elapsedMs` turns `Infinity`).
