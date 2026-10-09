[English version](./be-music-skin.md)

# be-music スキンの作り方

このガイドは、ブラウザプレイヤーの組み込み（デフォルト）ファミリー向けにスキンを作りたい人のためのものです。スキンは `@be-music/skin-sdk` パッケージに対して書きます。組み込みスキンもまさにこのパッケージだけを使っており、Synesthesia・Phantom・Lattice・Plain はプレイヤーの他の部分を一切 import していません。組み込みスキンにできることは、あなたのスキンにもできます。

be-music スキンはデータファイルではなくコードです。LR2 / beatoraja テーマはシーンが解釈しますが、be-music スキンはすべての画面を自分で描きます。それ以外はすべてプレイヤーの担当です。

- 入力、タイミング、オーディオ、判定
- レーンのレイアウトとノーツの位置
- 選曲リストの当たり判定

プレイヤーは毎フレーム、キャンバスとそのフレームの内容（プレーンなデータ）をスキンに渡します。見た目はスキンが決めます。

## 描画フレームワークはスキンが持ち込む

SDK 自体は描画を行わず、描画フレームワークも import しません。キャンバスは、スキンに合ったもので描いてください。

| 描画手段                      | `context`                           | 方法                                                                               | 作例                                                                                      |
| ----------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Canvas 2D API                 | `'2d'`                              | そのまま描く。キャンバスはクリア済みで、デザインピクセルにスケール済み             | Plain（`packages/player-web/src/skins/plain/`）                                           |
| PixiJS                        | `'webgl2'`                          | `setup` でキャンバス上に Pixi レンダラーを作り、シーングラフを組んで `draw` で描画 | Synesthesia、Phantom、Lattice（`packages/player-web/src/skins/`、`skins/pixi-kit/` 経由） |
| three.js、素の WebGL / WebGPU | `'webgl'` / `'webgl2'` / `'webgpu'` | `setup` でレンダラーやパイプラインを作り、`draw` で描画し、`teardown` で解放       | —                                                                                         |

フレームワークは、スキン自身の依存として同梱します。Plain は意図的に小さく読みやすく作ってあるので、出発点としてコピーして使えます。

## クイックスタート: Canvas 2D スキン

```ts
import { BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin, resolveLaneRuns } from '@be-music/skin-sdk';

export default defineBeMusicSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  id: 'my-skin',
  label: 'My Skin',
  version: '1.0.0',
  author: { name: 'Your Name', url: 'https://example.com' },
  fontLoads: ['700 12px "M PLUS 1p"'],
  context: '2d',
  gameplay: {
    draw({ context: ctx, width, height }, frame) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      // BGA 動画はキャンバスの背後で再生される。上から塗らず、矩形をくり抜く。
      const bga = frame.layout.bga;
      if (bga && frame.runtime.hasBga) ctx.clearRect(bga.x, bga.y, bga.w, bga.h);
      for (const lane of frame.lanes) {
        ctx.fillStyle = lane.kind === 'scratch' ? '#311' : '#111';
        ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
      }
      ctx.fillStyle = '#fff';
      for (const note of frame.notes) ctx.fillRect(note.x, note.y - 6, note.w, 6);
      // 判定ラインはプレイサイドごとに 1 本。DP の隙間をまたがない。
      ctx.fillStyle = '#f33';
      for (const run of resolveLaneRuns(frame.lanes)) {
        ctx.fillRect(run.left, frame.layout.playfield.judgementY, run.right - run.left, 2);
      }
    },
  },
  select: {
    layout: { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 },
    draw({ context: ctx, width, height }, frame) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      // frame.entries[frame.firstVisibleIndex …] の行を描き、ボタンをクリック可能にする:
      frame.hit(16, 400, 120, 32, frame.actions.play);
    },
  },
  result: {
    draw({ context: ctx, width, height }, frame) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    },
  },
});
```

## フレームワークを使う

`setup` でサーフェスのキャンバス上にフレームワークのレンダラーを作り、`teardown` で解放します。`setup` はサーフェスごとに最初の描画前に 1 回呼ばれ、Promise を返すとプレイヤーはその完了を待ちます。サーフェスは画面ごとにあります（ゲームプレイ 1 つ、選曲画面ごと 1 つ、リザルト画面ごと 1 つ）。

