[English version](./0011-host-provided-audio.md)

# 音声実装をホストが提供する

`@be-music/player-engine` はホスト提供の `AudioSession` を使います。Node ホストは `createAudioSession` に `@be-music/player-node-audio` を設定し、ブラウザーホストは自身の Web Audio セッションを設定します。ターミナルは Node アダプターを自動設定します。ファクトリーが未指定または戻り値が `undefined` なら無音で再生します。

Node アダプターが `@be-music/chart-audio-renderer` によるサンプルのデコード、リアルタイムミックス、`node-web-audio-api` による出力を所有します。エンジン自身の `ResolvedChart` を受け取り、判定とサンプルのスライス、タイミング、元イベントの参照を一致させます。エンジンへの import は型だけです。デバッグ表示によってエンジンがデコーダーを読み込むことを避けるため、サンプル長の読み込みもホストが提供します。

自動的な Node フォールバックを残すと、従来の直接呼び出しは維持できますが、すべてのエンジン利用者に Node 依存が残ります。PCM シンクだけを移すとレンダラー依存とデバッグ時のデコードがエンジンに残ります。そのため Node 音声実装全体を移します。Node のライブラリー利用者はアダプターを明示設定し、PCM シンクの import 先を `@be-music/player-node-audio/audio-sink` に変更します。共通デコーダーパッケージの新設は、そのインターフェースを必要とする利用者が増えてから検討できます。
