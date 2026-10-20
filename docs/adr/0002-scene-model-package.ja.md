[English version](./0002-scene-model-package.md)

# 実行環境に依存しないシーンモデルのパッケージ

スキンの種類によらないモデルは、新しいパッケージ `@be-music/player-scene-model` に置きます。ライブラリの項目（譜面・フォルダ・コース）、一覧の状態とその保存形、プレイオプション、**プレイ状態**（ゲージ、スコアと判定の推移、判定タイミング、レーンカバー、ハイスピード）、**プレイ結果**、コースの表示用モデル、効果音セットです。このパッケージは `@be-music/player-engine` の上、スキンのパッケージの下に位置します。`skin-sdk`・`lr2-skin`・`beatoraja-skin` はモデルを自分の語彙（LR2 互換の op・数値・テキスト・タイマーの番号、beatoraja の番号）に写し、`@be-music/player-browser` が描きます。

## 検討した案

- **`@be-music/player-engine` に置く。** エンジンと規則のパッケージに、画面の関心ごとが混ざります。
- **`@be-music/player-browser` に置く。** ターミナル版とスキンのパッケージから使えません。beatoraja の状態を計算するアダプターがそこに置かれ、描画のそばで 3,100 行に育ちました。
