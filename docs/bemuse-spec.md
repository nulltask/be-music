[Japanese version](./bemuse-spec.ja.md)

# Bemuse implementation specifications

This document defines how `packages/chart-parser` / `packages/chart-writer` / `packages/player-engine` handles the Bemuse format (Music Server + assets package).

## Primary reference

- Official documentation: The `.bemuse` File Format
  https://bemuse.ninja/project/docs/bemusepack/
- Official Document: Music Server
  https://bemuse.ninja/project/docs/music-server/
- Official Document: Preparing BMS Song for Online Play in Bemuse [new method]
  https://bemuse.ninja/project/docs/song-workshop/
- Official implementation (`*.bemuse` export): `bemuse-packer.js`
  https://github.com/bemusic/bemuse/blob/master/packages/bemuse-tools/src/bemuse-packer.js
- Official implementation (`*.bemuse` reading): `bemuse-package.ts`
  https://github.com/bemusic/bemuse/blob/master/bemuse/src/resources/bemuse-package.ts
- Official implementation (`bemusepack_url` resolved): `getSongResources.ts`
  https://github.com/bemusic/bemuse/blob/master/bemuse/src/music-collection/getSongResources.ts
- Official type definition (`index.json` / song metadata): `bemuse-types`
  https://github.com/bemusic/bemuse/blob/master/packages/bemuse-types/index.d.ts

## Compliance status summary

- Compatibility level: Partially supported (the web player reads Bemuse music servers; the parser, CLI and writer do not)
- Policy: Treat bemuse as a "distribution container" rather than a "musical score format"
- Conversion policy: `sourceFormat` of `@be-music/chart-source` maintains `bms` / `bmson`, bemuse is absorbed in the input resolution layer

## Web player (`@be-music/app-play`)

