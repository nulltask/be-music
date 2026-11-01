[Japanese version](./README.ja.md)

# Player UI

Reusable Lit Web Components for Be-Music. The components receive presentation data through JavaScript properties and emit semantic requests as bubbling, composed `CustomEvent`s. They own no engine, clock, audio context or subscriptions, and ship headless: layout only, with the look from a theme ([Styling](#styling-and-composition)). Native Skin uses the same components through its DOM skin adapter.

## Packages

| Package                     | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `@be-music/player-ui`       | Web Components, presentation types and explicit registration |
| `@be-music/player-ui-react` | Typed React components, event callbacks and element refs     |
| `@be-music/player-ui-vue`   | Typed Vue components, emits and element refs                 |

React and Vue are peer dependencies of their respective wrappers. The skin SDK has no Lit, React or Vue dependency.

## Components

| Element                      | Properties                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `be-music-score-summary`     | `data: BeMusicScoreData`, optional `compact`                      |
| `be-music-judgment-table`    | `data: BeMusicJudgmentData`                                       |
| `be-music-gauge-panel`       | `data: BeMusicGaugeData`, optional `compact`                      |
| `be-music-timing-graph`      | `data: BeMusicTimingData`                                         |
| `be-music-play-settings`     | `data: BeMusicSettingsData`                                       |
| `be-music-chart-list`        | `entries`, `selectedIndex`, `disabled`                            |
| `be-music-chart-details`     | `entry`, `launching`, `readText`                                  |
| `be-music-play-options`      | `options`, `choices`, `disabled`                                  |
| `be-music-select-screen`     | `frame: BeMusicDOMSelectFrame`                                    |
| `be-music-gameplay-hud`      | `frame: BeMusicDOMGameplayFrame`                                  |
| `be-music-result-screen`     | `frame: BeMusicDOMResultFrame`                                    |
| `be-music-decide-screen`     | `frame: BeMusicDOMDecideFrame`                                    |
| `be-music-bga`               | `data: BeMusicBGAData`, `rect: BeMusicRect`                       |
| `be-music-lanes`             | `data: BeMusicLanesData`, `rect: BeMusicRect`                     |
| `be-music-notes`             | `data: BeMusicNotesData`, `rect: BeMusicRect`                     |
| `be-music-lane-covers`       | `data: BeMusicLaneCoversData`, `rect: BeMusicRect`                |
| `be-music-judge-line`        | `data: BeMusicJudgeLineData`, `rect: BeMusicRect`                 |
| `be-music-bombs`             | `data: BeMusicBombsData`, `rect: BeMusicRect`                     |
| `be-music-judgment-display`  | `data: BeMusicJudgmentDisplayData`, `rect: BeMusicRect`           |
| `be-music-playfield`         | `frame: BeMusicGameplayFrame`                                     |
| `be-music-playback-controls` | `data: BeMusicPlaybackData`                                       |
| `be-music-preview-hud`       | `frame: BeMusicDOMGameplayFrame`, `volume`, `muted`, `fullscreen` |
| `be-music-preview-select`    | `charts: readonly LibraryChart[]`, `heading`, optional `images`   |
| `be-music-preview-start`     | `mode: 'play' \| 'replay'`, `disabled`                            |

Each class is exported as `BeMusic…Element`. Wrappers export the same names without `Element`, for example `BeMusicGameplayHUD` and `BeMusicJudgmentTable`. Leaf components take only their own presentation data and can be arranged independently. Screen components compose those leaves and accept the existing DOM skin frames.

## Playfield

The playfield elements each draw on their own canvas, sized to the device pixels of the element's box. `rect` is the part of the stage the element covers, in stage design pixels, and `data` is drawn in the same coordinates, so an element can be placed and sized freely by its layout. `be-music-playfield` takes a whole `BeMusicGameplayFrame`, splits it with `resolvePlayfieldParts(frame)`, and places each element on its part of the letterboxed stage, under the gameplay HUD. Give it a frame on every animation frame; the elements own no clock.

`paintPlayfieldParts(context, parts)` paints the same parts on one Canvas 2D context, each clipped to its rect, for a host that offers only a stage-sized surface. Subclass `BeMusicPlayfieldCanvasElement` and implement `paint(context, data)` for a part of your own. The BGA follows the BMS convention: the POOR image replaces the base and layer while a POOR shows, and a still image that fits the 256x256 BGA canvas keeps its size there. `be-music-playfield` paints the stage with `--background` and the letterbox around it with `--be-music-letterbox-background`. The playfield exposes `stage`, `bga`, `lanes`, `notes`, `lane-covers`, `judge-line`, `bombs` and `judgment-display` parts, and each element a `canvas` part.

## Preview

`be-music-playback-controls` is a video player's control bar: play / pause (`pause-request`), a seek bar that requests `seek-request` with `{ seconds }` while it is dragged and again when let go, the time, mute and volume (`volume-change` with `{ volume, muted }`) and full screen (`fullscreen-request`). `be-music-preview-hud` lays the chart's facts, score, combo, gauge and judgments under the BGA rect and the controls along the bottom of the stage, and forwards their requests. `be-music-preview-select` lists a track's charts, showing each chart's picture from `images` (a `#STAGEFILE`, or a `#BANNER` when the host supplies one), and requests one with `activate-request`; `be-music-preview-start` is the large play or replay button (`play-request`). `formatPlaybackTime`, `resolveSeekTarget` and `resolveGameplayPanels` are the pure helpers behind them. The embed page composes them ([browser player](../../docs/player-web.md#embedded-preview)).

## HTML and TypeScript

Install `@be-music/player-ui`, then explicitly register the elements in the browser:

```ts
import { defineBeMusicElements, type BeMusicDOMGameplayFrame, type BeMusicUIEvent } from '@be-music/player-ui';

defineBeMusicElements();
const hud = document.createElement('be-music-gameplay-hud');
hud.addEventListener('pause-request', (event) => {
  const request = event as BeMusicUIEvent<'pause-request'>;
  pause(request);
});
container.append(hud);

// Called by the application or a DOM skin adapter; the element does not advance playback.
function present(frame: BeMusicDOMGameplayFrame): void {
  hud.frame = frame;
}
```

`frame`, `data`, `entries`, and other object values are properties, not JSON attributes. Registration is idempotent for the same classes and rejects tag conflicts with another implementation. Classes may also be registered individually with `customElements.define`; composing screens need their child elements registered too.

## React

Install `@be-music/player-ui-react` with React. The wrapper registers elements in a client effect and forwards object properties, typed custom events and refs through `@lit/react`.

```tsx
import { BeMusicGameplayHUD } from '@be-music/player-ui-react';

<BeMusicGameplayHUD
  frame={frame}
  onPauseRequest={() => controller.pause()}
  onRetryRequest={() => controller.restart()}
  onQuitRequest={() => controller.quit()}
/>;
```

Callbacks receive the `CustomEvent`; payloads such as `onSelectionChange` are in `event.detail`. Element refs expose the underlying class, including `focusSearch()` on `BeMusicSelectScreenElement`. The controller in this example is an application adapter implementing these commands; no particular controller implementation is required by the UI.

## Vue

Install `@be-music/player-ui-vue` with Vue 3.5 or later. The wrapper registers elements before client mounting, assigns properties and converts custom events to Vue emits. This does not require changing `compilerOptions.isCustomElement` in the consuming application.

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

Vue emits the event detail directly: `@selection-change="({ index }) => select(index)"`. Keep immutable frames in a `shallowRef` when storing them in Vue. Component refs expose `element` and `focusSearch()` through `BeMusicVueElementRef`.

## Styling and composition

The elements are headless. Their shadow styles cover layout, sizing, scrolling and container queries only, and set no colour, border, background or font family. The look comes from three places, from broadest to narrowest:

1. **A theme**: style sheets every element adopts into its shadow root after its own styles. Pass one when registering: `defineBeMusicElements(registry, { theme })`. `@be-music/player-ui/themes/basecoat` exports `basecoatTheme`, which is Basecoat plus the elements' colours, borders and backgrounds from the page's Basecoat tokens (`--background`, `--foreground`, `--primary`, `--muted-foreground`, `--card`, `--border`, `--radius`, and the rest). A theme of your own may select parts inside the shadow root (`[part~='panel']`). Without a theme the elements render with browser defaults. A later call without `theme` keeps the one set, and a theme applies when an element first renders.
2. **Custom properties**, inherited from any ancestor (table below).
3. **Parts and slots**, styled or filled from outside.

```ts
import { defineBeMusicElements } from '@be-music/player-ui';
import { basecoatTheme } from '@be-music/player-ui/themes/basecoat';

defineBeMusicElements(customElements, { theme: basecoatTheme });
```

The React and Vue wrappers register without a theme; call `defineBeMusicElements` with one before they mount.

| Property                                           | Default                    | Sets                                                      |
| -------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| `--be-music-gap`                                   | `8px`                      | Gaps inside an element (rows, controls, figures)          |
| `--be-music-panel-padding`                         | `12px`                     | A panel's padding (the gameplay HUD uses `8px`)           |
| `--be-music-section-gap`                           | `24px`                     | Gaps between a screen's sections                          |
| `--be-music-screen-padding`                        | `24px`                     | A screen's padding                                        |
| `--be-music-center-width`                          | `56rem`                    | Widest the decide and result columns grow                 |
| `--be-music-title-size` / `-weight` / `-tracking`  | `1.75rem` / `600` / normal | A screen's title                                          |
| `--be-music-stat-size`                             | `2.25rem`                  | The result's EX score                                     |
| `--be-music-graph-height`                          | `44px`                     | Gauge and timing graphs (the result's gauge takes `72px`) |
| `--be-music-row-kind-width`                        | `3.5ch`                    | The chart list's level column                             |
| `--be-music-list-height`                           | `55vh`                     | The chart list's height outside a screen                  |
| `--be-music-score-size`                            | `1.8em`                    | A compact score's value                                   |
| `--be-music-letterbox-background` / `--background` | `#09090b`                  | The playfield's letterbox band and stage                  |
| `--be-music-timing-color`                          | `#ffa8b3`                  | The timing graph's line                                   |

Layout follows each element's own width. Every element is an inline-size container named `be-music`; a screen renames it `be-music-screen`. Below 40rem, a collection's columns stack, its search takes the full width and its chart list caps at 18rem. Above that, the list fills the column beside the chart details, and the list column stays wider than the details. Below 30rem, a result panel stacks its verdict over its figures. Below 22rem, a judgment table hides its Early and Late columns, playback controls hide the volume slider, a preview chart row places the level and genre under the title, and a landscape gameplay HUD tightens its actions and detail cards. Below 16rem, a compact score puts its value on its own line. Play options fill as many even columns as fit. The `compact` property stays explicit. Gameplay and preview stages still size themselves with `cqw` and `cqh`, and portrait play layout follows the stage orientation.

Screens expose `screen`, `header`, `eyebrow` and `title` parts; the collection also `search`, `folder`, `columns`, `list`, `row`, `details-panel` and `chart-title`, the decide screen `progress` and `actions`, and the result `players`, `panel`, `stat`, `actions`, `gauge-panel` and `gauge-graph`. The gameplay HUD exposes `hud`, `heading`, `primary`, `actions`, `details`, `chart-panel`, `score-summary`, `score-value`, `score-panel`, `judgment-panel`, `judgment-table`, `gauge-meter`, `gauge-panel`, `gauge-graph`, `timing-panel`, `timing-graph` and `settings-panel` parts, and a `paused` part while paused. With its `cabinet` property set (Native sets it), a landscape play in the standard layout is laid out as the skin SDK's cabinet layout (`resolveCabinetLayout`) instead: the keys, gauge, score and hi-speed under the lanes, the score graph beside them, and the stage band (with the actions and an Info button that opens the play information over the BGA), the players, the judgement panel, the BPM and the tempo on the right. A double-play chart is centred, with the chart and judgement panel on the left, the gauge's value between the banks of keys (`center`) and the buttons in a band beside the menu corner (`controls`). It exposes `play`, `progress`, `keys`, `score`, `hi-speed`, `graph-header`, `graph`, `graph-footer`, `stage`, `controls`, `center`, `players`, `difficulty`, `second-player`, `judge`, `bpm` and `tempo` parts. Leaf panels expose their own `panel` and applicable `table` / `graph` / `meter` / `value` parts; chart list rows also `row-kind`. The collection, decide and result screens take an `eyebrow` slot over their title (the decide and result screens show "Up next" and "Play result" without one), and the collection a `title` slot. Gameplay and chart details have an `actions` slot and a default slot. Other screens have a default slot.

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

**What belongs where.** A component keeps what makes it work at any size: its layout, its breakpoints and the spacing lengths above. A theme keeps colour, borders, backgrounds and fonts. A skin or application keeps its own scale and voice: Native sets its spacing and title type through these properties and `::part` rules, and its product line through the `eyebrow` slot ([ADR 0020](../../docs/adr/0020-headless-player-ui.md)).

## Lifecycle and rendering

Imports do not register Be-Music tags. On an SSR server the wrappers render host elements; properties and inner content are supplied on the client. Full component SSR and hydration are outside this implementation.

Removing and reconnecting an element preserves its state. The owner removes scene subscriptions and disposes the player separately. Native's adapter removes its request listeners on disposal and caps ordinary gameplay property updates to roughly 12 per second while forwarding stage, orientation and view changes immediately. Lit batches rendering; gauge and timing graphs cap their sample counts. The playfield is updated on every animation frame and repaints only each element's own canvas.

See [ADR 0013](../../docs/adr/0013-player-ui-components.md) for the dependency and registration decisions.
