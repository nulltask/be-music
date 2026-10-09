[English version](./be-music-skin.md)

# be-music スキンの作り方

このガイドは、ブラウザプレイヤーの組み込み（デフォルト）ファミリー向けにスキンを作りたい人のためのものです。スキンは `@be-music/player-web/skin-sdk` サブパスに対して書きます。組み込みスキンもまさにこのサブパスだけを使っており、Synesthesia・Phantom・Plain・Lattice はプレイヤーの他の部分を一切 import していません。組み込みスキンにできることは、あなたのスキンにもできます。

be-music スキンはデータファイルではなくコードです。LR2 / beatoraja テーマはシーンが解釈しますが、be-music スキンは描画関数のセットを提供します。それ以外はすべてプレイヤーの担当です。

- 入力、タイミング、オーディオ、判定
- レーンのレイアウトとノーツの位置
- 選曲リストの当たり判定

各フレームの見た目はスキンが決めます。

## 2 つの描き方

|             | Canvas スキン（`defineCanvasSkin`）                                        | Pixi スキン（`defineBeMusicSkin`）                                                     |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 描画 API    | `'2d'` / `'webgl'` / `'webgl2'` / `'webgpu'` コンテキストの素の `<canvas>` | PixiJS v8 の表示オブジェクト                                                           |
| 書くもの    | 画面ごとに `draw` 関数を 1 つ                                              | クローム、レーン、ノーツ、ロングノーツ、ヒットエフェクト、選曲、リザルトの各レンダラー |
| Pixi の知識 | 不要                                                                       | 必要                                                                                   |
| 作例        | Plain（`packages/player-web/src/skins/plain/`）                            | Synesthesia、Phantom、Lattice（`packages/player-web/src/skins/`）                      |

フィルター、ブレンドモード、多数のレイヤーにまたがる GPU パーティクルなど Pixi の機能が必要でなければ、Canvas スキンから始めてください。Plain は意図的に小さく読みやすく作ってあるので、出発点としてコピーして使えます。

## クイックスタート: Canvas スキン

