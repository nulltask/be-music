[English version](./README.md)

# Player UI

Be-Music の表示を再利用する Lit 製 Web Components です。表示データを JavaScript の property で受け取り、操作要求を bubbling・composed な `CustomEvent` で通知します。エンジン・クロック・AudioContext・購読は所有しません。Native Skin も DOM スキンのアダプターを介して同じ部品を使います。

## パッケージ

| パッケージ                  | 役割                                            |
| --------------------------- | ----------------------------------------------- |
| `@be-music/player-ui`       | Web Components・表示用の型・明示的な要素登録    |
| `@be-music/player-ui-react` | 型付き React コンポーネント・イベント・要素 ref |
| `@be-music/player-ui-vue`   | 型付き Vue コンポーネント・emits・要素 ref      |

React・Vue はそれぞれのラッパーの peer dependency です。スキン SDK は Lit・React・Vue に依存しません。

## コンポーネント

| 要素                        | property                                                |
| --------------------------- | ------------------------------------------------------- |
| `be-music-score-summary`    | `data: BeMusicScoreData`、任意の `compact`              |
| `be-music-judgment-table`   | `data: BeMusicJudgmentData`                             |
| `be-music-gauge-panel`      | `data: BeMusicGaugeData`、任意の `compact`              |
| `be-music-timing-graph`     | `data: BeMusicTimingData`                               |
| `be-music-play-settings`    | `data: BeMusicSettingsData`                             |
| `be-music-chart-list`       | `entries`・`selectedIndex`・`disabled`                  |
| `be-music-chart-details`    | `entry`・`launching`・`readText`                        |
| `be-music-play-options`     | `options`・`choices`・`disabled`                        |
| `be-music-select-screen`    | `frame: BeMusicDOMSelectFrame`                          |
| `be-music-gameplay-hud`     | `frame: BeMusicDOMGameplayFrame`                        |
| `be-music-result-screen`    | `frame: BeMusicDOMResultFrame`                          |
| `be-music-decide-screen`    | `frame: BeMusicDOMDecideFrame`                          |
| `be-music-lanes`            | `data: BeMusicLanesData`・`rect: BeMusicRect`           |
| `be-music-notes`            | `data: BeMusicNotesData`・`rect: BeMusicRect`           |
| `be-music-lane-covers`      | `data: BeMusicLaneCoversData`・`rect: BeMusicRect`      |
| `be-music-judge-line`       | `data: BeMusicJudgeLineData`・`rect: BeMusicRect`       |
| `be-music-bombs`            | `data: BeMusicBombsData`・`rect: BeMusicRect`           |
| `be-music-judgment-display` | `data: BeMusicJudgmentDisplayData`・`rect: BeMusicRect` |
| `be-music-playfield`        | `frame: BeMusicGameplayFrame`                           |

各クラスを `BeMusic…Element` として export します。ラッパーは `BeMusicGameplayHUD`・`BeMusicJudgmentTable` のように `Element` を除いた名前です。個々の部品は自身に必要な表示データだけを受け取り、独立して配置できます。画面コンポーネントはそれらを組み合わせ、既存の DOM スキンフレームを受け取ります。

## プレイフィールド

プレイフィールドの各要素は、要素の box のデバイスピクセルに合わせた自分専用の canvas に描画します。`rect` は要素が受け持つステージ上の範囲（ステージのデザイン座標）で、`data` も同じ座標で描くため、要素の位置と大きさはレイアウト側で自由に決められます。`be-music-playfield` は `BeMusicGameplayFrame` 全体を受け取り、`resolvePlayfieldParts(frame)` で分割して、レターボックスしたステージ上の各範囲に要素を配置します。ゲームプレイ HUD の下に重ねて使います。要素はクロックを持たないため、毎アニメーションフレーム frame を渡してください。

`paintPlayfieldParts(context, parts)` は、ステージ全体の surface しか持たない host 向けに、同じ部品を一つの Canvas 2D context に各範囲で clip して描きます。独自の部品は `BeMusicPlayfieldCanvasElement` を継承して `paint(context, data)` を実装します。プレイフィールドは `stage`・`lanes`・`notes`・`lane-covers`・`judge-line`・`bombs`・`judgment-display` の parts を、各要素は `canvas` part を公開します。

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

各要素は Shadow DOM を使います。`--be-music-color-text`・`--be-music-color-muted`・`--be-music-color-background`・`--be-music-color-accent`・`--be-music-panel-background`・`--be-music-control-background`・`--be-music-focus-color`・`--be-music-timing-color`・`--be-music-font`・`--be-music-radius` が継承されるテーマ用トークンです。

Gameplay HUD は `hud`・`heading`・`primary`・`actions`・`details`・`score-summary`・`score-value`・`score-panel`・`judgment-panel`・`judgment-table`・`gauge-meter`・`gauge-panel`・`gauge-graph`・`timing-panel`・`timing-graph`・`settings-panel` を、一時停止中は `paused` も part として公開します。各部品は `panel` と、該当する `table`・`graph`・`meter`・`value` を公開します。Gameplay と譜面詳細には `actions` slot と既定 slot があり、ほかの画面には既定 slot があります。

```css
be-music-gameplay-hud {
  --be-music-color-accent: #a8e6ce;
  --be-music-font: system-ui, sans-serif;
}
be-music-gameplay-hud::part(judgment-table) {
  font-size: 12px;
}
```

## ライフサイクルと描画

import だけでは Be-Music のタグを登録しません。SSR ではラッパーがホスト要素を出力し、property と内部の表示をクライアントで設定します。コンポーネント全体の SSR・hydration はこの実装の対象に含みません。

切り離して再接続しても要素の状態を保ちます。シーンの購読解除とプレイヤーの破棄は所有者が別に行います。Native のアダプターは破棄時に操作イベントを解除します。通常の Gameplay property 更新をおよそ毎秒12回に制限し、ステージ・向き・表示設定の変更は即座に渡します。Lit が描画をまとめ、グラフは描画点数を制限します。プレイフィールドは毎アニメーションフレーム更新し、各要素の canvas だけを描き直します。

依存関係と登録方法の判断は [ADR 0013](../../docs/adr/0013-player-ui-components.ja.md) に記録しています。
