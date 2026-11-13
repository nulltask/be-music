[English version](./README.md)

# @be-music/skin-beatoraja

beatoraja JSON/Lua skin parser、normalizer、theme loader を renderer 非依存で提供する package です。`./scene` エントリで beatoraja のシーン状態を求めます。parse した結果はブラウザプレイヤーが PixiJS で描画します（[`@be-music/player-browser`](../player-browser/README.ja.md)）。

- beatoraja JSON skin と Lua `.luaskin` entry を PixiJS 非依存で parse
- beatoraja の 2-phase Lua contract を制限付き Fengari sandbox 上で評価
- play / select / decide / result / course-result entry を discovery し、play skin を `5` / `7` / `9` / `10` / `14` / `24` / `24d` ごとに group 化（いずれも gameplay で mount 可能）
- `property[]`、`filepath[]`、category group、custom offset、wildcard source path、case-insensitive asset を解決
- image、imageset、value、float-value、text、slider、note、judge、gauge、graph、BPM graph、timing graph、song-list、custom event、destination、PM character element を normalize

[beatoraja skin 実装メモ](../../docs/beatoraja-skin.ja.md) を参照してください。
