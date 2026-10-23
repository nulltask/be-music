---
'@be-music/player-browser': minor
---

Allow seeking during replay playback and restore the recorded view at the target. AUTO and replay playback accept the left and right arrow keys to seek five seconds; paused playback stays paused.

Keep the applied frame clock stable until the engine snapshot is drained, so a seek cannot expose the target time alongside the previous score.
