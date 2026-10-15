---
'@be-music/player': patch
---

Fix long-note releases waiting 120 ms before they settled, so a re-press within that time (or a key chatter) continued a long note that LR2 and beatoraja end at the release, and a release reached the score after presses made at the same instant. With key-state input a release now settles at once, except under the ruleset's new `longNoteReleaseMarginUs` (beatoraja's 200 ms `longnoteMargin` on PMS keys), where a BAD-or-worse early release waits and a re-press resumes the hold; the play-log simulator applies the same margin.
