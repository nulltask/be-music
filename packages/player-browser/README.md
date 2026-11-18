[Japanese version](./README.ja.md)

# @be-music/player-browser

This package runs Be-Music in the browser with PixiJS. The host API creates scene sessions for Music Select, Decide, Play, and Result. Each screen uses a built-in, LR2, or beatoraja view. The package also handles audio, chart collections, skin loading, and gameplay recording. [Application integration in `@be-music/app-play`](../app-play/README.md)

See the [Browser player implementation notes](../../docs/player-web.md).

## Entries

`@be-music/player-browser/host` (`PixiSceneHost`, `createSelectScene` / `createDecideScene` / `createPlayScene` / `createResultScene`), `/skin`, `/collection`, `/audio`, `/recording`, `/compute` and `/controller` (see [Entry points](../../docs/player-web.md#entry-points)).

## Features

- Chart library for dropped folders, ZIPs, and drops that combine charts with LR2 or beatoraja themes
- Lazy browser asset loading for large audio/video files, with case-insensitive path lookup
- Built-in Be-Music Skins (Synesthesia by default, Plain, and Native (DOM + Canvas)) for select, gameplay, and result, and for a decide screen when the skin declares one
- Touch play and a touch gameplay layout on touch-first devices, portrait stages for skins that provide one, and per-skin settings
- LR2 select / decide / gameplay / result skin parsing and rendering on PixiJS
- beatoraja select / decide / gameplay / result skin parsing and rendering on PixiJS
- One scene session per screen holds its behaviour (browsing, chart preparation, engine, input, sound, endings) for every family; the built-in, LR2 and beatoraja family views only draw it and return intents (see [Scene sessions and family views](../../docs/player-web-scenes.md#scene-sessions-and-family-views))
- Shared LR2 Pixi helpers for destination interpolation, sprite transforms, numbers, text, sliders, and bargraphs
- Shared beatoraja Pixi helpers for destination sampling, source-cell selection, text, values, sliders, gauges, graphs, timing visualizers, notes, markers, BGA, and runtime op/timer wiring
- Shared playback semantics with the terminal player for notes, timing, scroll distance, BGA cues, score, and results
- One audio service on one system `AudioContext` for the select BGM, cues, jingles, chart preview and skin sounds, and a WebAudio bus per play with split key/BGM/master compressor controls
- BGA still/video rendering, browser-side video transcode fallback, and MP4 / WebM gameplay recording
- Single PixiJS scene host that owns one renderer context and shows one scene at a time; the player's scene router owns every transition and disposes the scene that left
- In-scene LR2 and beatoraja PLAY OPTION controls for hi-speed, BGA mode/size, filters, sort, HS-FIX, lane cover, lift, auto-scratch, DP flip, random/mirror modes, gauge variants, and skin options