```ts
import { WebGLRenderer, Container } from 'pixi.js';
import { BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin } from '@be-music/skin-sdk';

const renderers = new WeakMap<HTMLCanvasElement, WebGLRenderer>();

export default defineBeMusicSkin({
  // …メタデータ…
  context: 'webgl2',
  // マスクにはステンシルバッファが必要。キャンバスは BGA の上に重なるのでアルファを保つ。
  contextAttributes: { alpha: true, premultipliedAlpha: true, stencil: true, preserveDrawingBuffer: true },
  async setup(surface) {
    const renderer = new WebGLRenderer();
    await renderer.init({
      canvas: surface.canvas,
      context: surface.context,
      width: surface.width,
      height: surface.height,
      resolution: surface.pixelRatio,
      backgroundAlpha: 0,
    });
    renderers.set(surface.canvas, renderer);
  },
  teardown(surface) {
    renderers.get(surface.canvas)?.destroy();
    renderers.delete(surface.canvas);
  },
  gameplay: {
    draw(surface, frame) {
      const renderer = renderers.get(surface.canvas)!;
      const stage = buildGameplayStage(frame); // このフレームのシーングラフ
      renderer.render({ container: stage, clear: true });
    },
  },
  // select, result …
});
```

組み込みの Pixi スキンは、`skins/pixi-kit/define-pixi-skin.ts` を通してまさにこれを行っています。このファイルは、プレイヤーのフレームデータを保持型の Pixi シーンに流し込む作例として読めます。選曲シーンを保持しておき、`frame.revision` が変わったときだけ作り直す方法も示しています。

## サーフェス

- **`draw` が呼ばれるタイミング:**
  - ゲームプレイは、レンダリング直前に 1 フレーム 1 回。
  - 選曲とリザルトは、表示中は毎フレーム。
- **`'2d'` サーフェス:** クリア・スケール済みなので、デザインピクセル（デフォルトステージで 854×480）で描けます。
- **WebGL / WebGPU サーフェス:** 全体をスキンが扱います。`surface.pixelRatio` がデザインピクセルあたりのキャンバスピクセル数です。値が変わったらレンダラーをリサイズしてください。
- **ドットバイドット:** 各キャンバスは画面上でステージが覆うデバイスピクセル数（ビューポート倍率 × `devicePixelRatio`）で確保され、nearest サンプリングで表示されます。描いたピクセルは画面に 1 対 1 で対応します。
- **透過:** キャンバスは BGA 動画の上に合成されます。動画を見せたい場所では BGA の矩形を透明のまま残してください。
- **`contextAttributes`:** `canvas.getContext` にそのまま渡されます。

## スキンのメタデータ

すべてのスキンが以下を宣言します。`defineBeMusicSkin` は内容を検査し、不正なら例外を投げます。壊れたスキンは定義した場所で失敗します。

