[English version](./packages.md)

# パッケージの命名

パッケージ名は役割を表します。ライブラリはドメインや実行環境に基づく名前、アプリケーションは `app-`、配信用ラッパーは `worker-`、サービス共通の連携機能は `service-`、共通ユーティリティは `shared-` を使います。ディレクトリ名はスコープを除いたパッケージ名と揃えます。Cloudflare の Worker 名、ドメイン、DB 名、バケット名、実行ファイル名は独立しており、変更しません。

## プレイヤー関連パッケージの役割

プレイヤーのパッケージは実行環境と表示の責務を分けます。

| パッケージ                          | 責務                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player-engine`                     | 判定、再生ループ、音声・入力・UI のホスト契約。音声の実装はホストが渡す。                                                                                 |
| `player-node-audio`                 | Node の音声セッションと PCM 出力。`chart-audio-renderer` を使ったデコードを所有する。                                                                     |
| `player-skin-sdk`                   | Canvas と DOM のスキン契約。Lit・React・Vue に依存しない。                                                                                                |
| `player-ui`                         | 表示用データと操作イベントで接続する Lit 製 Web Components。                                                                                              |
| `player-ui-react` / `player-ui-vue` | 同じ Web Components の型付きフレームワークラッパー。                                                                                                      |
| `player-browser`                    | ブラウザーの音声、Canvas / DOM のビュー、シーンセッションとホスト。`./controller` は描画から独立した選曲操作、`./compute` は CPU worker pool を公開する。 |

[音声アダプター](./player-spec.ja.md#node-音声アダプター)、[スキンの作成](./be-music-skin.ja.md)、[Player UI](../packages/player-ui/README.ja.md)、[共有ユーティリティ](./shared-utils.ja.md) も参照してください。
