---
'@be-music/skin-sdk': minor
---

Add `BeMusicSelectFrame.searchEditing`: true while the host's text field sits over the skin's search box (the box bound to `actions.activateSearch`), so the skin draws the box but leaves its text to the field. The host lays its field over the last hit area the skin bound to `activateSearch`, so a skin that binds its label and its text strip separately should bind the text strip last.
