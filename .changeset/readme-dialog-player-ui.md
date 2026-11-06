---
'@be-music/player-ui': minor
---

Add `<be-music-readme-dialog>`, a modal Basecoat dialog that shows a plain text file such as a chart's README in a fixed-width face, with its web and mail addresses as links that open in a new tab (`rel="noopener noreferrer"`). It builds text nodes and anchors from `splitLinkedText`, a new export that splits a text into runs of plain text and links, so the text is never read as HTML. The dialog sends `readme-close` from its close button, Escape and the backdrop, and `scrollTextBy(delta)` scrolls it for a host that takes the keys.
`<be-music-chart-details>` no longer shows the README inline under its buttons: `readText` is replaced by `readmeAvailable`, which disables the Readme button on a chart without one.
