---
'@be-music/player-web': patch
---

Keep a judged note on screen until its time by default (`judgedNoteDisplay: 'KEEP_SCROLLING'`), so a note hit early keeps scrolling down to the judgement line, as LR2 and beatoraja both do. The default used to be `'HIDE'`, documented as the LR2 / beatoraja behaviour, which neither player has; `'HIDE'` stays available as a preference.
