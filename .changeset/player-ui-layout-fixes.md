---
'@be-music/player-ui': patch
---

Fix broken layouts in the screens and panels:

- Panel text touched the card edges, the chart list's level showed as an empty white pill, and a row's artist line overflowed into the next row: Basecoat's `.card`, `.badge` and `.btn` styles clashed with the elements' own.
- No container query ever matched, so a narrow collection never stacked its columns.
- The decide and result columns shrank to their content (a 160 px loading bar, a result panel pushing Continue off screen); they now take the screen's width up to `--be-music-center-width`, and the result panel puts its verdict beside its figures.
- The search field clipped its placeholder, and the play options left one control alone on a second row.
- The portrait gameplay HUD's buttons and details toggle overlapped the lanes and the gauge; Paused now shows over the lanes.
- Lamps and judgment keys read as words (FULL COMBO, EMPTY POOR).

Spacing and type read new `--be-music-*` custom properties, the product line over a title is an `eyebrow` slot, and screens expose `header`, `eyebrow`, `title`, `search`, `folder`, `columns`, `progress`, `stat`, `actions`, `chart-panel` and `row-kind` parts.
