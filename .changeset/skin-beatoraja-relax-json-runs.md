---
'@be-music/skin-beatoraja': patch
---

JSON skins load faster: `relaxBeatorajaJSON` copies the untouched runs between its edits as slices instead of rebuilding the text one character at a time, and returns well-formed JSON unchanged, about 2.3× faster on the bundled play skin.
