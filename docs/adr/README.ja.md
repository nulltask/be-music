[English version](./README.md)

# 設計判断の記録

コードの形を決め、あとから覆すと高くつく判断と、その理由です。これらが目指す構造は[アーキテクチャ](../architecture.ja.md#目指す構造)にあります。

- [スキンの種類は描くだけ](./0001-skin-families-only-draw.ja.md)
- [実行環境に依存しないシーンモデルのパッケージ](./0002-scene-model-package.ja.md)
- [判定ストラテジーを差し込む 1 つのプレイループ](./0003-one-play-loop.ja.md)
- [コース・記録・ランプの規則は @be-music/player-engine に置く](./0004-domain-rules-in-player.ja.md)
- [公開するエントリポイントは設計して決める。1.0 までは破壊的変更を許す](./0005-public-entry-points.ja.md)
- [ホストは画面の切り替えをすべて 1 つのシーンルーターに通す](./0006-scene-router.ja.md)
- [システム音は 1 つの AudioContext を共有し、プレイは自分の AudioContext を持つ](./0007-one-system-audio-context.ja.md)

- [0008: Accounts の独立と OIDC](./0008-accounts-oidc.ja.md)

- [0009: Accounts がプロフィールとアバターを管理する](./0009-accounts-profiles.ja.md)

- [ブラウザの CPU 処理で並列数を制限した Worker プールを共有する](./0010-browser-task-pool.ja.md)

- [音声実装をホストが提供する](./0011-host-provided-audio.ja.md)

- [DOM の画面でも scene session を共有する](./0012-native-skin-screens.ja.md)

- [再利用するプレイヤー UI を Web Components にする](./0013-player-ui-components.ja.md)

- [Native はプレイフィールドを canvas を持つ component で描く](./0014-native-playfield-components.ja.md)

- [シークはプレイループのコマンドにする](./0016-seek-play-loop-command.ja.md)

- [混在する NONSTOP は bmson の IR に元の単位を保持する](./0017-bmson-nonstop.ja.md)

- [0018: リプレイのオプション時系列](./0018-replay-option-timeline.ja.md)

- [0019: オプションの値に参照元を持たせる](./0019-source-qualified-option-values.ja.md)

- [0020: Player UI の要素は headless にし、見た目はテーマとスキンが与える](./0020-headless-player-ui.ja.md)

- [0021: スキンのステージは可変にできる](./0021-fluid-stage.ja.md)

- [0022: bmson の条件付き BGA イベントは決定的な譜面時刻で動かす](./0022-bmson-bga-events.ja.md)

- [0023: generic bmson キーボードは宣言した配置を保持する](./0023-generic-bmson-keyboards.ja.md)

- [0024: BMS の拡張音声効果はホストのテンポ変更より前に準備する](./0024-extended-bms-audio.ja.md)

- [0025: 譜面テキストは engine の時刻と判定エフェクトに従う](./0025-chart-text-playback.ja.md)

- [0026: 譜面の実効表示操作をユーザー設定と分けて記録する](./0026-chart-authored-display-options.ja.md)

- [0030: bmson の TOTAL 0 を明示的なプレイ設定で扱う](./0030-bmson-zero-total.ja.md)
