[English version](./README.md)

# @be-music/player-skin-sdk

browser player 向け Be-Music Skin を書くための描画フレームワーク非依存の SDK です。

- browser プレイヤーの built-in family 向けスキンの契約。スキンは表示用データから Canvas と任意の DOM 画面を組み合わせる
- 描画フレームワークを import しない。フレームワークはスキンが持ち込む（Canvas 2D、WebGL / WebGPU、PixiJS、three.js など）
- stage、lane layout、touch / portrait layout、moment、判定表示、loading、audio drive、曲情報、result track、skin settings、motion の helper

SDK は Lit・React・Vue に依存しません。DOM 画面では [`@be-music/player-ui`](../player-ui/README.ja.md) のコンポーネントを使えます。

[Be-Music Skin の作り方](../../docs/be-music-skin.ja.md) を参照してください。
