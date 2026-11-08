[Japanese version](./README.ja.md)

# @be-music/skin-lr2

A renderer-independent Lunatic Rave 2 skin parser, asset resolver and theme loader, with LR2 scene state resolution in the `./state` entry and LR2 ids in `./ids`. The browser player draws what it parses with PixiJS ([`@be-music/player-browser`](../player-browser/README.md)).

- Parses LR2 select / decide / play / result skin CSV files independently from PixiJS
- Resolves `#INCLUDE`, `#CUSTOMOPTION`, `#CUSTOMFILE`, `#LR2FONT`, system font declarations, skin timers, op conditions, and play-skin variants
- Parses image, number, text, slider, bargraph, button, BGA, judge-line, measure-line, gauge, score-chart, and result graph elements
- Loads theme assets with case-insensitive and wildcard lookup, TGA decoding, and DXA archive extraction
- Supports authored HD resolutions, coordinate-based canvas detection, and image resources inherited across includes (see [HD support and limits](../../docs/lr2-skin.md#hd-coordinate-space-and-resources))

See the [LR2 skin implementation notes](../../docs/lr2-skin.md).
