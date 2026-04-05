[Japanese version](./bemuse-spec.ja.md)

# Bemuse implementation specifications

This document defines how `packages/parser` / `packages/stringifier` / `packages/player` handles the Bemuse format (Music Server + assets package).

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

- Compatibility level: Not supported
- Policy: Treat bemuse as a "distribution container" rather than a "musical score format"
- Conversion policy: `sourceFormat` of `@be-music/json` maintains `bms` / `bmson`, bemuse is absorbed in the input resolution layer

## Format overview

- Music Server index: `index.json`
- Song metadata: `bemuse-song.json` (or `songs[]` in `index.json`)
- Asset index: `assets/metadata.json`
- Asset chunk: `*.bemuse`

## `assets/metadata.json` structure

```json
{
  "files": [
    { "name": "snare.ogg", "ref": [2, 1415370, 1430427] }
  ],
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

| Discussion points | Official docs | Official code | Adoption in this repository |
| --- | --- | --- | --- |
| Header 4byte | All `0x00` | Read as `metadataLength` | Interpret as `UInt32LE metadataLength` and do not assume 0 fixation |
| `refs[].size` | Field included | Unused in type | Accepted as an optional item |
| Image/video file | Not specified | With fallback pattern (`png/jpg/webm/mp4/m4v`) | keysound prioritizes package, image/video allows fallback |

## Compatibility checklist

### parser (bemuse -> `@be-music/json`)

- [ ] Accept `index.json` (`MusicServerIndex`) and enumerate `songs[]`
- [ ] Keep `songs[].id` / `songs[].path` and normalize `/` at the end of `path`
- [ ] Resolve music file URL/path from `song.path` + `charts[].file`
- [ ] `bemuse-song.json` Accept single input
- [ ] `?server=<url>` resolves by auto-completion when `index.json` is omitted.
- [ ] Resolve `?server=<url/to/bemuse-song.json>` as single-song server
- [ ] Resolve `undefined/null/string` in `bemusepack_url` according to rules.
- [ ] Solved by decomposing `bemusepack_url` string into `assetsBase` and `metadataFilename`
- [ ] Read `assets/metadata.json` and refer to `files[].name` case-insensitively
- [ ] Verify `BEMUSEPACK` / `metadataLength` of `*.bemuse`
- [ ] Extract payload range with `ref = [index,start,end]`
- [ ] Invalid reference (outside index range, `start > end`, out of payload range) is treated as an error.
- [ ] Retains extended items of `SongMetadata` (`replaygain`, `preview_start`, `preview_url`, `video_url`, `video_offset`, `readme`, `chart_names`)
- [ ] Retains additional information of `charts[]` (`md5`, `noteCount`, `bpm`, `duration`, `keys`, `scratch`, `bga`)
- [ ] Delegate the obtained music score string to the existing `parseBms` / `parseBmson`

### stringifier (`@be-music/json` -> bemuse assets)

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

### player / audio-renderer

- [ ] Accept `index.json` / `bemuse-song.json` as input
- [ ] keysound resolved from `assets/metadata.json` + `*.bemuse`
- [ ] Images/videos that are not included in the package fallback to base resources
- [ ] Apply caching strategy using `refs[].hash` as key
- [ ] Fixed target extension of image/video fallback to `png|jpg|webm|mp4|m4v`
- [ ] `preview_url` Resolved default value `_bemuse_preview.mp3` when not specified.
- [ ] Apply rule that `video_url` overwrites `video_file`
- [ ] Reflect `video_offset` to the video playback start position

## MVP Acceptance Criteria

- You can read a local single song folder (`bemuse-song.json` + `assets/*` + `.bms/.bmson`) with `parse`.
- keysound can be extracted from bemuse package and played with `player --auto` / `audio-render`
- Returns an explainable error with corrupted chunks (magic invalid, range invalid)