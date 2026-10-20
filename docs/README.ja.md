[English version](./README.md)

# 仕様書

このディレクトリは、`be-music` リポジトリで使う仕様を Markdown でまとめたものです。

- [アーキテクチャ: 譜面の層、エンジン、パッケージの層](architecture.ja.md)
- [設計判断の記録](adr/README.ja.md)
- [BMS 実装仕様](bms-spec.ja.md)
- [bmson 実装仕様](bmson-spec.ja.md)
- [BMS / bmson 互換性ノート（de jure と de facto）](format-compat.ja.md)
- [LR2 と beatoraja のセマンティクス](semantics-lr2-beatoraja.ja.md)
- [Bemuse 実装仕様](bemuse-spec.ja.md)
- [Player 実装仕様](player-spec.ja.md)
- [Terminal player 実装メモ](player-tui.ja.md)
- [Browser player 実装メモ](player-web.ja.md)
- [シーンモデル（`@be-music/player-scene-model`）](scene-model.ja.md)
- [リプレイ（プレイ履歴）仕様](replay.ja.md)
- [コースと段位認定](course.ja.md)
- [コースのブラウザ確認](course-checklist.ja.md)
- [Be-Music Fingerprint 仕様](fingerprint-spec.ja.md)
- [Leaderboard 設計](leaderboard.ja.md)
- [サービスと環境](services.ja.md)
- [LR2 skin 実装メモ](lr2-skin.ja.md)
- [beatoraja skin 実装メモ](beatoraja-skin.ja.md)
- [be-music スキンの作り方](be-music-skin.ja.md)
- [BMS/bmson 中間表現 (`@be-music/chart-source`) 実装仕様](json-spec.ja.md)
- [用語集](glossary.ja.md)

補足:

- 公式仕様そのものではなく、**このリポジトリの実装がどう解釈するか**を優先して記述しています。
- 公式仕様と齟齬が出る場合は、まず実装方針を決めてからこのドキュメントを更新してください。
- これらの文書は現在の実装に集中させます。過去の判断は pull request、commit message、changelog に残してください。
- `@be-music/chart-source` は pure IR（Source 層）、`@be-music/chart-model` は beat 解決やイベント順序などの譜面意味論を担当します。プレイヤー側のすべてのパッケージが読む Resolved 層へ変える唯一の関数 `resolveChart` も `@be-music/chart-model` にあります（[アーキテクチャ](architecture.ja.md) を参照）。
- `@be-music/player-engine` は共有の規則と engine の package です。terminal 固有の挙動は `@be-music/player-terminal` と [Terminal player 実装メモ](player-tui.ja.md)、browser 固有の挙動は `@be-music/player-browser` と [Browser player 実装メモ](player-web.ja.md) に置きます。
- `@be-music/player-scene-model` は、スキンの種類によらず各画面が何を見せ、どう振る舞うかを持ちます（[シーンモデル](scene-model.ja.md)）。`@be-music/player-browser` ではシーンセッションがそれを動かし、ファミリービューが描きます。
- `@be-music/skin-lr2` と `@be-music/skin-beatoraja` は skin parsing を renderer 非依存に保ちます。browser PixiJS rendering は `@be-music/player-browser` 側に記述します。
