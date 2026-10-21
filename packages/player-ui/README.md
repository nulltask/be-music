[Japanese version](./README.ja.md)

# Player UI

Reusable Lit Web Components for Be-Music. The components receive presentation data through JavaScript properties and emit semantic requests as bubbling, composed `CustomEvent`s. They own no engine, clock, audio context or subscriptions. Native Skin uses the same components through its DOM skin adapter.

## Packages

| Package                     | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `@be-music/player-ui`       | Web Components, presentation types and explicit registration |
| `@be-music/player-ui-react` | Typed React components, event callbacks and element refs     |
| `@be-music/player-ui-vue`   | Typed Vue components, emits and element refs                 |

React and Vue are peer dependencies of their respective wrappers. The skin SDK has no Lit, React or Vue dependency.

## Components

| Element                   | Properties                                   |
| ------------------------- | -------------------------------------------- |
| `be-music-score-summary`  | `data: BeMusicScoreData`, optional `compact` |
| `be-music-judgment-table` | `data: BeMusicJudgmentData`                  |
| `be-music-gauge-panel`    | `data: BeMusicGaugeData`, optional `compact` |
| `be-music-timing-graph`   | `data: BeMusicTimingData`                    |
| `be-music-play-settings`  | `data: BeMusicSettingsData`                  |
| `be-music-chart-list`     | `entries`, `selectedIndex`, `disabled`       |
| `be-music-chart-details`  | `entry`, `launching`, `readText`             |
| `be-music-play-options`   | `options`, `choices`, `disabled`             |
| `be-music-select-screen`  | `frame: BeMusicDOMSelectFrame`               |
| `be-music-gameplay-hud`   | `frame: BeMusicDOMGameplayFrame`             |
| `be-music-result-screen`  | `frame: BeMusicDOMResultFrame`               |
| `be-music-decide-screen`  | `frame: BeMusicDOMDecideFrame`               |

Each class is exported as `BeMusic…Element`. Wrappers export the same names without `Element`, for example `BeMusicGameplayHUD` and `BeMusicJudgmentTable`. Leaf components take only their own presentation data and can be arranged independently. Screen components compose those leaves and accept the existing DOM skin frames.

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

The elements use shadow roots. Theme tokens inherit across them: `--be-music-color-text`, `--be-music-color-muted`, `--be-music-color-background`, `--be-music-color-accent`, `--be-music-panel-background`, `--be-music-control-background`, `--be-music-focus-color`, `--be-music-timing-color`, `--be-music-font`, and `--be-music-radius`.

The gameplay HUD exposes `hud`, `heading`, `primary`, `actions`, `details`, `score-summary`, `score-value`, `score-panel`, `judgment-panel`, `judgment-table`, `gauge-meter`, `gauge-panel`, `gauge-graph`, `timing-panel`, `timing-graph` and `settings-panel` parts. Leaf panels expose their own `panel` and applicable `table` / `graph` / `meter` / `value` parts. Gameplay and chart details have an `actions` slot and a default slot. Other screens have a default slot.

```css
be-music-gameplay-hud {
  --be-music-color-accent: #a8e6ce;
  --be-music-font: system-ui, sans-serif;
}
be-music-gameplay-hud::part(judgment-table) {
  font-size: 12px;
}
```

## Lifecycle and rendering

Imports do not register Be-Music tags. On an SSR server the wrappers render host elements; properties and inner content are supplied on the client. Full component SSR and hydration are outside this implementation.

Removing and reconnecting an element preserves its state. The owner removes scene subscriptions and disposes the player separately. Native's adapter removes its request listeners on disposal and caps ordinary gameplay property updates to roughly 12 per second while forwarding stage, orientation and view changes immediately. Lit batches rendering; gauge and timing graphs cap their sample counts. Canvas remains on the existing play loop.

See [ADR 0013](../../docs/adr/0013-player-ui-components.md) for the dependency and registration decisions.
