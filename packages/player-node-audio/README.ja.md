[English version](./README.md)

# @be-music/player-node-audio

Node 用の音声セッション、サンプルデコード、PCM 出力を提供するホストアダプターです。Node で [`@be-music/player-engine`](../player-engine/README.ja.md) のエンジンを動かすときに使います。

- Node 音声セッション、リアルタイムのサンプルミックス、`node-web-audio-api` による PCM 出力
- [`@be-music/chart-audio-renderer`](../chart-audio-renderer/README.ja.md) への依存を所有し、`player-engine` から音声レンダーと Node 出力を分離
- Node でエンジンを呼ぶ場合は `createAudioSession: createNodeAudioSession` を設定。ターミナルプレイヤーは自動設定（[プレイヤー仕様](../../docs/player-spec.ja.md#node-音声アダプター)）
- `./audio-sink` エントリはセッションの出力先である audio sink だけを公開します
