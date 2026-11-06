---
'@be-music/player-browser': minor
---

The select screen shows a chart's README in one dialog for every skin family (`<be-music-readme-dialog>` of `@be-music/player-ui`), replacing the canvas overlay of the LR2, beatoraja and built-in skins. Web and mail addresses in the README open in a new tab, and the text is decoded as a chart's own text is (`decodeBMSText`), so a UTF-8 README without a BOM and a UTF-16 one no longer show garbled, and Shift_JIS ones read as before. Synesthesia and Plain draw a small README button at the top right of the focused chart's card, and Native's Readme button is disabled on a chart without one. While the dialog is open, Escape closes it as Enter and Backspace do.
