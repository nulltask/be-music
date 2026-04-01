# Bemuse 実装仕様

この文書は、`packages/parser` / `packages/stringifier` / `packages/player` が Bemuse 形式（Music Server + assets package）をどう扱うかを定義します。

## 一次参照

- 公式ドキュメント: The `.bemuse` File Format  
  https://bemuse.ninja/project/docs/bemusepack/
- 公式ドキュメント: Music Server  
  https://bemuse.ninja/project/docs/music-server/
- 公式ドキュメント: Preparing BMS Song for Online Play in Bemuse [new method]  
  https://bemuse.ninja/project/docs/song-workshop/
- 公式実装 (`*.bemuse` 書き出し): `bemuse-packer.js`  
  https://github.com/bemusic/bemuse/blob/master/packages/bemuse-tools/src/bemuse-packer.js
- 公式実装 (`*.bemuse` 読み込み): `bemuse-package.ts`  
  https://github.com/bemusic/bemuse/blob/master/bemuse/src/resources/bemuse-package.ts
- 公式実装 (`bemusepack_url` 解決): `getSongResources.ts`  
  https://github.com/bemusic/bemuse/blob/master/bemuse/src/music-collection/getSongResources.ts
- 公式型定義 (`index.json` / song metadata): `bemuse-types`  
  https://github.com/bemusic/bemuse/blob/master/packages/bemuse-types/index.d.ts

## 対応状況の要約

- 対応レベル: 未対応
- 方針: bemuse を「譜面形式」ではなく「配布コンテナ」として扱う
- 変換方針: `@be-music/json` の `sourceFormat` は `bms` / `bmson` を維持し、bemuse は入力解決レイヤで吸収する

## 形式概要

- Music Server index: `index.json`
- Song metadata: `bemuse-song.json`（または `index.json` 内の `songs[]`）
- Asset index: `assets/metadata.json`
- Asset chunk: `*.bemuse`

## `assets/metadata.json` 構造

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
- `index`: `refs[index]` のチャンクを参照
- `start`, `end`: チャンク payload に対するバイト範囲 (`[start, end)`)
- 読み込み時はファイル名を大小文字非区別で解決する（公式実装は `toLowerCase()` マップ）
- `refs[].size` は公式 docs では提示されるが、公式読み込み実装では必須ではない

## `*.bemuse` 構造

- 先頭 10 byte: ASCII `BEMUSEPACK`
- 続く 4 byte: `metadataLength` (UInt32LE)
- 続く `metadataLength` byte: メタデータ領域（現行ツール出力では空）
- 残り: payload（連結バイナリ）

抽出式:

- `payloadOffset = 14 + metadataLength`
- `fileBytes = chunk.slice(payloadOffset + start, payloadOffset + end)`

## `bemusepack_url` 解決ルール

- `bemusepack_url === undefined`: `assets/metadata.json` を使う
- `bemusepack_url === null`: bemuse package を無効化し、実ファイルを直接読む
- `bemusepack_url` が文字列: song base URL から相対解決して使う

## 一次資料間の差分と採用ルール

| 論点 | 公式 docs | 公式コード | このリポジトリでの採用 |
| --- | --- | --- | --- |
| ヘッダ 4byte | すべて `0x00` | `metadataLength` として読み取り | `UInt32LE metadataLength` として解釈し、0固定を前提にしない |
| `refs[].size` | フィールドあり | 型上は未使用 | 任意項目として受理 |
| 画像/動画ファイル | 明示なし | fallback パターンあり (`png/jpg/webm/mp4/m4v`) | keysound は package 優先、画像/動画は fallback を許可 |

## 対応チェックリスト

### parser (bemuse -> `@be-music/json`)

- [ ] `index.json` (`MusicServerIndex`) を受理し、`songs[]` を列挙
- [ ] `songs[].id` / `songs[].path` を保持し、`path` 末尾 `/` を正規化
- [ ] `song.path` + `charts[].file` から譜面ファイル URL/パスを解決
- [ ] `bemuse-song.json` 単体入力を受理
- [ ] `?server=<url>` で `index.json` 省略時に自動補完して解決
- [ ] `?server=<url/to/bemuse-song.json>` を single-song server として解決
- [ ] `bemusepack_url` の `undefined/null/string` を規則通りに解決
- [ ] `bemusepack_url` 文字列を `assetsBase` と `metadataFilename` に分解して解決
- [ ] `assets/metadata.json` を読み、`files[].name` を大小文字非区別で参照
- [ ] `*.bemuse` の `BEMUSEPACK` / `metadataLength` を検証
- [ ] `ref = [index,start,end]` で payload 範囲を抽出
- [ ] 参照不正（index 範囲外、`start > end`、payload 範囲外）をエラー化
- [ ] `SongMetadata` の拡張項目（`replaygain`, `preview_start`, `preview_url`, `video_url`, `video_offset`, `readme`, `chart_names`）を保持
- [ ] `charts[]` の付帯情報（`md5`, `noteCount`, `bpm`, `duration`, `keys`, `scratch`, `bga`）を保持
- [ ] 取得した譜面文字列を既存 `parseBms` / `parseBmson` に委譲

### stringifier (`@be-music/json` -> bemuse assets)

- [ ] `resources.wav` で参照される音声ファイルを収集
- [ ] チャンク分割の上限を `1,474,560` byte（公式実装の `max`）で適用
- [ ] ファイルをサイズ降順で詰める
- [ ] `files[].ref` の `[start,end)` を payload 連結順で生成
- [ ] チャンク名を `<group>.<seq>.<md5-8>.bemuse` 形式で出力
- [ ] `refs[].hash` を payload の MD5 で出力
- [ ] `refs[].size` の出力方針（省略/出力）を実装方針どおり固定
- [ ] `BEMUSEPACK` + `metadataLength` + payload でバイナリを書き出す
- [ ] 非空 `metadata` ブロック (`metadataLength > 0`) の書き出し可否を方針化
- [ ] `assets/metadata.json` を同時出力
- [ ] `bemuse-song.json` / `index.json` の生成（single-song / multi-song server）をサポート

### player / audio-renderer

- [ ] 入力として `index.json` / `bemuse-song.json` を受理
- [ ] keysound は `assets/metadata.json` + `*.bemuse` から解決
- [ ] package 未収録の画像/動画は base resources へ fallback
- [ ] `refs[].hash` をキーにキャッシュ戦略を適用
- [ ] 画像/動画 fallback の対象拡張子を `png|jpg|webm|mp4|m4v` に固定
- [ ] `preview_url` 未指定時の既定値 `_bemuse_preview.mp3` を解決
- [ ] `video_url` が `video_file` を上書きする規則を適用
- [ ] `video_offset` を動画再生開始位置へ反映

## MVP 受け入れ基準

- ローカルの 1 曲フォルダ（`bemuse-song.json` + `assets/*` + `.bms/.bmson`）を `parse` で読み込める
- keysound を bemuse package から取り出して `player --auto` / `audio-render` で再生できる
- 破損チャンク（magic 不正、範囲不正）で説明可能なエラーを返す
