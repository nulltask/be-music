[English version](./README.md)

# @be-music/player-engine

規則と再生 engine を共有する package です。1 つのプレイループ（手動・AUTO・リプレイ）、判定、score、gauge とクリアランプ、自己ベスト、コースの実行と NONSTOP、リプレイの形式、ホストが差し込む runtime 契約を持ちます。ターミナルプレイヤー、ブラウザプレイヤー、Leaderboard が使います。

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

## FREE ZONE (`17` / `27`)

- 9KEY と 24KEY / 48KEY の keyboard mode 以外では FREE ZONE として扱います。
- 独立レーンは作らず、スクラッチレーン (`16` / `26`) に重ねて描画します。
- ノート長は 4 分音符固定です。
- 判定対象外のため、`TOTAL` / `EX-SCORE` / `SCORE` には含めません。
- 9KEY / 24KEY / 48KEY 判定時は `17` / `27` を通常レーンノートとして扱います。

## スコアと判定

- 判定種別: `PERFECT`, `GREAT`, `GOOD`, `BAD`, `POOR`
- `FAST` / `SLOW` は `GREAT` / `GOOD` の早押し・遅押し時のみ加算
- 対応する未判定ノートが存在しない空打鍵は LR2-style empty POOR として扱います。judgment counter、score、EX-SCORE、combo は変えませんが、empty POOR の gauge delta を適用し、POOR BGA を起動します
- EX-SCORE:
  - `PERFECT = +2`
  - `GREAT = +1`
- SCORE (200000 満点):
  - 判定基礎点 150000 + コンボ加点 50000
  - `BAD` / `POOR` は加点なし、コンボを切断
