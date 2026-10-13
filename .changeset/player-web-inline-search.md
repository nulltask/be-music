---
'@be-music/player-web': minor
---

Let hosts edit the select screen's search query in place, inside the skin. The select views gain `getSearchFieldRect()` (the skin's search box in canvas CSS pixels: a be-music skin's `activateSearch` hit area, or an LR2 skin's `#SRC_TEXT st=30`, widened when it hugs an empty text) and `setSearchEditing(editing)`, which hands the box's text to the host's field while it is laid over it. LR2 skins now show the search word they used to leave blank. The built-in skins split their search hit area into the label and the text strip, and Plain gains a clickable search box. The beatoraja select scene gains `setSearchQuery` and an `externalSearch` option that leaves `/` and typed keys to the host's field, and ignores keys typed in text fields.
