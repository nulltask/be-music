[English version](./README.md)

# 設計判断の記録

コードの形を決め、あとから覆すと高くつく判断と、その理由です。これらが目指す構造は[アーキテクチャ](../architecture.ja.md#目指す構造)にあります。

- [スキンの種類は描くだけ](./0001-skin-families-only-draw.ja.md)
- [実行環境に依存しないシーンモデルのパッケージ](./0002-scene-model-package.ja.md)
- [判定の戦略を差し込む 1 つのプレイループ](./0003-one-play-loop.ja.md)
- [コース・記録・ランプの規則は @be-music/player-engine に置く](./0004-domain-rules-in-player.ja.md)
- [公開する入口は設計して決める。1.0 までは破壊的変更を許す](./0005-public-entry-points.ja.md)
- [ホストは画面の切り替えをすべて 1 つのシーンルーターに通す](./0006-scene-router.ja.md)
- [システム音は 1 つの AudioContext を共有し、プレイは自分の AudioContext を持つ](./0007-one-system-audio-context.ja.md)

- [0008: Accounts の独立と OIDC](./0008-accounts-oidc.ja.md)

- [0009: Accounts がプロフィールとアバターを管理する](./0009-accounts-profiles.ja.md)

- [ブラウザの CPU 処理で並列数を制限した Worker プールを共有する](./0010-browser-task-pool.ja.md)
