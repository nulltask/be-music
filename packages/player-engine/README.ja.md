[English version](./README.md)

# @be-music/player-engine

端末プレイヤー、ブラウザープレイヤー、Leaderboard が共有するエンジンです。手動・AUTO・リプレイを 1 つのプレイループで処理します。判定、スコア、ゲージ、クリアランプ、自己ベスト、コースと NONSTOP、リプレイ形式、ホストが使うランタイムインターフェースを定義します。

[Player 実装仕様](../../docs/player-spec.ja.md)、[アーキテクチャ](../../docs/architecture.ja.md#エンジン-判定コアと-1-つのプレイループ)、[リプレイ仕様](../../docs/replay.ja.md)、[コースと段位認定](../../docs/course.ja.md) を参照してください。

## 提供するもの

- terminal と browser runtime が共有する `autoPlay()` / `manualPlay()` engine。決定的な判定コアの上の 1 つのプレイループに、手動・AUTO・リプレイの判定ストラテジーを差し込む（[アーキテクチャ](../../docs/architecture.ja.md#エンジン-判定コアと-1-つのプレイループ)）
- lane flash、POOR BGA command、frame snapshot、pause、restart、high-speed change を流す UI / input signal bus
- playable note、legacy long note、`#LNOBJ`、FREE ZONE、mine、invisible note の共通抽出
- 判定幅、動的 `#EXRANKxx`、score、groove gauge、scroll distance、BGA timeline、result summary の共通意味論
- エンジンのルートと並ぶ browser-safe なエントリポイント：`signals`、`lanes`、`display`、`ruleset`、`replay`、`records`、`course`（[Player 実装仕様 — 公開するエントリポイント](../../docs/player-spec.ja.md#公開するエントリポイント)）
- `ruleset`: ホスト・スキン・リーダーボードが共有する定義。ゲージ、クリアランプ、BP、スコア（`ScoreSummary`、`computeScoreRate`、DJ ランク、LR2 のマネースコア）
- `course`、`records`、`replay`: コースの実行、NONSTOP の流れ、コースのステージの規則、判定ルールセットごとの自己ベスト、リプレイの形式とその記録・シミュレータ

エンジンは音声レンダーも Node 出力も import しません。Node のホストは [`@be-music/player-node-audio`](../player-node-audio/README.ja.md) の `createAudioSession` を設定します。

譜面の解釈は [FREE ZONE](../../docs/player-spec.ja.md#free-zone)、判定の詳細は [判定・スコア・ゲージ](../../docs/player-judgment.ja.md) を参照してください。
