[Japanese version](./README.ja.md)

# @be-music/player-skin-sdk

The framework-free SDK for writing Be-Music Skins for the browser player.

- Skin contract for the browser player's built-in family: the skin composes Canvas rendering and optional DOM screens from presentation data
- Imports no rendering framework; a skin brings its own (Canvas 2D, WebGL / WebGPU, PixiJS, three.js, …)
- Stage, lane layout, touch / portrait layout, moment, judgement word, loading, audio drive, song fact, result track, skin settings, and motion helpers

The SDK has no Lit, React or Vue dependency; DOM screens can use the components of [`@be-music/player-ui`](../player-ui/README.md).

See [Writing a Be-Music Skin](../../docs/be-music-skin.md).
