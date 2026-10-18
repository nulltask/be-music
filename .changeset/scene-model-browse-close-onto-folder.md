---
'@be-music/scene-model': patch
---

`reduceBrowse`'s `close` backs out onto the bar of the folder it leaves wherever the parent list has moved it, as a sort changed while the folder was open reorders the folder bars; it used to land on the row the folder was opened from, which could be another folder.
