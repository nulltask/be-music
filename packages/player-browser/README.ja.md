[English version](./README.md)

# @be-music/player-browser

Be-Music プレイヤーの browser の PixiJS ランタイムです。選曲・決定・プレイ・リザルトの各画面を、built-in・LR2・beatoraja のファミリービューが描くシーンセッションとして 1 つのホスト向け API から作ります。音声サービス、譜面のコレクション、スキンの読み込み、gameplay の録画も持ちます。[`@be-music/app-play`](../app-play/README.ja.md) がこれをプレイヤーのアプリに組み込みます。

[Browser player 実装メモ](../../docs/player-web.ja.md) を参照してください。

## エントリポイント

`@be-music/player-browser/host`（`PixiSceneHost`、`createSelectScene` / `createDecideScene` / `createPlayScene` / `createResultScene`）、`/skin`、`/collection`、`/audio`、`/recording`、`/compute`、`/controller`（[公開するエントリポイント](../../docs/player-web.ja.md#公開するエントリポイント)）。

## 機能

- dropped folder、ZIP、song / LR2 / beatoraja theme 混在 drop を扱う browser song library
- 大きな audio / video file を lazy に扱い、case-insensitive に path lookup
- select、gameplay、result（スキンが宣言していれば decide も）を描く built-in Be-Music Skin（既定の Synesthesia、Plain、Native（DOM + Canvas））
- タッチ主体の端末でのタッチ操作とタッチ用 gameplay layout、縦向きステージを持つスキンの縦画面表示、スキンごとの設定
- LR2 の select / decide / gameplay / result skin を parse して PixiJS で描画
- beatoraja の select / decide / gameplay / result skin を parse して PixiJS で描画
- 画面ごとに 1 つのシーンセッションが振る舞い（一覧の操作、譜面の準備、エンジン、入力、音、終了処理）をすべてのファミリーに共通に持ち、built-in・LR2・beatoraja のファミリービューは描いてインテントを返すだけ（[シーンセッションとファミリービュー](../../docs/player-web.ja.md#シーンセッションとファミリービュー)）
- destination 補間、sprite transform、number、text、slider、bargraph を扱う共通 LR2 Pixi helper
- destination sampling、source cell selection、text、value、slider、gauge、graph、timing visualizer、note、marker、BGA、runtime op/timer wiring を扱う共通 beatoraja Pixi helper
- note、timing、scroll distance、BGA cue、score、result は terminal player と共通の再生意味論を使用
- 選曲 BGM・効果音・ジングル・譜面のプレビュー・スキンの音を 1 つのシステム `AudioContext` で鳴らす音声サービスと、key / BGM / master を分けた compressor control 付きのプレイごとの WebAudio bus
- BGA still / video 描画、browser-side video transcode fallback、MP4 / WebM gameplay recording
- 1 つの renderer context を所有し、一度に 1 つの scene を表示する PixiJS scene host。player ではシーンルーターがすべての切り替えを受け持ち、去った scene を dispose する
- hi-speed、BGA mode/size、filter、sort、HS-FIX、lane cover、lift、auto-scratch、DP flip、random/mirror、gauge variant、skin option を扱う LR2 / beatoraja PLAY OPTION control
