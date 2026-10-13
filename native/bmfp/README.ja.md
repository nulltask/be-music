[English version](./README.md)

# bmfp

Be-Music Fingerprint（[仕様](../../docs/fingerprint-spec.ja.md)）の、移植性の高い C 実装です。ライブラリ、コマンドラインツール、WebAssembly モジュールを提供します。TypeScript 以外で書かれたプログラム向けで、他の言語からはバインディングや FFI でライブラリを呼びます。

**状況: 基盤。** 数値処理の中核を移植し、TypeScript 実装と結果が一致することを確認済みです。API、ビルド、テストも整っています。BMS / bmson の読み込みと fingerprint 本体はこれからです（[ロードマップ](#ロードマップ)）。

## 設計

- **C99** で書き、C11 / C17 / C23 / C++ としてもそのままコンパイルできるようにしています。GCC、Clang、MSVC で警告をエラーにしてビルドします。可変長配列、コンパイラ拡張、`__int128` は使いません。
- **外部依存なし。** SHA-256、多倍長整数、厳密な有理数はライブラリに含まれます。ライブラリの中核はフリースタンディングのヘッダ（`stddef.h`、`stdint.h`）だけを使うので、libc のない素の WebAssembly にもビルドできます。
- **浮動小数点を使わない。** TypeScript 実装が JavaScript の数値を経由する箇所は、`Number(text)`（最も近い double、偶数丸め）と `String(number)`（往復できる最短の 10 進表記）を整数演算で再現します。`strtod` や x87 の精度に左右されず、どの環境でも同じ結果になります。
- **FFI で扱いやすい ABI。** API は素の関数、整数、バイト列、呼び出し側が用意する出力バッファでできています。ステータスは enum ではなく `int` です。グローバルな状態を持たないのでスレッドセーフです。呼び出し側は独自のアロケータを渡せ、ライブラリが確保したメモリはライブラリ経由で解放します。

## 構成

| パス                 | 内容                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `include/bmfp.h`     | 公開 API                                                                |
| `src/bigint.*`       | 多倍長整数                                                              |
| `src/rational.*`     | 厳密な有理数とスナップ（`fingerprint-rational.ts` の移植）              |
| `src/binary64.*`     | 10 進 ↔ double を JavaScript と同じ規則で変換                           |
| `src/sha256.*`       | SHA-256                                                                 |
| `src/alloc_libc.c`   | 通常の環境での既定のアロケータ（`malloc` / `free`）                     |
| `src/wasm.c`         | 素の WebAssembly 向け: メモリ関数とヒープ（`bmfp_wasm_alloc` / `free`） |
| `cli/main.c`         | `bmfp` コマンド                                                         |
| `tests/`             | C のテストランナー、テストベクタ、WebAssembly のスモークテスト          |
| `scripts/vectors.ts` | TypeScript 実装からテストベクタを生成                                   |

## ビルド

```bash
make -C native/bmfp
```

```bash
make -C native/bmfp check
```

`check` は次の 4 つを実行します。

- `test`: テストベクタと CLI
- `std`: C99 / C11 / C17 / C23 / C++ としてのコンパイル
- `sanitize`: AddressSanitizer と UndefinedBehaviorSanitizer
- `wasm`: 素のモジュールのビルドと Node でのスモークテスト

WebAssembly のビルドには、wasm32 ターゲットを持つ Clang と `wasm-ld` が必要です。Apple の Clang はターゲットはありますが `wasm-ld` がないので、Homebrew の LLVM と LLD を使います。

```bash
make -C native/bmfp wasm WASM_CC=/opt/homebrew/opt/llvm/bin/clang WASM_LDFLAGS=-fuse-ld=/opt/homebrew/opt/lld/bin/wasm-ld
```

モジュールは何もインポートせず、`memory` と API をエクスポートします。ホストが渡すバッファ用に `bmfp_wasm_alloc` / `bmfp_wasm_free` もエクスポートします。

CI では Linux（GCC、WebAssembly 付きの Clang、32bit）、macOS、Windows（MSVC）でビルドします。

## 一致の担保

C 実装は TypeScript 実装とビット単位で同じ結果を出す必要があります。`scripts/vectors.ts` が TypeScript 実装と JavaScript 自身でテストベクタを計算し、`tests/vectors/` に書き出します。

- 有理数の解析、演算、比較、スナップ
- `Number()` / `String()` の往復（ランダムな double、ちょうど中間の値、長い 10 進数）

`vectors.test.ts`（Vitest）は、コミットされたベクタが TypeScript 実装と合わなくなると失敗します。TypeScript 側を意図して変えたときは、ベクタを生成し直して C のテストを流します。

```bash
pnpm vp test run -u native/bmfp
```

C のテストランナーは、すべてのベクタを数を数えるアロケータ経由で確かめるので、メモリリークも失敗になります。確保を 1 回ずつ順に失敗させ、`BMFP_E_NO_MEMORY` が返ってリークがないことも確認します。

## ロードマップ

1. 譜面の読み込み: fingerprint が読む範囲の `@be-music/parser` を BMS と bmson について移植し、`#RANDOM` / `#SWITCH` をパーサと同じ規則で評価する。
2. fingerprint のドキュメント（`fingerprint-items.ts`、`fingerprint-control-flow.ts`）と正規化 JSON。golden コーパスと、ランダムな譜面での TypeScript 実装との突き合わせで確かめる。
3. API に `bmfp_chart_fingerprint` / `bmfp_play_fingerprint`、CLI に `bmfp chart FILE`、WebAssembly にそのエクスポートを追加する。
4. 配布: 1 ファイルにまとめた版（`bmfp.c` + `bmfp.h`）と、stb 形式の単一ヘッダ。
