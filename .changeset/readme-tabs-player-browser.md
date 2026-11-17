---
'@be-music/player-browser': minor
---

The select screen's README dialog now shows every text file in a chart's folder as tabs, switched with ← / → or a click, and opens on the one that reads most like the folder's README instead of the first file listed. The pick scores clues in the file name and the text's head (a plain `readme` name, chart metadata, and BGA, difference-chart, score-attack, lyrics or chart-dump markers), weighted by how often each marks the README across 122 hand-labelled multi-file chart folders, where it picks the README 96% of the time against 48% for the first file listed. `SelectFrame`'s `readText` now carries `files` and `selected` in place of `text`, and the `readtext-tab` intent chooses a file.