```ts
import { BE_MUSIC_SKIN_API_VERSION, defineCanvasSkin, resolveLaneRuns } from '@be-music/player-web/skin-sdk';

export default defineCanvasSkin({
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

### Canvas スキンの描画のしくみ

- **`draw` が呼ばれるタイミング:** プレイヤーがレンダリング直前に 1 フレーム 1 回呼びます。`'2d'` ではキャンバスはクリア・スケール済みなので、デザインピクセル（デフォルトステージで 854×480）で描けます。
- **その他のコンテキスト:** `'webgl'` / `'webgl2'` / `'webgpu'` ではキャンバス全体を自分で扱います。`surface.pixelRatio` がデザインピクセルあたりのキャンバスピクセル数です。
- **`setup(surface)`:** 新しいサーフェスごとに、最初の描画前に 1 回呼ばれます。シェーダーのコンパイルや GPU デバイスの取得に使います。Promise を返すと、描画はその完了を待ちます。
- **`contextAttributes`:** `canvas.getContext` にそのまま渡されます。
- **ドットバイドット:** 各キャンバスは画面上でステージが覆うデバイスピクセル数（ビューポート倍率 × `devicePixelRatio`）で確保され、nearest サンプリングで表示されます。描いたピクセルは画面に 1 対 1 で対応します。
- **ゲームプレイのフレーム（`CanvasGameplayFrame`）:**
  - `layout`
  - `lanes`（キービーム強度つき）
  - `notes`、`longNotes`
  - `bombs`（経過時間つきのヒットエフェクト）
  - `runtime`（HUD の値）
  - `beatPhase`、`effects`、`audio`
- **選曲のフレーム（`CanvasSelectFrame`）:** [選曲フレーム](#選曲bemusicselectskin)に、矩形をクリック可能にする `hit(x, y, w, h, action)` が加わったものです。アニメーション中は `select.draw` から `true` を返します。
- **任意の設定:**
  - `gameplay.bombDurationMs`（既定 300）
  - `select.outroMs`（既定 0）
  - `stage`（既定 `wideStage`）

## スキンのメタデータ

すべてのスキンが以下を宣言します。`defineBeMusicSkin` と `defineCanvasSkin` は内容を検査し、不正なら例外を投げます。壊れたスキンは定義した場所で失敗します。

| フィールド    | 必須 | ルール                                                                                                         |
| ------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `apiVersion`  | ○    | ビルドに使った SDK の `BE_MUSIC_SKIN_API_VERSION`。プレイヤーは未対応の API リビジョン向けスキンを拒否します。 |
| `id`          | ○    | 小文字英字・数字・ハイフン（`my-skin`）。ホストが保存するので、リリース間で変えないでください。                |
| `label`       | ○    | ピッカーに表示する名前。                                                                                       |
| `version`     | ○    | スキン自体のリリース。セマンティックバージョン（`1.2.0`）。                                                    |
| `author`      | ○    | `{ name, url? }`。`url` は http(s)。                                                                           |
| `description` | —    | ピッカー向けの 1〜2 文。                                                                                       |
| `homepage`    | —    | プロジェクトページやリポジトリの http(s) URL。                                                                 |
| `license`     | —    | スキンのコードと素材の SPDX 識別子（`MIT`）。                                                                  |
| `fontLoads`   | ○    | 描画に使う CSS フォント指定（`'400 24px "Anton"'`）。空でも可。                                                |
| `stage`       | —    | デザインキャンバス。[ステージとレイアウト](#ステージとレイアウト)を参照。                                      |

`validateBeMusicSkin(skin)` は、例外を投げずに同じ問題をメッセージの配列で返します。

## ステージとレイアウト

- **ステージ:** スキンが描くデザインキャンバスです。`wideStage` は組み込みスキンが使う 16:9 のステージ（854×480）です。`stage` を宣言しないスキンは LR2 互換の 640×480 になります。
- **BGA の配置:** `BeMusicStage.resolveBgaRect(playfieldRight)` がゲームプレイの BGA の位置を決めます。プレイヤーはそこに動画を合成し、スキンは同じ矩形に枠を描きます。`wideStage` は SP では BGA を大きく取り、幅の広い DP や鍵盤モードの横では縮めます。
- **フレームごとのレイアウト:** ゲームプレイの各フレームには、ホストが解決した `layout`（`BeMusicGameplayLayout`）が付きます。
  - `stage`: 幅と高さ。
  - `lanes`: 全レーン。チャンネル、種類（`white` / `black` / `scratch`）、サイド、x、幅を持ちます。譜面のプレイバリアント（5 / 7 / 9 / 10 / 14 / 24 / 48 KEY）の全レーンが、譜面で使われないレーンも含めて常に並びます。
  - `playfield`: `left`、`right`、`centerX`、`top`、`judgementY`、`sides`（1P と、DP なら 2P の水平範囲）。
  - `bga`: BGA の矩形。プレイフィールドに余地がなければ `undefined`。
- **クロームの配置:** ジオメトリをハードコードせず、これらの値から配置してください。DP、鍵盤モード、新しいアスペクト比などホスト側のレイアウト変更が、そのままスキンにも反映されます。
- **DP の隙間:** 1P と 2P のバンクは 60 px 離れています。`resolveLaneRuns(lanes)` は連続したバンクごとに `{ left, right }` を 1 つ返します。判定ラインやレーングリッドはラン単位で描き、隙間をまたがないようにします。
- **レーン幅:** レーン幅はプレイヤーが決めます。スキンはレーンに色を付けますが、大きさや位置は変えません。

## Pixi スキン

`defineBeMusicSkin` は同じメタデータに 3 つの画面を加えて受け取ります。描画には `pixi.js`（プレイヤーの peer dependency）を使います。

### ゲームプレイ（`BeMusicGameplaySkin`）

| メンバー                  | 受け取るもの                                                                             | 描くもの                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `renderChrome(context)`   | `layer`、`overlayLayer`、それぞれの `ChildPool`、`runtime`、`layout`                     | プレイフィールドの周り全部: ヘッダー、ゲージ、スコア、BGA 枠、判定 / コンボ、演出 |
| `renderLanes(context)`    | クリア済みの `Graphics` 1 つ、`lanes`、`beatPhase`、`nowMs`、`combo`、`effects`、`audio` | レーン下地、キービーム、判定ライン                                                |
| `renderNote(context)`     | 新しいプール済み `Graphics`、レーン `kind`、`x`、`w`、`y`（ノーツの下端）                | タップノーツ 1 つ                                                                 |
| `renderLongNote(context)` | 新しいプール済み `Graphics`、`kind`、`x`、`w`、`top`（終端）、`bottom`（始端）           | ロングノーツ 1 つ                                                                 |
| `renderBombs(context)`    | `ChildPool`、`bombs`、`nowMs`、`combo`、`effects`、`audio`                               | 生きているヒットエフェクトすべて                                                  |
| `bombDurationMs`          | —                                                                                        | ヒットエフェクトの寿命                                                            |

表示オブジェクトはフレームごとに生成せず、渡されたプールから取得してください（`layerPool.acquireGraphics()`、`acquireText()` など）。プールは前フレームのオブジェクトを再利用するので、フレーム時間が安定します。

### `runtime` の値

`runtime`（`SkinlessGameplayChromeRuntime`）は HUD の値を持ちます。

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

### 選曲（`BeMusicSelectSkin`）

- **`layout`:** `listX`、`listTop`、`listBottomInset`、`rowHeight`。シーンはこの値で行の当たり判定をするので、描く行と一致させてください。
- **`createRenderer()`:** 選曲シーンごとに 1 回呼ばれ、次のメンバーを持つ `BeMusicSelectRenderer` を返します。
  - `backLayer` / `frontLayer`: 毎フレーム作り直すレイヤーの背面と前面にある永続レイヤー。
  - `render(frame)`: 入力に応じたクロームを `frame.layer` に作り直します。トランジション中は `true` を返します。
  - `tick(nowMs, focusedSong, launchAt, audio)`: 永続レイヤーの毎フレームのアニメーション（変形のみ）。
  - `outroMs`: 曲決定後のアウトロの長さ。終わるまでシーンは `frame.launchAt` を設定して描画を続け、その間の入力は無視します。
  - `dispose()`
- **フレーム（`BeMusicSelectFrame`）:**
  - `entries`、`selectedIndex`、`firstVisibleIndex`、`visibleRows`、`focusedSong`
  - `folderLabel`、`searchQuery`、`totalCharts`
  - `actions`（`play`、`autoPlay`、`activateSearch`）
  - 登場やフォーカス移動のトランジション用のタイムスタンプ
  - `effects`、`launchAt`
- **クリック領域:** Pixi のクロームをクリック可能にするには `addHitArea` を使います。

### リザルト（`BeMusicResultSkin`）

- **`render(frame)`:** 毎フレーム `frame.layer` を作り直します。
- **フレームの内容:**
  - `result`（スコア、判定数、ゲージ推移など）
  - `rankLabel`（IIDX の DJ LEVEL）、`ratePercent`
  - `elapsedMs`（シーン開始からの経過。登場演出をスキップした後は `Infinity`）
  - `effects`
- **ヘルパー:** `resolveResultLamp` と `resolveResultTrackRows` が、組み込みスキンの表示するクリアランプとトラック行を返します。

## SDK ヘルパー

| 分野                 | ヘルパー                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ステージ             | `wideStage`、`resolveStageBgaRect`、`STAGE_WIDTH`、`STAGE_HEIGHT`、`STAGE_MARGIN`、`STAGE_SIDE_COLUMN`、`STAGE_BGA_BAND`                                                        |
| レイアウト           | `resolveGameplayLayout`、`resolveLaneRuns`、`resolveMilestoneArea`                                                                                                              |
| テキスト（Pixi）     | `addHudText`、`addHudNumber`（プール・tint・キャップハイト揃え）、`addSkinText`、`addHitArea`、`formatPlayVariantLabel`、`DEFAULT_TEXT_FONT`                                    |
| パーティクル（Pixi） | `pointLayerFor(graphics)`: プール済み `Graphics` に追従する GPU ポイントパーティクル                                                                                            |
| キービーム（Pixi）   | `keyBeamGradient(color)`、`KEY_BEAM_STOPS`                                                                                                                                      |
| 判定                 | `judgeDisplayWord`（PERFECT は GREAT と表示）、`isFlashingGreat`、`flashingGreatColor`                                                                                          |
| 演出                 | `trackMoments` / `updateMoments`（カウントイン、100 コンボごと、クリアライン、フルコンボ、コンボ切れ）、`comboTier`、`momentProgress`、`impulse`、`punchScale`、`effectProfile` |
| ロード中             | `LOADING_WORD`、`loadingDots(nowMs)`                                                                                                                                            |
| サウンド             | `audioDrive`、`bandAt`、`bandLevel`。[音楽に反応させる](#音楽に反応させる)を参照                                                                                                |
| リザルト             | `resolveResultLamp`、`resolveResultTrackRows`                                                                                                                                   |
| 曲情報               | `resolveSongRowFacts`、`resolveSongStats`、`resolveSongTags`、`formatSongLength`、`formatBpmRange`                                                                              |
| モーション           | `easeOutCubic`、`easeOutBack`、`stageProgress`、`rollUpValue`、`hash01`（決定的なゆらぎ）                                                                                       |

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

- **import の範囲:** スキンモジュールが import するのは `@be-music/player-web/skin-sdk`、`pixi.js`（Pixi スキンの場合）、自身のファイルだけです。組み込みスキンもテストでこのルールを守らされているので、組み込みスキンが使うものはすべて使えます。
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
- [ ] クロームは `layout` から配置し、判定ラインはレーンランごとに描いている。
- [ ] BGA の矩形が見えている（Canvas スキンは `runtime.hasBga` のとき `clearRect`）。
- [ ] `runtime.loading` の間は NOW LOADING を表示している。
- [ ] 選曲の行が `select.layout` と揃い、ボタンがクリックできる。
- [ ] 音への反応は `audioDrive` を通し、`effects` を尊重している。
- [ ] 使うフェイスをすべて `fontLoads` に挙げている。
- [ ] SP、DP、5 / 7 / 9 / 10 / 14 / 24 / 48 KEY、BGA あり・なしで確認した。
