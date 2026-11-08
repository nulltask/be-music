[Japanese version](./README.ja.md)

# @be-music/app-play

The private Vite player application that wires folder/ZIP drops, LR2/beatoraja themes, the Options dialog and browser playback together, as services behind one scene router. The runtime it builds on is [`@be-music/player-browser`](../player-browser/README.md), which lists the player's features.

See the [Browser player implementation notes](../../docs/player-web.md).

## Usage

Start the player from the repository root:

```bash
pnpm run player:web
```

The player starts a Vite dev server. Drop a BMS/bmson song folder, an LR2 theme folder, a beatoraja theme folder, a ZIP, or a song folder and LR2/beatoraja theme folder together into the browser.

The player can also load archives from a URL: `?music=<zip URL>&skin=<zip URL>` (either parameter may be omitted) feeds the archives into the same pipeline as a drop. Cross-origin `https` URLs are fetched through the same-origin proxy route `/__url-load-proxy`, served by the Vite dev server and by the Cloudflare Worker.

Browser controls follow the selected skin family and key configuration; see [Browser player controls](../../docs/player-web.md#options-dialog).

## Deployment

The Player Worker [`@be-music/worker-play`](../worker-play/README.md) serves this player's build. When the pinned `@ffmpeg/core` changes, upload the core to R2:

```bash
pnpm --filter @be-music/app-play run cf:r2:push
```

`build:cf` builds the player for the Worker, leaving the ffmpeg core out of Static Assets.
