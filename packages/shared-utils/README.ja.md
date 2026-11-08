[English version](./README.md)

# @be-music/shared-utils

全パッケージで再利用する汎用ユーティリティです。browser-safe な core helper と Node 向け helper は狭い subpath export で分けているので、ブラウザのバンドルに Node のコードが入りません。

subpath のエントリは `./core`、`./hash`、`./async`、`./cli`、`./cli-path`、`./log`、`./optional-node-module`、`./path`、`./pcm`、`./workerize`、`./png` です。主なエントリの中身と対象の実行環境は [共通ユーティリティ](../../docs/shared-utils.ja.md) を参照してください。
