[English version](./README.md)

# Player UI

Be-Music の表示を再利用する Lit 製 Web Components です。表示データを JavaScript の property で受け取り、操作要求を bubbling・composed な `CustomEvent` で通知します。エンジン・クロック・AudioContext・購読は所有しません。要素は headless で、持つのはレイアウトだけです。見た目はテーマから与えます（[外観と組み立て](#外観と組み立て)）。Native Skin も DOM スキンのアダプターを介して同じ部品を使います。

## パッケージ

| パッケージ                  | 役割                                            |
| --------------------------- | ----------------------------------------------- |
| `@be-music/player-ui`       | Web Components・表示用の型・明示的な要素登録    |
| `@be-music/player-ui-react` | 型付き React コンポーネント・イベント・要素 ref |
| `@be-music/player-ui-vue`   | 型付き Vue コンポーネント・emits・要素 ref      |

React・Vue はそれぞれのラッパーの peer dependency です。スキン SDK は Lit・React・Vue に依存しません。

## コンポーネント

| 要素                         | property                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| `be-music-score-summary`     | `data: BeMusicScoreData`、任意の `compact`                        |
| `be-music-judgment-table`    | `data: BeMusicJudgmentData`                                       |
| `be-music-gauge-panel`       | `data: BeMusicGaugeData`、任意の `compact`                        |
| `be-music-timing-graph`      | `data: BeMusicTimingData`                                         |
| `be-music-play-settings`     | `data: BeMusicSettingsData`                                       |
| `be-music-chart-list`        | `entries`・`selectedIndex`・`disabled`                            |
| `be-music-chart-details`     | `entry`・`launching`・`readText`                                  |
| `be-music-play-options`      | `options`・`choices`・`disabled`                                  |
| `be-music-select-screen`     | `frame: BeMusicDOMSelectFrame`                                    |
| `be-music-gameplay-hud`      | `frame: BeMusicDOMGameplayFrame`                                  |
| `be-music-result-screen`     | `frame: BeMusicDOMResultFrame`                                    |
| `be-music-decide-screen`     | `frame: BeMusicDOMDecideFrame`                                    |
| `be-music-bga`               | `data: BeMusicBGAData`・`rect: BeMusicRect`                       |
| `be-music-lanes`             | `data: BeMusicLanesData`・`rect: BeMusicRect`                     |
| `be-music-notes`             | `data: BeMusicNotesData`・`rect: BeMusicRect`                     |
| `be-music-lane-covers`       | `data: BeMusicLaneCoversData`・`rect: BeMusicRect`                |
| `be-music-judge-line`        | `data: BeMusicJudgeLineData`・`rect: BeMusicRect`                 |
| `be-music-bombs`             | `data: BeMusicBombsData`・`rect: BeMusicRect`                     |
| `be-music-judgment-display`  | `data: BeMusicJudgmentDisplayData`・`rect: BeMusicRect`           |
| `be-music-playfield`         | `frame: BeMusicGameplayFrame`                                     |
| `be-music-playback-controls` | `data: BeMusicPlaybackData`                                       |
| `be-music-preview-hud`       | `frame: BeMusicDOMGameplayFrame`・`volume`・`muted`・`fullscreen` |
| `be-music-preview-select`    | `charts: readonly LibraryChart[]`・`heading`・任意の `images`     |
| `be-music-preview-start`     | `mode: 'play' \| 'replay'`・`disabled`                            |

各クラスを `BeMusic…Element` として export します。ラッパーは `BeMusicGameplayHUD`・`BeMusicJudgmentTable` のように `Element` を除いた名前です。個々の部品は自身に必要な表示データだけを受け取り、独立して配置できます。画面コンポーネントはそれらを組み合わせ、既存の DOM スキンフレームを受け取ります。

## プレイフィールド

プレイフィールドの各要素は、要素の box のデバイスピクセルに合わせた自分専用の canvas に描画します。`rect` は要素が受け持つステージ上の範囲（ステージのデザイン座標）で、`data` も同じ座標で描くため、要素の位置と大きさはレイアウト側で自由に決められます。`be-music-playfield` は `BeMusicGameplayFrame` 全体を受け取り、`resolvePlayfieldParts(frame)` で分割して、レターボックスしたステージ上の各範囲に要素を配置します。ゲームプレイ HUD の下に重ねて使います。要素はクロックを持たないため、毎アニメーションフレーム frame を渡してください。

`paintPlayfieldParts(context, parts)` は、ステージ全体の surface しか持たない host 向けに、同じ部品を一つの Canvas 2D context に各範囲で clip して描きます。独自の部品は `BeMusicPlayfieldCanvasElement` を継承して `paint(context, data)` を実装します。BGA は BMS の慣例に従い、POOR の表示中はベースとレイヤーの代わりに POOR の画像を描き、256x256 の BGA キャンバスに収まる静止画はその大きさのまま置きます。`be-music-playfield` はステージを `--background`、周囲のレターボックスを `--be-music-letterbox-background` で塗ります。プレイフィールドは `stage`・`bga`・`lanes`・`notes`・`lane-covers`・`judge-line`・`bombs`・`judgment-display` の parts を、各要素は `canvas` part を公開します。

## プレビュー

`be-music-playback-controls` は動画プレイヤーのコントロールバーです。再生／一時停止（`pause-request`）、ドラッグ中と離したときに `{ seconds }` 付きの `seek-request` を送るシークバー、時間、ミュートと音量（`{ volume, muted }` 付きの `volume-change`）、全画面（`fullscreen-request`）があります。`be-music-preview-hud` は譜面の情報・スコア・コンボ・ゲージ・判定を BGA の範囲の下に、コントロールをステージの下端に置き、それらの要求を伝えます。`be-music-preview-select` はトラックの譜面を一覧し、`images` にあればその絵（`#STAGEFILE`、なければ `#BANNER`）を出し、`activate-request` で 1 つを要求します。`be-music-preview-start` は大きな再生／リプレイボタン（`play-request`）です。`formatPlaybackTime`・`resolveSeekTarget`・`resolveGameplayPanels` はこれらを支える純粋関数です。埋め込みページがこれらを組み合わせています（[ブラウザープレイヤー](../../docs/player-web.ja.md#埋め込みプレビュー)）。

## HTML・TypeScript

`@be-music/player-ui` をインストールし、ブラウザで明示的に登録します。

```ts
import { defineBeMusicElements, type BeMusicDOMGameplayFrame, type BeMusicUIEvent } from '@be-music/player-ui';

defineBeMusicElements();
const hud = document.createElement('be-music-gameplay-hud');
hud.addEventListener('pause-request', (event) => {
  const request = event as BeMusicUIEvent<'pause-request'>;
  pause(request);
});
container.append(hud);

// アプリケーションまたは DOM スキンのアダプターから呼びます。要素自身は再生を進めません。
function present(frame: BeMusicDOMGameplayFrame): void {
  hud.frame = frame;
}
```

`frame`・`data`・`entries` などのオブジェクトは property であり、JSON の attribute にはしません。同じクラスでの登録は何度呼んでも安全です。別実装とのタグ衝突はエラーにします。クラスを個別に `customElements.define` で登録することもできます。画面の内部で使う子要素も登録してください。

## React

React と `@be-music/player-ui-react` をインストールします。ラッパーはクライアントの effect で要素を登録し、`@lit/react` でオブジェクトの property・型付きイベント・ref を受け渡します。

```tsx
import { BeMusicGameplayHUD } from '@be-music/player-ui-react';

<BeMusicGameplayHUD
  frame={frame}
  onPauseRequest={() => controller.pause()}
  onRetryRequest={() => controller.restart()}
  onQuitRequest={() => controller.quit()}
/>;
```

コールバックは `CustomEvent` を受け取ります。`onSelectionChange` などのデータは `event.detail` に入ります。要素 ref は元のクラスを公開し、`BeMusicSelectScreenElement` の `focusSearch()` などを呼べます。この例の controller はアプリケーション側の操作アダプターであり、UI が特定の controller 実装を要求することはありません。

## Vue

Vue 3.5 以降と `@be-music/player-ui-vue` をインストールします。ラッパーはクライアントの mount 前に要素を登録し、property を設定し、CustomEvent を Vue の emits に変換します。利用側の `compilerOptions.isCustomElement` 設定は不要です。

```vue
<script setup lang="ts">
import { BeMusicGameplayHUD, type BeMusicGameplayHUDProps } from '@be-music/player-ui-vue';
const { frame, controller } = defineProps<{
  frame?: BeMusicGameplayHUDProps['frame'];
  controller: { pause(): void; restart(): void; quit(): void };
}>();
</script>

<template>
  <BeMusicGameplayHUD
    :frame="frame"
    @pause-request="controller.pause()"
    @retry-request="controller.restart()"
    @quit-request="controller.quit()"
  />
</template>
```

Vue は detail を直接 emit するため、`@selection-change="({ index }) => select(index)"` と書けます。イミュータブルなフレームを Vue に保存する場合は `shallowRef` を使います。コンポーネント ref は `BeMusicVueElementRef` を通して `element` と `focusSearch()` を公開します。

## 外観と組み立て

各要素は headless です。shadow 内のスタイルはレイアウト・寸法・スクロール・コンテナクエリだけで、色・枠線・背景・フォントファミリーは指定しません。見た目は次の 3 か所から与えます（範囲の広い順）。

1. **テーマ**: 各要素が自身のスタイルの後に shadow root へ採用するスタイルシート。登録時に渡します: `defineBeMusicElements(registry, { theme })`。`@be-music/player-ui/themes/basecoat` は `basecoatTheme` を公開します。中身は Basecoat と、ページの Basecoat トークン（`--background`、`--foreground`、`--primary`、`--muted-foreground`、`--card`、`--border`、`--radius` など）から取る要素の色・枠線・背景です。独自のテーマは shadow root 内の part を選択できます（`[part~='panel']`）。テーマがなければ要素はブラウザ既定の見た目で描画されます。後から `theme` なしで呼んでも設定済みのテーマは保たれ、テーマは要素が初めて描画されるときに適用されます。
2. **カスタムプロパティ**: どの祖先からでも継承します（下表）。
3. **part と slot**: 外側から装飾し、内容を差し込みます。

```ts
import { defineBeMusicElements } from '@be-music/player-ui';
import { basecoatTheme } from '@be-music/player-ui/themes/basecoat';

defineBeMusicElements(customElements, { theme: basecoatTheme });
```

React と Vue のラッパーはテーマなしで登録します。マウントする前に、テーマを付けて `defineBeMusicElements` を呼んでください。

| プロパティ                                         | 既定値                     | 決めるもの                                              |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------- |
| `--be-music-gap`                                   | `8px`                      | 要素内の間隔（行・操作・数値）                          |
| `--be-music-panel-padding`                         | `12px`                     | パネルの内側余白（Gameplay HUD は `8px`）               |
| `--be-music-section-gap`                           | `24px`                     | 画面のセクション間の間隔                                |
| `--be-music-screen-padding`                        | `24px`                     | 画面の内側余白                                          |
| `--be-music-center-width`                          | `56rem`                    | デサイドとリザルトの列の最大幅                          |
| `--be-music-title-size` / `-weight` / `-tracking`  | `1.75rem` / `600` / normal | 画面の見出し                                            |
| `--be-music-stat-size`                             | `2.25rem`                  | リザルトの EX スコア                                    |
| `--be-music-graph-height`                          | `44px`                     | ゲージとタイミングのグラフ（リザルトのゲージは `72px`） |
| `--be-music-row-kind-width`                        | `3.5ch`                    | 譜面リストのレベル列                                    |
| `--be-music-list-height`                           | `55vh`                     | 画面の外で使う譜面リストの高さ                          |
| `--be-music-score-size`                            | `1.8em`                    | コンパクトなスコアの数値                                |
| `--be-music-letterbox-background` / `--background` | `#09090b`                  | プレイフィールドのレターボックスの帯とステージ          |
| `--be-music-timing-color`                          | `#ffa8b3`                  | タイミンググラフの線                                    |

配置は各要素自身の表示幅に従います。各要素は `be-music` という名前の inline-size コンテナで、画面は `be-music-screen` に変えます。40rem 未満ではコレクションのカラムが縦に積み、検索欄が全幅になり、譜面リストの高さを 18rem に抑えます。それ以上の幅では、リストが譜面詳細の隣の列いっぱいになり、リストの列は詳細より広く残します。30rem 未満では、リザルトのパネルが判定結果を数値の上に積みます。22rem 未満では、判定表が Early / Late 列を隠し、再生コントロールが音量スライダーを隠し、プレビューの譜面行はレベルとジャンルをタイトルの下に置き、横画面の Gameplay HUD は操作と詳細カードを詰めます。16rem 未満では、コンパクトなスコアの数値が単独の行になります。プレイオプションは収まるだけの等幅の列に並びます。`compact` は呼び出し側が明示する property のままです。Gameplay とプレビューのステージは `cqw` と `cqh` で大きさを決め、縦画面の配置はステージの向きに従います。

画面は `screen`・`header`・`eyebrow`・`title` を part として公開します。コレクションは加えて `search`・`folder`・`columns`・`list`・`row`・`details-panel`・`chart-title`、デサイド画面は `progress`・`actions`、リザルトは `players`・`panel`・`stat`・`actions`・`gauge-panel`・`gauge-graph` を公開します。Gameplay HUD は `hud`・`heading`・`primary`・`actions`・`details`・`chart-panel`・`score-summary`・`score-value`・`score-panel`・`judgment-panel`・`judgment-table`・`gauge-meter`・`gauge-panel`・`gauge-graph`・`timing-panel`・`timing-graph`・`settings-panel` を、一時停止中は `paused` も part として公開します。`cabinet` property を設定すると（Native が設定します）、横向きの標準レイアウトのプレイはスキン SDK の筐体レイアウト（`resolveCabinetLayout`）で並びます。レーンの下に鍵盤・ゲージ・スコア・ハイスピード、その横にスコアグラフ、右にステージ名の帯（操作ボタンと、BGA の上にプレイ情報を開く Info ボタン）・プレイヤー・判定パネル・BPM・テンポを置きます。DP の譜面は中央に置き、譜面と判定パネルを左に、ゲージの値を左右の鍵盤の間（`center`）に、ボタンをメニューの角の横の帯（`controls`）に置きます。このとき `play`・`progress`・`keys`・`score`・`hi-speed`・`graph-header`・`graph`・`graph-footer`・`stage`・`controls`・`center`・`players`・`difficulty`・`second-player`・`judge`・`bpm`・`tempo` を part として公開します。各部品は `panel` と、該当する `table`・`graph`・`meter`・`value` を公開し、譜面リストの行は `row-kind` も公開します。コレクション・デサイド・リザルトの画面は見出しの上に `eyebrow` slot を持ち（デサイドとリザルトは差し込まなければ "Up next" と "Play result" を表示）、コレクションは `title` slot も持ちます。Gameplay と譜面詳細には `actions` slot と既定 slot があり、ほかの画面には既定 slot があります。

```css
be-music-gameplay-hud {
  --primary: #a8e6ce;
  --font-sans: system-ui, sans-serif;
  --be-music-panel-padding: 10px;
}
be-music-gameplay-hud::part(judgment-table) {
  font-size: 12px;
}
```

**どこに何を置くか。** コンポーネントは、どの大きさでも成り立つためのもの（レイアウト、ブレークポイント、上表の余白の長さ）を持ちます。テーマは色・枠線・背景・フォントを持ちます。スキンやアプリケーションは独自のスケールと語り口を持ちます。Native は余白と見出しの文字組みをこれらのプロパティと `::part` ルールで、製品名を `eyebrow` slot で設定します（[ADR 0020](../../docs/adr/0020-headless-player-ui.ja.md)）。

## ライフサイクルと描画

import だけでは Be-Music のタグを登録しません。SSR ではラッパーがホスト要素を出力し、property と内部の表示をクライアントで設定します。コンポーネント全体の SSR・hydration はこの実装の対象に含みません。

切り離して再接続しても要素の状態を保ちます。シーンの購読解除とプレイヤーの破棄は所有者が別に行います。Native のアダプターは破棄時に操作イベントを解除します。通常の Gameplay property 更新をおよそ毎秒12回に制限し、ステージ・向き・表示設定の変更は即座に渡します。Lit が描画をまとめ、グラフは描画点数を制限します。プレイフィールドは毎アニメーションフレーム更新し、各要素の canvas だけを描き直します。

依存関係と登録方法の判断は [ADR 0013](../../docs/adr/0013-player-ui-components.ja.md) に記録しています。
