[English version](./be-music-skin-release.md)

# Be-Music Skin のパフォーマンスと配布

[スキン作成ガイド](./be-music-skin.ja.md)

<details>
<summary>目次</summary>

- [パフォーマンス](#パフォーマンス)
  - [共通のテクニック](#共通のテクニック)
  - [Canvas 2D](#canvas-2d)
  - [WebGL / WebGL 2](#webgl--webgl-2)
  - [WebGPU](#webgpu)
  - [フレームワークを使う場合](#フレームワークを使う場合)
- [フォント](#フォント)
- [パッケージングと読み込み](#パッケージングと読み込み)
- [バージョニング](#バージョニング)
- [チェックリスト](#チェックリスト)

</details>

## パフォーマンス

120 Hz では、描画、判定、音声のスケジューリング、BGA のデコードを約 8 ms 以内に収める必要があります。標準的なノート PC では、`draw` をその半分より十分短くするのが目安です。リズムゲームではフレーム落ちに気づきやすいためです。

### 共通のテクニック

- **まず計測する。** ブラウザの Performance パネルでプレイを記録するか、`draw` を `performance.now()` で囲みます。ノーツの多い譜面、できるだけ高いリフレッシュレート、高い `devicePixelRatio`、`effects: 'full'` で試してください。
- **変わったものだけ描く。**
  - 静的なレイヤーは一度描いて使い回せます。背景、枠、ラベル、レーン下地など、レイアウトだけで決まるものです。オフスクリーンキャンバスやテクスチャに描いておきます。
  - 作り直すのは入力が変わったときだけにします。`layout` は譜面のレーン構成で、選曲の状態は `frame.revision` で変わります。
- **ホットパスで確保しない。** 毎フレーム新しい配列・オブジェクト・クロージャ・文字列を作るとガベージコレクタの負荷になり、その停止がカクつきとして現れます。代わりに次のようにします。
  - バッファやプールを再利用する。
  - 色の文字列やルックアップテーブルを事前に計算しておく。
  - ヒットごとのランダムさは、パーティクルのオブジェクトを保持せず、`hash01` とシードで決定的に求める。
- **状態ごとにまとめる。** 色・テクスチャ・ブレンドモード・シェーダーが同じものをグループにして、グループ単位でまとめて描きます。ノーツごとに状態を切り替えるのが、たいてい一番のコストです。
- **テキストは画像として扱う。** テキストのラスタライズは高価です。
  - ラベルは一度描き、値が変わったときだけ描き直す。
  - 数字は数字アトラスから組み立てる。グリフの位置は `layoutTabularRun` で求められます。
- **エフェクトに予算を設ける。**
  - パーティクル数に上限を設け、重なったヒットにはヒットごとではなく共通の予算を割り当てる。
  - `effectProfile(effects)` に合わせて量を変える。
  - `'reduced'` と `'off'` では、装飾的なレイヤーから削る。
- **フィルレートに注意する。** サーフェスはドットバイドットなので、`devicePixelRatio` 3 では 1 のときの 9 倍のピクセルがあります。全画面グラデーション、大きな半透明オーバーレイ、ぼかしはどれもこれに比例して重くなります。高価なソフトなレイヤーは低解像度で描いて拡大するか、事前に描いたスプライトで置き換えてください。
- **ピクセルを読み戻さない。** `getImageData`、`readPixels`、バッファの `mapAsync` はパイプラインを止めます。
- **`setup` で準備する。**
  - 画像のデコード（`createImageBitmap`、`await image.decode()`）、アトラス作成、シェーダーのコンパイルは `setup` で済ませ、最初の描画で行わない。
  - フォントは `fontLoads` に挙げる。

### Canvas 2D

- **塗り色でまとめる。** `fillStyle` は図形ごとではなく色のグループごとに 1 回設定します。必要ならノーツを種類で並べ替えます。
- **パスをまとめる。**
  - 矩形には `fillRect` を使う。
  - 同じスタイルの図形が多いときは、`beginPath()` を 1 回呼び、すべての `rect()` / `arc()` を追加してから `fill()` を 1 回呼ぶ。
- **`shadowBlur` と `filter` を避ける。** どちらも描画呼び出しごとに非常に遅くなります。グローは事前に描いたグロースプライトを `drawImage` で描き、加算には `globalCompositeOperation = 'lighter'` を使って表現します。
- **繰り返す形はスタンプする。** ノーツ、ボムの枠、グリフなどは一度 `OffscreenCanvas` に描き、`drawImage` でスタンプします。パスを組み直すよりずっと安く済みます。
- **整数ピクセルに揃える。** 座標を丸める（`Math.round`）と、アンチエイリアスの処理が省け、ドットバイドットのサーフェスで輪郭もシャープになります。
- **余計な状態変更を避ける。** `font`、`globalAlpha`、合成モードの変更にはコストがかかります。`measureText` の結果はキャッシュします。
- **二重にクリアしない。** サーフェスは毎フレームクリア済みで渡されます。

### WebGL / WebGL 2

- **描画呼び出しを減らす。**
  - ノーツ全部（パーティクル全部）をインスタンシングで 1 回で描く。WebGL 2 は `drawArraysInstanced`、WebGL 1 は `ANGLE_instanced_arrays` を使います。
  - 画像はテクスチャアトラスにまとめる。
  - vertex array object を使い、描画ごとの属性設定を省く。
- **GPU リソースを生かし続ける。**
  - バッファとテクスチャは `setup` で確保する。
  - 毎フレームの更新は、事前に確保した `DYNAMIC_DRAW` バッファへの `bufferSubData` で行い、フレームごとに作成・削除しない。
- **同期呼び出しを避ける。**
  - uniform と attribute の location は 1 回だけ取得する。
  - `getError`、`getParameter`、`readPixels` はホットパスに置かない。どれも CPU に GPU の完了を待たせます。
- **状態で並べ替える。** 描画はプログラム、テクスチャ、ブレンドモードの順に並べます。
- **正しく合成する。** キャンバスは BGA の上に合成されるので、premultiplied な色を出力し、`blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` でブレンドしてください。`contextAttributes` では `{ alpha: true, premultipliedAlpha: true }` を指定します。
- **アンチエイリアスを見極める。** MSAA（`antialias: true`）は高密度でフィルコストを何倍にもします。ピクセル精度のスキンなら切っても構いません。
- **コンテキストロストに備える。** キャンバスの `webglcontextlost` / `webglcontextrestored` を監視し、リソースを作り直します。

### WebGPU

- **すべて先に作る。** パイプライン（`createRenderPipelineAsync`）、bind group layout、bind group、バッファは `setup` で作り、bind group はフレームごとに作らずキャッシュします。
- **BGA に合わせて設定する。** コンテキストは `format: navigator.gpu.getPreferredCanvasFormat()` と `alphaMode: 'premultiplied'` で一度だけ設定します。こうすると透明なピクセルから BGA が見えます。
- **フレームのエンコードを軽くする。**
  - command encoder は 1 つ、render pass はできるだけ少なくする。
  - 毎フレームのデータは、永続バッファへの `queue.writeBuffer` で送る。
  - ノーツとパーティクルはインスタンシングで描く。
- **読み戻さない。** フレームループで `mapAsync` を使わないでください。
- **デバイスロストに備える。** `device.lost` を監視し、デバイスとリソースを作り直します。

### フレームワークを使う場合

- **シーングラフを保持する。**
  - 選曲シーンは `frame.revision` が変わったときだけ作り直す。
  - フレームごとの表示オブジェクトは、作成・破棄せずプールする。`skins/pixi-kit` の `ChildPool` と `definePixiSkin` が両方の例です。
- **PixiJS の場合:**
  - `Text` オブジェクトと `TextStyle` インスタンスを再利用し、テキストのテクスチャを保つ。
  - 数千のスプライトには `ParticleContainer` を使う。
  - `eventMode = 'none'` にする（入力はプレイヤーが扱います）。
- **three.js の場合:**
  - ノーツとパーティクルには `InstancedMesh` を使い、静的なジオメトリはマージする。
  - マテリアルを使い回す。
  - `teardown` ですべて `dispose()` する。

## フォント

描画に使うフェイスはすべて `fontLoads` に挙げてください。ホストは `document.fonts.load` で読み込む（Web プレイヤーは登録済みのスキンのフェイスを起動時に待ち、追加したスキンのフェイスは裏で読み込みます）ので、最初のフレームが代替フォントでラスタライズされることを防げます。フェイス自体をホストが入手できるようにもしてください（フォントサービス経由、またはスキンに同梱）。

システムのフォントで描くスキンには Web フォントは要りません。`DEFAULT_TEXT_FONT` は日本語も含むシステムのサンセリフで、`fontLoads` は空のままにします。組み込みスキンは両方のやり方を示しています。

| スキン      | ラテン文字のラベルと数字 | 日本語などのテキスト | `fontLoads`           |
| ----------- | ------------------------ | -------------------- | --------------------- |
| Synesthesia | Orbitron                 | M PLUS 1p            | Orbitron と M PLUS 1p |
| Plain       | システムのサンセリフ     | システムのサンセリフ | 空                    |
| Native      | システムのサンセリフ     | システムのサンセリフ | 空                    |

日本語を含まないフェイス（Orbitron など）は、指定の後ろに日本語を含むフェイスを続けて、曲名やアーティストが表示されるようにします。

## パッケージングと読み込み

- **インストール:** `@be-music/player-skin-sdk` をスキンの依存に追加します（`npm install @be-music/player-skin-sdk`）。使う描画フレームワークも同様です。`@be-music/player-browser` は不要です。
- **import の範囲:** スキンモジュールが import するのは `@be-music/player-skin-sdk`、選んだ描画フレームワーク、自身のファイルです。組み込みスキンもテストでこのルールを守らされているので、組み込みスキンがプレイヤーから使っているものはすべて使えます。
- **export:** スキンはモジュールの default export にします。
- **ホスト側:** ホストはスキンをレジストリに登録します。

  ```ts
  import { createPlayScene } from '@be-music/player-browser/host';
  import { BUILT_IN_BE_MUSIC_SKINS, createBeMusicSkinRegistry } from '@be-music/player-browser/skin';
  import mySkin from 'my-be-music-skin';

  const skins = createBeMusicSkinRegistry(BUILT_IN_BE_MUSIC_SKINS);
  const problems = skins.add(mySkin); // 追加できれば []、拒否されたらその理由
  const skin = skins.resolve('my-skin'); // 未知の id なら最初のスキンにフォールバック
  // 組み込みのシーンにキットとして渡す: createPlayScene({ family: 'built-in', skin, settings }, { … })
  ```

  - `add` はスキンを検査します。同じ id が登録済みなら置き換えるので、開発中の再読み込みに便利です。
  - `subscribe(listener)` で追加を通知でき、ピッカーを更新できます。
  - 検査に通らないスキン（未対応の `apiVersion` など）は、ホストを壊さずに除外されます。

- **組み込みスキン:** `BUILT_IN_BE_MUSIC_SKINS` には Synesthesia（既定）、Plain、Native が入っています。Synesthesia と Native には決定画面があり、Plain はそのままプレイに進みます。
- **プレイヤー:** プレイヤーの Options ダイアログ から、モジュール URL でスキンを追加できます（_Skin & display_ → _Add skin_ → _Skin module URL_）。スキンはページの全権限で動くため、プレイヤーは先に確認を求めます。信頼できるスキンだけを読み込んでください。いまのプレイヤーは `ADD_SKIN_ENABLED` が off の間、_Add skin_ を隠しています（`services/built-in-skins.ts`）。

## バージョニング

- **`version` を上げるとき:** スキンをリリースするたびに上げます。プレイヤーから見たセマンティックバージョニングに従い、見た目の追加はマイナー、修正はパッチにします。
- **`apiVersion`:** ビルドに使った SDK の定数にします。スキン API はまだ定義中で、リビジョンは `0` です。番号を変えずに互換性のない変更が入ることがあるため、SDK が新しくなるたびにスキンを再ビルドしてください。最初の安定リビジョンは `1` になり、それ以降は互換性のない変更で `BE_MUSIC_SKIN_API_VERSION` が上がり、古いリビジョン向けのスキンは再ビルドするまで拒否されます。API を不安定と位置づける前に `1` を宣言していたスキンは引き続き動きます。
- **`id` を固定する:** ホストは選択中のスキンを `id` で保存します。

## チェックリスト

- [ ] メタデータが `validateBeMusicSkin` を通る。
- [ ] `setup` で作ったフレームワークのリソースを `teardown` で解放している。
- [ ] クロームは `layout` から配置し、判定ラインはレーンランごとに描いている。
- [ ] `runtime.hasBGA` のとき BGA の矩形を透明のまま残している。
- [ ] `runtime.loading` の間は NOW LOADING を表示している。
- [ ] 選曲の行が `select.layout` と揃い、ボタンは描画のたびに `frame.hit` で宣言している。
- [ ] 設定した `draws*` フラグに対応する要素を自分で描いている。
- [ ] runtime の省略可能なフィールドや `chartImage` が `undefined` のときの代替表示がある。
- [ ] タイミング表示は正の `deltaMs` を遅い（SLOW）、負を早い（FAST）として扱っている。
- [ ] `settings` の id が重複せず、既定値がすべて有効。
- [ ] 音への反応は `audioDrive` を通し、`effects` を尊重している。
- [ ] 使うフェイスをすべて `fontLoads` に挙げている。
- [ ] ノーツの多い譜面・高密度でも `draw` が 1 フレームの半分を十分下回り、毎フレームの確保やピクセルの読み戻しがない。
- [ ] SP、DP、5 / 7 / 9 / 10 / 14 / 24 / 48 KEY、BGA あり・なしで確認した。
- [ ] `portraitStage` を持つなら、スマートフォンとタブレットを縦に持った状態と、プレイ中の回転で確認した。
