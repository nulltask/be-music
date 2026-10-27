---
'@be-music/player-ui': minor
---

The elements ship headless: their own styles cover layout, sizing and scrolling, and the look comes from a theme. `defineBeMusicElements(registry, { theme })` adds a theme's style sheets to every element, and the new `@be-music/player-ui/themes/basecoat` subpath exports `basecoatTheme` (Basecoat and the elements' colours from the page's Basecoat tokens). Register with it to keep the previous look; the main entry no longer bundles Basecoat. `setBeMusicTheme` and the `BeMusicTheme` and `BeMusicElementsOptions` types are new exports.
