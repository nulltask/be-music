[English version](./packages.md)

# パッケージの命名

パッケージ名は役割を表します。ライブラリはドメインや実行環境に基づく名前、アプリケーションは `app-`、配信用ラッパーは `worker-`、サービス共通の連携機能は `service-`、共通ユーティリティは `shared-` を使います。ディレクトリ名はスコープを除いたパッケージ名と揃えます。Cloudflare の Worker 名、ドメイン、DB 名、バケット名、実行ファイル名は独立しており、変更しません。

## 名称

| 旧パッケージ                | 現在のパッケージ                 |
| --------------------------- | -------------------------------- |
| `@be-music/json`            | `@be-music/chart-source`         |
| `@be-music/chart`           | `@be-music/chart-model`          |
| `@be-music/parser`          | `@be-music/chart-parser`         |
| `@be-music/stringifier`     | `@be-music/chart-writer`         |
| `@be-music/player`          | `@be-music/player-engine`        |
| `@be-music/player-web`      | `@be-music/player-browser`       |
| `@be-music/player-tui`      | `@be-music/player-terminal`      |
| `@be-music/player-web-demo` | `@be-music/app-play`             |
| `@be-music/play`            | `@be-music/worker-play`          |
| `@be-music/leaderboard-api` | `@be-music/app-leaderboard`      |
| `@be-music/accounts`        | `@be-music/app-accounts`         |
| `@be-music/dashboard`       | `@be-music/app-dashboard`        |
| `@be-music/editor`          | `@be-music/chart-editor`         |
| `@be-music/audio-renderer`  | `@be-music/chart-audio-renderer` |
| `@be-music/scene-model`     | `@be-music/player-scene-model`   |
| `@be-music/skin-sdk`        | `@be-music/player-skin-sdk`      |
| `@be-music/lr2-skin`        | `@be-music/skin-lr2`             |
| `@be-music/beatoraja-skin`  | `@be-music/skin-beatoraja`       |
| `@be-music/auth-client`     | `@be-music/service-auth-client`  |
| `@be-music/web-theme`       | `@be-music/service-web-theme`    |
| `@be-music/utils`           | `@be-music/shared-utils`         |

インポート、パッケージマネージャーのフィルター、ソースパスを新名称に変更してください。旧名の互換エイリアスは提供しません。

## プレイヤー関連パッケージの役割

新しいパッケージは旧パッケージの別名ではなく、実行環境と表示の責務を分けるものです。

| パッケージ                          | 責務                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player-engine`                     | 判定、再生ループ、音声・入力・UI のホスト契約。音声の実装はホストが渡す。                                                                                 |
| `player-node-audio`                 | Node の音声セッションと PCM 出力。`chart-audio-renderer` を使ったデコードを所有する。                                                                     |
| `player-skin-sdk`                   | Canvas と DOM のスキン契約。Lit・React・Vue に依存しない。                                                                                                |
| `player-ui`                         | 表示用データと操作イベントで接続する Lit 製 Web Components。                                                                                              |
| `player-ui-react` / `player-ui-vue` | 同じ Web Components の型付きフレームワークラッパー。                                                                                                      |
| `player-browser`                    | ブラウザーの音声、Canvas / DOM のビュー、シーンセッションとホスト。`./controller` は描画から独立した選曲操作、`./compute` は CPU worker pool を公開する。 |

[音声アダプター](./player-spec.ja.md#node-音声アダプター)、[スキンの作成](./be-music-skin.ja.md)、[Player UI](../packages/player-ui/README.ja.md)、[共有ユーティリティ](./shared-utils.ja.md) も参照してください。

## 過去のリリース

GitHub Release の表示名と説明には現在のパッケージ名を使い、当時の公開名を注記します。既存の Git タグ、リリース URL、配布ファイルは維持します。ソースのパッケージ名を変更しても、過去の npm バージョンを新名称で再公開することはありません。
