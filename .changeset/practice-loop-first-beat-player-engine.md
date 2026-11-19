---
'@be-music/player-engine': minor
---

A looping PRACTICE play no longer drops the first beat of its bars: the seek back to the loop's start rebuilt the judge up to the time it overshot the end, so the notes on the range's first beat counted as already passed, and AUTO skipped them too. `applySeek` takes a `judgeFromSeconds` that the judge and the realtime audio go to, while the clock goes on from the time sought.

A loop of picked bars is now seamless with rest bars after them too (`isSeamlessPracticeLoop`): it goes back the moment it reaches its end and draws the next round's notes through the rest, instead of waiting for the last judgments and dropping the next round's notes onto the lanes.

`PlayPractice.carriedLongNotes` keeps a long note that starts before the range and ends in it, and starts the play early enough to play it from its head.