| フィールド                               | 必須 | ルール                                                                                                         |
| ---------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `apiVersion`                             | ○    | ビルドに使った SDK の `BE_MUSIC_SKIN_API_VERSION`。プレイヤーは未対応の API リビジョン向けスキンを拒否します。 |
| `id`                                     | ○    | 小文字英字・数字・ハイフン（`my-skin`）。ホストが保存するので、リリース間で変えないでください。                |
| `label`                                  | ○    | ピッカーに表示する名前。                                                                                       |
| `version`                                | ○    | スキン自体のリリース。セマンティックバージョン（`1.2.0`）。                                                    |
| `author`                                 | ○    | `{ name, url? }`。`url` は http(s)。                                                                           |
| `description`                            | —    | ピッカー向けの 1〜2 文。                                                                                       |
| `homepage`                               | —    | プロジェクトページやリポジトリの http(s) URL。                                                                 |
| `license`                                | —    | スキンのコードと素材の SPDX 識別子（`MIT`）。                                                                  |
| `fontLoads`                              | ○    | 描画に使う CSS フォント指定（`'400 24px "Anton"'`）。空でも可。                                                |
| `context`                                | ○    | `'2d'`、`'webgl'`、`'webgl2'`、`'webgpu'` のいずれか。                                                         |
| `contextAttributes`、`setup`、`teardown` | —    | [サーフェス](#サーフェス)と[フレームワークを使う](#フレームワークを使う)を参照。                               |
| `stage`                                  | —    | デザインキャンバス。既定は `wideStage`。[ステージとレイアウト](#ステージとレイアウト)を参照。                  |
| `gameplay`、`select`、`result`           | ○    | 各画面の `draw` 関数。[画面](#画面)を参照。                                                                    |

`validateBeMusicSkin(skin)` は、例外を投げずに同じ問題をメッセージの配列で返します。

## ステージとレイアウト

- **ステージ:** スキンが描くデザインキャンバスです。`wideStage` は組み込みスキンが使う 16:9 のステージ（854×480）で、既定値でもあります。
- **BGA の配置:** `BeMusicStage.resolveBgaRect(playfieldRight)` がゲームプレイの BGA の位置を決めます。プレイヤーはそこに動画を合成し、スキンは同じ矩形に枠を描きます。`wideStage` は SP では BGA を大きく取り、幅の広い DP や鍵盤モードの横では縮めます。
- **フレームごとのレイアウト:** ゲームプレイの各フレームには、ホストが解決した `layout`（`BeMusicGameplayLayout`）が付きます。
  - `stage`: 幅と高さ。
  - `lanes`: 全レーン。チャンネル、種類（`white` / `black` / `scratch`）、サイド、x、幅を持ちます。譜面のプレイバリアント（5 / 7 / 9 / 10 / 14 / 24 / 48 KEY）の全レーンが、譜面で使われないレーンも含めて常に並びます。
  - `playfield`: `left`、`right`、`centerX`、`top`、`judgementY`、`sides`（1P と、DP なら 2P の水平範囲）。
  - `bga`: BGA の矩形。プレイフィールドに余地がなければ `undefined`。
- **クロームの配置:** ジオメトリをハードコードせず、これらの値から配置してください。DP、鍵盤モード、新しいアスペクト比などホスト側のレイアウト変更が、そのままスキンにも反映されます。
- **DP の隙間:** 1P と 2P のバンクは 60 px 離れています。`resolveLaneRuns(lanes)` は連続したバンクごとに `{ left, right }` を 1 つ返します。判定ラインやレーングリッドはラン単位で描き、隙間をまたがないようにします。
- **レーン幅:** レーン幅はプレイヤーが決めます。スキンはレーンに色を付けますが、大きさや位置は変えません。

## 画面

### ゲームプレイ

`gameplay.draw(surface, frame)` は `BeMusicGameplayFrame` を受け取ります。

- `layout`: [ステージとレイアウト](#ステージとレイアウト)を参照。
- `lanes`: 各レーンの矩形（`x`、`w`、`top`、判定ライン位置の `bottom`）、`kind`、`beam`（キービーム強度。押下中は 1、離すと減衰）。
- `notes`: タップノーツ `{ kind, x, w, y }`。`y` はノーツの下端です。
- `longNotes`: ロングノーツ `{ kind, x, w, top, bottom }`。`top` が終端、`bottom` が始端で、押下中は判定ラインに張り付きます。
- `bombs`: 生きているヒットエフェクト。`elapsedMs` と固定の `seed` を持ちます。
- `runtime`: HUD の値（下記）。
- `beatPhase`、`nowMs`、`effects`、`audio`。

`gameplay.bombDurationMs`（既定 300）でヒットエフェクトの寿命を指定します。

`runtime`（`BeMusicGameplayRuntime`）の値:

- **曲とスコア:**
  - `songTitle`、`songArtist`、`bpm`、`hiSpeed`
  - `score`、`exScore`、`exScoreMax`、`combo`、`maxCombo`
  - 判定数（`perfect` 〜 `poor`、`fast`、`slow`）
  - `rank`、`totalNotes`
- **ゲージ:** `gauge`、`clearThreshold`、`gaugeLabel`、`gaugeSurvival`
- **判定:** `lastJudge`、`judgeSides`（サイドごとの直近の判定とコンボ）
- **プレイ状態:** `autoplay`、`hasBga`、`loading`（音声デコードや BGA 変換の間は NOW LOADING を表示）、`progressRatio`、`chartMs`、`beatPhase`、`nowMs`
- **イベント時刻:** `judgeAtMs`、`impulseAtMs`、`impulseKind`（直近の判定とキー入力。パンチやインパルスの演出用）
- **快適性とサウンド:** `effects`、`audio`

### 選曲

- **`select.layout`:** `listX`、`listTop`、`listBottomInset`、`rowHeight`。シーンはこの値で行の当たり判定をするので、描く行と一致させてください。
- **`select.outroMs`:** 曲決定後のアウトロの長さ。終わるまで `frame.launchAt` を設定したまま描画が続き、その間の入力は無視されます。
- **`select.draw(surface, frame)`** は `BeMusicSelectFrame` を受け取ります。
  - `entries`、`selectedIndex`、`firstVisibleIndex`、`visibleRows`、`focusedSong`
  - `folderLabel`、`searchQuery`、`totalCharts`
  - `actions`（`play`、`autoPlay`、`activateSearch`）
  - `revision`: 選曲の状態（カーソル、フォルダ、検索、リスト内容）が変わるたびに増えます。保持型のシーングラフは、これが変わったときだけ作り直せば済みます。
  - 登場やフォーカス移動のトランジション用の `sceneStartedAt`、`cursorChangedAt`
  - `nowMs`、`effects`、`launchAt`、`audio`
  - `hit(x, y, w, h, action, cursor?)`: 矩形をそのフレームの間だけクリック可能にします。クリック領域は描画のたびに宣言してください。

### リザルト

`result.draw(surface, frame)` は `BeMusicResultFrame` を受け取ります。

- `result`（`BeMusicResultData`）: スコア、判定数、ゲージとスコアの推移、プレイログ。
- `rankLabel`（IIDX の DJ LEVEL）、`ratePercent`。
- `elapsedMs`: シーン開始からの経過。登場演出をスキップした後は `Infinity`。
- `nowMs`、`effects`。

`resolveResultLamp` と `resolveResultTrackRows` が、組み込みスキンの表示するクリアランプとトラック行を返します。

## SDK ヘルパー

| 分野       | ヘルパー                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ステージ   | `wideStage`、`resolveStageBgaRect`、`STAGE_WIDTH`、`STAGE_HEIGHT`、`STAGE_MARGIN`、`STAGE_SIDE_COLUMN`、`STAGE_BGA_BAND`                                                        |
| レイアウト | `resolveGameplayLayout`、`resolveLaneRuns`、`resolveMilestoneArea`                                                                                                              |
| 判定       | `judgeDisplayWord`（PERFECT は GREAT と表示）、`isFlashingGreat`、`flashingGreatColor`                                                                                          |
| 演出       | `trackMoments` / `updateMoments`（カウントイン、100 コンボごと、クリアライン、フルコンボ、コンボ切れ）、`comboTier`、`momentProgress`、`impulse`、`punchScale`、`effectProfile` |
| ロード中   | `LOADING_WORD`、`loadingDots(nowMs)`                                                                                                                                            |
| サウンド   | `audioDrive`、`bandAt`、`bandLevel`。[音楽に反応させる](#音楽に反応させる)を参照                                                                                                |
| リザルト   | `resolveResultLamp`、`resolveResultTrackRows`                                                                                                                                   |
| 曲情報     | `resolveSongRowFacts`、`resolveSongStats`、`resolveSongTags`、`formatSongLength`、`formatBpmRange`、`formatPlayVariantLabel`                                                    |
| テキスト   | `DEFAULT_TEXT_FONT`、`layoutTabularRun`（等幅数字の配置）                                                                                                                       |
| モーション | `easeOutCubic`、`easeOutBack`、`stageProgress`、`rollUpValue`、`hash01`（決定的なゆらぎ）                                                                                       |

## 音楽に反応させる

すべての画面は `audio`（`BeMusicAudioFrame`）を受け取ります。1 フレームに 1 回サンプリングされるライブ解析です。ゲームプレイはミックス全体を、選曲は BGM と譜面プレビューを解析します。ホストに Web Audio がなければ `undefined` です。

- **音量:** `level`、`peak`（0..1）、`db`（dBFS）。
- **帯域エネルギー:** `bass`、`mid`、`high`。
- **スペクトラム:** `bands`。約 30 Hz〜14 kHz の対数間隔 16 バンド。
- **オンセット:** `onset` はトランジェントごとに 1 へ跳ね、約 150 ms で減衰します。`onsetAtMs` は直近のオンセットの時刻です。

各バンドと bass / mid / high は、直近数秒に取った範囲の中での位置に正規化されています。そのため、音圧の高いコンプレッションの効いたミックスでも、上に張り付かずヒットの合間に上下します。

使う前に `audioDrive(audio, effects)` を通してください。エフェクトレベルに応じて値をスケールする（`'reduced'` で半分、`'off'` で無音）ので、プレイヤーの快適性設定に自動で従います。`bandLevel(drive.bands, index, count)` はバンドを任意の本数に再サンプリングし、そのままスペアナに使えます。

反応は読み取れる大きさにしてください。数 % の脈動は 60 fps では見えません。組み込みスキンは bass に応じて形状をおよそ 0.8〜1.6 倍に変えています。

## エフェクトレベル

`effects`（`'full'` / `'reduced'` / `'off'`）はプレイヤーの快適性設定です。

- `'full'`: すべて有効。
- `'reduced'`: 画面揺れや全画面フラッシュなし、パーティクル少なめ。
- `'off'`: 静的なクロームと簡素なヒットフラッシュのみ。

`effectProfile(level)` は、組み込みスキンが使う量に変換します。この設定を必要とするプレイヤーがいるので、必ず尊重してください。

## フォント

描画に使うフェイスはすべて `fontLoads` に挙げてください。ホストはマウント前に `document.fonts.load` で読み込むので、最初のフレームが代替フォントでラスタライズされることを防げます。フェイス自体をホストが入手できるようにもしてください（フォントサービス経由、またはスキンに同梱）。

## パッケージングと読み込み

- **import の範囲:** スキンモジュールが import するのは `@be-music/skin-sdk`、選んだ描画フレームワーク、自身のファイルです。組み込みスキンもテストでこのルールを守らされているので、組み込みスキンがプレイヤーから使っているものはすべて使えます。
- **export:** スキンはモジュールの default export にします。
- **ホスト側:** ホストはスキンをレジストリに登録します。

  ```ts
  import { BUILT_IN_BE_MUSIC_SKINS, DefaultPixiGameplayView } from '@be-music/player-web/scenes';
  import { createBeMusicSkinRegistry } from '@be-music/player-web/skin';
  import mySkin from 'my-be-music-skin';

  const skins = createBeMusicSkinRegistry(BUILT_IN_BE_MUSIC_SKINS);
  const problems = skins.add(mySkin); // 追加できれば []、拒否されたらその理由
  const skin = skins.resolve('my-skin'); // 未知の id なら最初のスキンにフォールバック
  // デフォルトファミリーのビューに渡す: new DefaultPixiGameplayView({ …, beMusicSkin: skin })
  ```

  - `add` はスキンを検査します。同じ id が登録済みなら置き換えるので、開発中の再読み込みに便利です。
  - `subscribe(listener)` で追加を通知でき、ピッカーを更新できます。
  - 検査に通らないスキン（未対応の `apiVersion` など）は、ホストを壊さずに除外されます。

- **組み込みスキン:** `BUILT_IN_BE_MUSIC_SKINS` には Synesthesia（既定）、Phantom、Plain が入っています。Lattice は `latticeSkin` として同梱されており、ホストが追加します。
- **デモ:** デモの Debug Menu から、モジュール URL でスキンを追加できます（_Add skin_ → _Skin module URL_）。スキンはページの全権限で動くため、デモは先に確認を求めます。信頼できるスキンだけを読み込んでください。

## バージョニング

- **`version` を上げるとき:** スキンをリリースするたびに上げます。プレイヤーから見たセマンティックバージョニングに従い、見た目の追加はマイナー、修正はパッチにします。
- **`apiVersion`:** ビルドに使った SDK の定数にします。スキン API に互換性のない変更が入ると、プレイヤーは `BE_MUSIC_SKIN_API_VERSION` を上げます。古いリビジョン向けのスキンは、新しい SDK で再ビルドするまで拒否されます。
- **`id` を固定する:** ホストは選択中のスキンを `id` で保存します。

## チェックリスト

- [ ] メタデータが `validateBeMusicSkin` を通る。
- [ ] `setup` で作ったフレームワークのリソースを `teardown` で解放している。
- [ ] クロームは `layout` から配置し、判定ラインはレーンランごとに描いている。
- [ ] `runtime.hasBga` のとき BGA の矩形を透明のまま残している。
- [ ] `runtime.loading` の間は NOW LOADING を表示している。
- [ ] 選曲の行が `select.layout` と揃い、ボタンは描画のたびに `frame.hit` で宣言している。
- [ ] 音への反応は `audioDrive` を通し、`effects` を尊重している。
- [ ] 使うフェイスをすべて `fontLoads` に挙げている。
- [ ] SP、DP、5 / 7 / 9 / 10 / 14 / 24 / 48 KEY、BGA あり・なしで確認した。