Options → Library & records → Bemuse music servers registers server URLs. Until the player changes the list, it holds the public servers (`DEFAULT_BEMUSE_SERVER_URLS`): Bemuse's official server (`music4.bemuse.ninja/server`) and the servers Bemuse's documentation and server list ([bemuse-meta `servers.yml`](https://github.com/bemusic/bemuse-meta/blob/master/servers.yml)) link that still serve songs — `flicknote.bemuse.ninja`, METTATUNES and The Forgetalia on `bmson.nekokan.dyndns.info` (read through the proxy: they send no CORS header) and `yuinore.net/bms`. "Add default servers" registers the ones a list lacks. The URLs are stored in `localStorage` (`be-music.bemuse-server-urls`), carried to the player's other browsers with the Options settings (`bemuseServerURLs`), and loaded each time the player opens. A server URL resolves to its index as Bemuse resolves `?server=` (`bemuseServerIndexURL`).

- Each server becomes a library folder `Bemuse <host/path>/<song folder>/…` of deferred files (`services/bemuse-servers.ts`). Listing fetches `index.json`, each song's `assets/metadata.json` and its chart files.
- Chart files are kept in Cache Storage (`be-music-bemuse-charts`) and used again only while their bytes have the `charts[].md5` the index lists, so opening the player again fetches the indexes but not the charts.
- A packed sound file is cut out of its `*.bemuse` chunk when a play opens it. Recent chunk payloads are kept (32 chunks); the file bytes themselves are not.
- Files outside the package follow Bemuse: a packaged song serves only names matching `fallbackPattern` (`/\.(?:png|jpg|webm|mp4|m4v)/`) beside its package, and a song with `bemusepack_url: null` serves every file, a sound under the names `SamplesLoader` tries (`.ogg`, `.m4a`, `.flac`, `.mp3`, then the name). The files a chart names are read from its text (`scanChartFileReferences`), since a server cannot list its files.
- A request the browser blocks (no CORS header) is sent again through the player's proxy (`/__url-load-proxy`), and once the proxy reaches the server, later requests to that origin go there directly (`services/bemuse-fetch.ts`). Those origins are stored in `localStorage` (`be-music.bemuse-proxied-origins`, the latest 64), and the nekokan servers' origin (`KNOWN_PROXIED_BEMUSE_ORIGINS`) goes to the proxy from the first visit, so the browser logs a CORS error at most once for an origin rather than on every visit.

What the index says about a song beyond its charts goes onto the parsed charts (`applyBemuseSongExtras`), filling only what a chart leaves out. None of it is part of the chart fingerprint (BGA, video, preview and volume are excluded), and the chart files stay as served, so their hashes and records are those of the same chart read from disk.

| Field                                         | Bemuse                                                                                          | Be-Music                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `preview_url` (default `_bemuse_preview.mp3`) | Plays on the song list; none for a tutorial                                                     | The preview of a chart without `#PREVIEW` / `preview_music`. The default file is used only when a HEAD request finds it.       |
| `video_url` / `video_file`, `video_offset`    | Plays the video from its start at chart second `video_offset`; never shows a chart's BGA images | A BGA cue at that second, added only when the chart has no BGA the song serves (Be-Music shows a chart's own BGA when it can). |
| `eyecatch_image_url`                          | Shown while the song loads                                                                      | The chart's `#STAGEFILE` when it has none                                                                                      |
| `back_image_url`                              | Shown behind the play                                                                           | The chart's `#BACKBMP` when it has none                                                                                        |
| `replaygain`                                  | Sound volume `10^((gain + 4) / 20)`, `-12.2 dB` when missing or not `"<n> dB"`                  | The same gain, multiplied into the chart's `#VOLWAV` gain (kept inside `0 < n < 200`)                                          |
| `preview_start`                               | Not used by the player (used when the preview file is made)                                     | Not used                                                                                                                       |

## Format overview

- Music Server index: `index.json`
- Song metadata: `bemuse-song.json` (or `songs[]` in `index.json`)
- Asset index: `assets/metadata.json`
- Asset chunk: `*.bemuse`

## `assets/metadata.json` structure

```json
{
  "files": [{ "name": "snare.ogg", "ref": [2, 1415370, 1430427] }],
  "refs": [
    {
      "path": "ogg.3.8ed2dece.bemuse",
      "hash": "8ed2dece0eef7cd65195d7ef6a72708d",
      "size": 1430441
    }
  ]
}
```

- `files[].ref = [index, start, end]`
- `index`: refer to chunk of `refs[index]`
- `start`, `end`: Byte range for chunk payload (`[start, end)`)
- Resolve file names case-insensitively when loading (official implementation is `toLowerCase()` map)
- `refs[].size` is provided in the official docs, but is not required in the official loading implementation

## `*.bemuse` structure

- First 10 bytes: ASCII `BEMUSEPACK`
- Next 4 bytes: `metadataLength` (UInt32LE)
- followed by `metadataLength` byte: metadata area (empty in current tool output)
- Remaining: payload (concatenated binary)

Extraction formula:

- `payloadOffset = 14 + metadataLength`
- `fileBytes = chunk.slice(payloadOffset + start, payloadOffset + end)`

## `bemusepack_url` resolution rule

- `bemusepack_url === undefined`: Use `assets/metadata.json`
- `bemusepack_url === null`: Disable bemuse package and read the actual file directly
- `bemusepack_url` is a string: Relative resolution from song base URL is used.

## Differences between primary sources and adoption rules

| Discussion points | Official docs  | Official code                                  | Adoption in this repository                                         |
| ----------------- | -------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| Header 4byte      | All `0x00`     | Read as `metadataLength`                       | Interpret as `UInt32LE metadataLength` and do not assume 0 fixation |
| `refs[].size`     | Field included | Unused in type                                 | Accepted as an optional item                                        |
| Image/video file  | Not specified  | With fallback pattern (`png/jpg/webm/mp4/m4v`) | keysound prioritizes package, image/video allows fallback           |

## Compatibility checklist

### parser (bemuse -> `@be-music/chart-source`)

- [ ] Accept `index.json` (`MusicServerIndex`) and enumerate `songs[]`
- [ ] Keep `songs[].id` / `songs[].path` and normalize `/` at the end of `path`
- [ ] Resolve music file URL/path from `song.path` + `charts[].file`
- [ ] `bemuse-song.json` Accept single input
- [ ] `?server=<url>` resolves by auto-completion when `index.json` is omitted.
- [ ] Resolve `?server=<url/to/bemuse-song.json>` as single-song server
- [x] Resolve `undefined/null/string` in `bemusepack_url` according to rules. (web player)
- [ ] Solved by decomposing `bemusepack_url` string into `assetsBase` and `metadataFilename`
- [ ] Read `assets/metadata.json` and refer to `files[].name` case-insensitively
- [ ] Verify `BEMUSEPACK` / `metadataLength` of `*.bemuse`
- [ ] Extract payload range with `ref = [index,start,end]`
- [ ] Invalid reference (outside index range, `start > end`, out of payload range) is treated as an error.
- [ ] Retains extended items of `SongMetadata` (`replaygain`, `preview_start`, `preview_url`, `video_url`, `video_offset`, `readme`, `chart_names`)
- [ ] Retains additional information of `charts[]` (`md5`, `noteCount`, `bpm`, `duration`, `keys`, `scratch`, `bga`)
- [ ] Delegate the obtained music score string to the existing `parseBMS` / `parseBmson`

### chart-writer (`@be-music/chart-source` -> bemuse assets)

- [ ] Collect audio files referenced in `resources.wav`
- [ ] Apply the upper limit of chunk division to `1,474,560` byte (`max` in official implementation)
- [ ] Pack files in descending size order
- [ ] Generate `[start,end)` of `files[].ref` in payload concatenation order
- [ ] Output chunk name in `<group>.<seq>.<md5-8>.bemuse` format
- [ ] Output `refs[].hash` in MD5 of payload
- [ ] Fixed the output policy (omission/output) of `refs[].size` as per the implementation policy.
- [ ] Export binary with `BEMUSEPACK` + `metadataLength` + payload
- [ ] Policy on whether or not non-empty `metadata` blocks (`metadataLength > 0`) can be written
- [ ] Simultaneously output `assets/metadata.json`
- [ ] Supports `bemuse-song.json` / `index.json` generation (single-song / multi-song server)

### player / chart-audio-renderer

- [x] Accept `index.json` / `bemuse-song.json` as input (web player)
- [x] keysound resolved from `assets/metadata.json` + `*.bemuse` (web player)
- [x] Images/videos that are not included in the package fallback to base resources (web player)
- [ ] Apply caching strategy using `refs[].hash` as key
- [x] Fixed target extension of image/video fallback to `png|jpg|webm|mp4|m4v` (web player)
- [x] `preview_url` Resolved default value `_bemuse_preview.mp3` when not specified. (web player)
- [x] Apply rule that `video_url` overwrites `video_file` (web player)
- [x] Reflect `video_offset` to the video playback start position (web player)

## MVP Acceptance Criteria

- You can read a local single song folder (`bemuse-song.json` + `assets/*` + `.bms/.bmson`) with `parse`.
- keysound can be extracted from bemuse package and played with `player --auto` / `audio-render`
- Returns an explainable error with corrupted chunks (magic invalid, range invalid)
