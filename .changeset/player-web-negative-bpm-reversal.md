---
'@be-music/player-web': minor
---

Render LR2's negative-BPM reverse scroll (#134): the LR2 / default gameplay scenes and the beatoraja scene scroll notes and measure lines from the chart position mirrored around the reversal, so the reverse scroll follows the post-reversal tempo; under LR2's note-drawing rules a note, mine or bar line that went before the reversal stays gone as the scroll runs back, as LR2's draw cursor never moves back; BGA cues stop changing at the reversal while a playing movie keeps running, and the NOWBPM readouts hold `|trunc(BPM)|` of the negative value. Add `beatorajaDisplayScrollBeat` for the beatoraja display layers. The BPM graph, HS-fix range, song-list BPM range, and beatoraja timing use |BPM| for negative `#BPMxx`, and the select-scene chart preview drops the triggers LR2 never fires (BGM on the reversal tick still plays).
