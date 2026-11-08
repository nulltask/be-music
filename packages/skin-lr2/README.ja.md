[English version](./README.md)

# @be-music/skin-lr2

Lunatic Rave 2 skin parser、asset resolver、theme loader を renderer 非依存で提供する package です。`./state` エントリで LR2 のシーン状態を求め、`./ids` で LR2 の id を公開します。parse した結果はブラウザプレイヤーが PixiJS で描画します（[`@be-music/player-browser`](../player-browser/README.ja.md)）。

- LR2 の select / decide / play / result skin CSV を PixiJS 非依存で parse
- `#INCLUDE`、`#CUSTOMOPTION`、`#CUSTOMFILE`、`#LR2FONT`、system font、skin timer、op condition、play-skin variant を解決
- image、number、text、slider、bargraph、button、BGA、judge line、measure line、gauge、score chart、result graph element を parse
- case-insensitive / wildcard asset lookup、TGA decode、DXA archive extraction で theme asset を読み込み
- HD スキンの解像度、coordinate-based canvas 判定、include 間の画像継承を扱う（[HD 対応と制約](../../docs/lr2-skin.ja.md#hd-の座標系と素材)）

[LR2 skin 実装メモ](../../docs/lr2-skin.ja.md) を参照してください。
