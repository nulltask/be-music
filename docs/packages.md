[Japanese version](./packages.ja.md)

# Package naming

Package names describe their role. Libraries use domain or runtime names; applications use `app-`, deployment wrappers use `worker-`, shared service integrations use `service-`, and shared utilities use `shared-`. Package directories match the unscoped names. Cloudflare Worker names, domains, database names, bucket names, and executable names are independent and remain unchanged.

## Player package responsibilities

Player packages separate runtime and presentation responsibilities.

| Package                             | Responsibility                                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player-engine`                     | Judgment, the play loop, and audio/input/UI host contracts. Hosts supply the audio implementation.                                                                     |
| `player-node-audio`                 | Node audio sessions and PCM output; owns decoding through `chart-audio-renderer`.                                                                                      |
| `player-skin-sdk`                   | Canvas and DOM skin contracts without Lit, React or Vue dependencies.                                                                                                  |
| `player-ui`                         | Lit Web Components connected through presentation data and request events.                                                                                             |
| `player-ui-react` / `player-ui-vue` | Typed framework wrappers around the same Web Components.                                                                                                               |
| `player-browser`                    | Browser audio, Canvas/DOM views, scene sessions and hosting. `./controller` exposes renderer-independent collection browsing; `./compute` exposes the CPU worker pool. |

See [audio adapters](./player-spec.md#node-audio-adapter), [skin authoring](./be-music-skin.md), [Player UI](../packages/player-ui/README.md), and [shared utilities](./shared-utils.md).
