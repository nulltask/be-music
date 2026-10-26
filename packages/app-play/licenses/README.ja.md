[English](./README.md)

# LICENSE を同梱しないパッケージのライセンス本文

Help の **Open source** の一覧は、バンドルした各パッケージ自身の `LICENSE` ファイルを表示します。次のパッケージは npm に LICENSE を公開していないので、上流のリポジトリから取った本文をここに置き、代わりに使います。ファイル名はパッケージ名の `/` を `__` に置き換えたものです（`@ffmpeg/core` → `@ffmpeg__core.txt`）。

| パッケージ                       | 取得元                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@ffmpeg/core`                   | GPL-2.0（ビルドのライセンス）と、対応するソースの入手先                                                                                  |
| `@ffmpeg/ffmpeg`、`@ffmpeg/util` | [ffmpegwasm/ffmpeg.wasm の `LICENSE`](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/LICENSE)                                       |
| `@pixi/colord`                   | [pixijs/colord の `LICENSE.md`](https://github.com/pixijs/colord/blob/master/LICENSE.md)                                                 |
| `signalsmith-stretch`            | [Signalsmith-Audio/signalsmith-stretch の `LICENSE.txt`](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/LICENSE.txt) |
| `tweakpane`                      | [cocopon/tweakpane の `LICENSE.txt`](https://github.com/cocopon/tweakpane/blob/main/LICENSE.txt)                                         |

パッケージが自分で `LICENSE` を同梱するようになったら、そちらを使うので、ここの写しは消せます。
