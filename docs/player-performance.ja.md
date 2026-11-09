[English version](./player-performance.md)

# ブラウザープレイヤーの性能と計測

本書は `scripts/performance/` のブラウザー計測と `scripts/bench/browser-workers/` の Worker ベンチマークを定義します。描画設定は[ブラウザープレイヤー](./player-web.ja.md)、Worker のスケジューリングとフォールバックは [ADR 0010](./adr/0010-browser-task-pool.ja.md) を参照してください。

## 描画の契約

プレイのフレームはバインディングやスキンのコールバックが保持できます。描画ごとに HUD のスナップショットと公開するコレクションを作り、その描画内で Canvas と DOM が HUD の計算結果を共有します。後続の描画は公開済みのスナップショットを書き換えません。

`packages/player-browser/src/stage/draw-label.ts` は所有者と元の入力値をキーにラベルをキャッシュします。所有者は弱参照で管理し、ラベルの全文を維持します。`skins/pixi-kit/particle-layer.ts` はスキンの点をインスタンス描画の四角形として描きます。各点は 4 つの浮動小数点数（`x, y`、半径、パックした色）で、レイヤーごとに 1 本の型付き配列へ書き込み、そのまま転送します。点ごとのオブジェクトや転送ループはありません。プレイヤーが Pixi スキンに渡すテクスチャはマルチサンプリングしないため、1 デバイスピクセルより小さい点は 1 ピクセルに広げ、広げた面積の分だけ薄くします。統合 GPU では、組み込みスキンの加算合成の粒子に 4x MSAA をかけるとフレームの約 4 分の 1 を占めていました。チャージクラウドの WebGPU の粒子は、シェーダーが頂点インデックスから粒子を求める 1 回のインデックス付き描画で四角形として描きます。数万個の 4 頂点インスタンスでは統合 GPU の頂点処理レーンの大半が遊んでいました。Pixi の `ParticleContainer` は使いません。その生成コードは未宣言の変数に代入するため、粒子ごと・フレームごとにグローバルオブジェクトへ boxed な double を書き込みます。Lua コールバックには汎用の実行結果キャッシュを設けません。

## プレイ中のプロファイル

ワークスペースの依存関係と Playwright Chromium をインストールします。LR2 の計測には標準の `LR2files` ディレクトリを `PERF_LR2_FILES`、beatoraja には ModernChic のディレクトリを `PERF_MODERN_CHIC` に設定します。

```bash
PERF_OUTPUT=tmp/performance/current pnpm exec playwright test -c scripts/performance/browser.config.ts
```

計測はソースマップ付きでプレイヤーをビルドし、専用の空きポートで配信します。テスト用データは一時ディレクトリに生成し、終了後に削除します。ブラウザーの worker は 1、viewport は 1280 × 720 です。譜面は 150 BPM、64 小節、1,024 ノーツです。各スキンで AUTO を譜面時刻 5 秒より先まで進め、15 秒の計測を 3 回行います。対象は全エフェクトを有効にした Synesthesia、Native DOM/Canvas、標準 LR2、ModernChic です。

`PERF_CHANNEL=chrome` で Playwright の Chromium の代わりにインストール済みの Chrome を計測し、`PERF_VIEWPORT=1920x1080` で viewport を変えます。`PERF_FRAMES_ONLY=1` は CPU とメモリ確保のプロファイラーを動かさず、その負荷なしでフレーム間隔だけを記録します。フレームレートの判断には frame-only の計測を使います。`PERF_CPU_THROTTLE` を指定すると CDP でページの CPU をその倍率だけ遅くし（例: `4` でこのマシンの 4 分の 1 の速さ）、低スペックのマシンを近似します。GPU は遅くなりません。`PERF_RENDERER=webgpu` で既定の WebGL 2 の代わりに WebGPU を計測します。`PERF_FAMILIES` に `built-in,native,lr2,beatoraja` の一部をカンマ区切りで指定できます。指定するとコレクションの計測を省きます。未指定の場合は、譜面 300 個のドロップと 50 ms 間隔で 150 項目をスクロールする計測も行います。

各計測は CDP の CPU サンプル、Performance metrics、16 KiB 間隔のメモリ確保サンプル、フレーム間隔、スクリーンショットを記録します。メモリ確保のサンプルには minor / major GC で回収したオブジェクトも含み、保持ヒープではなく累積の確保量を測ります。最初のフレーム間隔はパーセンタイルの計算から除外します。ブラウザーエラーがないことも検証します。

出力は `.cpuprofile`、`.heapprofile`、計測ごとの JSON と PNG、フレーム間隔のパーセンタイル・16.7 ms と 33.4 ms を超えた回数・Performance metrics・エラーを含む `summary.json` です。次のビルド前に `packages/app-play/dist/assets/` のソースマップをプロファイルと一緒に保存します。比較時は出力先を分け、ブラウザー、機器、素材、設定を揃えます。プロファイルには負荷があるため、CPU サンプルや確保量の差だけで FPS 改善を判断しません。

`node scripts/performance/frame-labels.ts` はウォームアップ後にラベルの整形とキャッシュ参照を各 100 万回、5 試行で計測します。プレイ中のプロファイルと併せて診断に使います。

## Worker ベンチマーク

実際のプレイヤーは譜面読み込み、ZIP 展開、WSOLA を共有 Worker pool に渡します。単発のプレイ準備と fingerprint・送信準備はローカルで実行します。ベンチマークはこの 5 処理を含み、並列処理の速度と Worker に渡す負荷を測ります。

```bash
node --conditions=source scripts/bench/browser-workers/prepare.ts "/path/to/GdbG BMS Package 2022"
pnpm exec vp build --config scripts/bench/browser-workers/vite.config.ts
node scripts/bench/browser-workers/run.ts
BENCH_STARTUP_ONLY=1 BENCH_OUTPUT=tmp/bench/browser-workers-startup.json node scripts/bench/browser-workers/run.ts
```

Chrome が必要です。準備処理は `/tmp/be-music-browser-manifest.json` を書き出します。`BENCH_MANIFEST`、`BENCH_OUTPUT`、`BENCH_REPETITIONS` で入出力を設定します。`BENCH_BASE_REF` は比較対象のローダーを選び、ビルド時にも設定します。既定値は `7a4b7a13^` なので、そのリビジョンをローカルの Git 履歴に含めます。出力先の既定値は `tmp/bench/browser-workers-real.json` です。

時間を比較する前に出力の同値性を確認します。Worker の時間にはコピー、待ち行列、結果の転送、メインスレッドでの再構築を含みます。タイマーのコールバック間隔はスケジューリングの遅延であり、クリックの遅延や INP ではありません。起動時の計測とウォームアップ後の反復計測は分けます。機器固有の結果は実行時の契約ではなく、生成した計測出力に保存します。
