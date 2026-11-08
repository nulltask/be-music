[Japanese version](./README.ja.md)

# @be-music/skin-beatoraja

A renderer-independent beatoraja JSON/Lua skin parser, normalizer and theme loader, with beatoraja scene state resolution in the `./scene` entry. The browser player draws what it parses with PixiJS ([`@be-music/player-browser`](../player-browser/README.md)).

- Parses beatoraja JSON skins and Lua `.luaskin` entries independently from PixiJS
- Evaluates the beatoraja two-phase Lua contract on a restricted Fengari sandbox
- Discovers play / select / decide / result / course-result entries, with play skins grouped by `5` / `7` / `9` / `10` / `14` / `24` / `24d` — every one of them mountable for gameplay
- Resolves `property[]`, `filepath[]`, category groups, custom offsets, wildcard source paths, and case-insensitive assets
- Normalizes image, imageset, value, float-value, text, slider, note, judge, gauge, graph, BPM graph, timing graph, song-list, custom event, destination, and PM character elements

See the [beatoraja skin implementation notes](../../docs/beatoraja-skin.md).
