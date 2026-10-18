---
'@be-music/skin-sdk': minor
---

Give the select frame what course bars, touch scrolling and in-place search need:

- `focusedCourse`, the course bar under the cursor, and `describeCourseCard(course, record)`, the lines a select card shows for it (its name, its kind and stage count, its stages, and the best lamp and trophy). PLAY and AUTO start a focused course.
- `courseRecord(course)`, the player's best record on a course bar (`BeMusicCourseRecord`: a song record plus the best `trophy`).
- `listScroll` and `selectListRows(frame, rowHeight)`, so a select skin's list can follow the finger. `listScroll` is how far the list is pulled toward later entries, in design pixels and under one row, while it is dragged, glides after a swipe or is mid-trackpad-scroll. `selectListRows` lays out the rows at fractional slots and fades the ones sliding past the window's edge; at rest it returns exactly the window, so skins that switch to it look the same until the list moves.
- `searchEditing`: true while the host's text field sits over the skin's search box (the box bound to `actions.activateSearch`), so the skin draws the box but leaves its text to the field. The host lays its field over the last hit area the skin bound to `activateSearch`, so a skin that binds its label and its text strip separately should bind the text strip last.
