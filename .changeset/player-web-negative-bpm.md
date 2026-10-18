---
'@be-music/player-web': minor
---

Render LR2's negative-BPM reverse scroll (#134). Every family scrolls notes and bar lines from the chart position mirrored around the reversal, so the reverse scroll follows the post-reversal tempo. Under LR2's note-drawing rules a note, mine or bar line that went before the reversal stays gone as the scroll runs back, as LR2's draw cursor never moves back. BGA cues stop changing at the reversal while a playing movie keeps running, and the NOWBPM readouts hold `|trunc(BPM)|` of the negative value. The BPM graph, the HS-FIX range, the song list's BPM range and the beatoraja timing use |BPM| for a negative `#BPMxx`, and the select screen's chart preview drops the triggers LR2 never fires (BGM on the reversal tick still plays).
