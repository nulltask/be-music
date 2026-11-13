[English version](./README.md)

# @be-music/chart-source

Be-Music 内部処理専用の BMS/bmson 中間表現 (JSON互換) の pure IR です。元のデータを保持し、譜面を BMS / bmson へ round-trip できます。

`@be-music/chart-source` は Be-Music の内部データモデルです。配布フォーマットや他ツールとの再利用可能な交換フォーマットとしては設計していません。譜面の意味論 helper（beat 解決、イベント順序、ロングノート解決）は [`@be-music/chart-model`](../chart-model/README.ja.md) に分離しており、`@be-music/chart-source` 自体は pure IR と round-trip preservation を担当します。

このパッケージは実行環境に依存しません。Node の組み込みモジュールを import せず、DOM や Node 専用のグローバルも使いません。

[BMS/bmson 中間表現 (`@be-music/chart-source`) 実装仕様](../../docs/json-spec.ja.md) を参照してください。
