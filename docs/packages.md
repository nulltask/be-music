[Japanese version](./packages.ja.md)

# Package naming

Package names describe their role. Libraries use domain or runtime names; applications use `app-`, deployment wrappers use `worker-`, shared service integrations use `service-`, and shared utilities use `shared-`. Package directories match the unscoped names. Cloudflare Worker names, domains, database names, bucket names, and executable names are independent and remain unchanged.

## Names

| Former package              | Current package                  |
| --------------------------- | -------------------------------- |
| `@be-music/json`            | `@be-music/chart-source`         |
| `@be-music/chart`           | `@be-music/chart-model`          |
| `@be-music/parser`          | `@be-music/chart-parser`         |
| `@be-music/stringifier`     | `@be-music/chart-writer`         |
| `@be-music/player`          | `@be-music/player-engine`        |
| `@be-music/player-web`      | `@be-music/player-browser`       |
| `@be-music/player-tui`      | `@be-music/player-terminal`      |
| `@be-music/player-web-demo` | `@be-music/app-play`             |
| `@be-music/play`            | `@be-music/worker-play`          |
| `@be-music/leaderboard-api` | `@be-music/app-leaderboard`      |
| `@be-music/accounts`        | `@be-music/app-accounts`         |
| `@be-music/dashboard`       | `@be-music/app-dashboard`        |
| `@be-music/editor`          | `@be-music/chart-editor`         |
| `@be-music/audio-renderer`  | `@be-music/chart-audio-renderer` |
| `@be-music/scene-model`     | `@be-music/player-scene-model`   |
| `@be-music/skin-sdk`        | `@be-music/player-skin-sdk`      |
| `@be-music/lr2-skin`        | `@be-music/skin-lr2`             |
| `@be-music/beatoraja-skin`  | `@be-music/skin-beatoraja`       |
| `@be-music/auth-client`     | `@be-music/service-auth-client`  |
| `@be-music/web-theme`       | `@be-music/service-web-theme`    |
| `@be-music/utils`           | `@be-music/shared-utils`         |

Update imports, package-manager filters, and source paths to the current names. Former package aliases are not provided.

## Player package responsibilities

The added packages separate runtime and presentation responsibilities; they are not aliases for former packages.

| Package                             | Responsibility                                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player-engine`                     | Judgment, the play loop, and audio/input/UI host contracts. Hosts supply the audio implementation.                                                                     |
| `player-node-audio`                 | Node audio sessions and PCM output; owns decoding through `chart-audio-renderer`.                                                                                      |
| `player-skin-sdk`                   | Canvas and DOM skin contracts without Lit, React or Vue dependencies.                                                                                                  |
| `player-ui`                         | Lit Web Components connected through presentation data and request events.                                                                                             |
| `player-ui-react` / `player-ui-vue` | Typed framework wrappers around the same Web Components.                                                                                                               |
| `player-browser`                    | Browser audio, Canvas/DOM views, scene sessions and hosting. `./controller` exposes renderer-independent collection browsing; `./compute` exposes the CPU worker pool. |

See [audio adapters](./player-spec.md#node-audio-adapter), [skin authoring](./be-music-skin.md), [Player UI](../packages/player-ui/README.md), and [shared utilities](./shared-utils.md).

## Historical releases

GitHub Release titles and descriptions use the current package names. A note identifies the former name under which each historical version was published. Original Git tags, release URLs, and downloadable assets remain unchanged. Renaming the source packages does not republish historical npm versions under the current names.
