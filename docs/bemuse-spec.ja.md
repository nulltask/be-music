[English version](./bemuse-spec.md)

# Bemuse 実装仕様

この文書は、`packages/chart-parser` / `packages/chart-writer` / `packages/player-engine` が Bemuse 形式（Music Server + assets package）をどう扱うかを定義します。

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

- 対応レベル: 一部対応（Web プレイヤーが Bemuse 音楽サーバーを読める。パーサー・CLI・ライターは未対応）
- 方針: bemuse を「譜面形式」ではなく「配布コンテナ」として扱う
- 変換方針: `@be-music/chart-source` の `sourceFormat` は `bms` / `bmson` を維持し、bemuse は入力解決レイヤで吸収する

## Web プレイヤー（`@be-music/app-play`）

Options → Library & records → Bemuse music servers でサーバー URL を登録する。プレイヤーが一覧を変えるまでは、公開されているサーバー（`DEFAULT_BEMUSE_SERVER_URLS`）が入っている。Bemuse の公式サーバー（`music4.bemuse.ninja/server`）と、Bemuse のドキュメントとサーバー一覧（[bemuse-meta `servers.yml`](https://github.com/bemusic/bemuse-meta/blob/master/servers.yml)）が載せていて今も曲を配信しているサーバー、すなわち `flicknote.bemuse.ninja`、`bmson.nekokan.dyndns.info` の METTATUNES と The Forgetalia（CORS ヘッダを返さないのでプロキシ経由で読む）、`yuinore.net/bms` である。「既定のサーバーを追加」で一覧にない既定サーバーを登録し直せる。URL は `localStorage`（`be-music.bemuse-server-urls`）に保存し、Options の設定（`bemuseServerURLs`）としてプレイヤーの他のブラウザにも同期し、プレイヤーを開くたびに読み込む。サーバー URL は Bemuse が `?server=` を解決するのと同じ規則で index に解決する（`bemuseServerIndexURL`）。

- 各サーバーは遅延ファイルで組んだライブラリのフォルダ `Bemuse <host/path>/<曲フォルダ>/…` になる（`services/bemuse-servers.ts`）。一覧化で取得するのは `index.json`、各曲の `assets/metadata.json` と譜面ファイル。
- 譜面ファイルは Cache Storage（`be-music-bemuse-charts`）に保存し、index の `charts[].md5` とバイト列が一致する間だけ使い回す。2 回目以降の起動では index だけを取得し、譜面は取得しない。
- パッケージ内の音声ファイルは、プレイが開いたときに `*.bemuse` チャンクから切り出す。最近のチャンクの payload は保持する（32 チャンク）が、切り出したファイルのバイト列は保持しない。
- パッケージ外のファイルは Bemuse に従う。パッケージのある曲は `fallbackPattern`（`/\.(?:png|jpg|webm|mp4|m4v)/`）に一致する名前だけをパッケージの横から読み、`bemusepack_url: null` の曲はすべてのファイルを読む。音声は `SamplesLoader` が試す名前（`.ogg`、`.m4a`、`.flac`、`.mp3`、元の名前）で読む。サーバーはファイル一覧を出せないので、譜面が名指すファイルは譜面テキストから読む（`scanChartFileReferences`）。
- ブラウザが遮ったリクエスト（CORS ヘッダなし）はプレイヤーのプロキシ（`/__url-load-proxy`）経由で送り直し、以後そのオリジンへのリクエストは直接プロキシに送る（`services/bemuse-fetch.ts`）。

index が譜面以外に持つ曲の情報は、解析後の譜面に載せる（`applyBemuseSongExtras`）。譜面が持たないものだけを埋める。いずれも譜面フィンガープリントには含まれず（BGA・動画・プレビュー・音量は対象外）、譜面ファイルは配信されたままなので、ハッシュと記録はディスクから読んだ同じ譜面と同じになる。

| フィールド                                  | Bemuse                                                                        | Be-Music                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `preview_url`（既定 `_bemuse_preview.mp3`） | 曲一覧で再生する。チュートリアルにはない                                      | `#PREVIEW` / `preview_music` のない譜面のプレビュー。既定のファイルは HEAD で存在を確かめたときだけ使う     |
| `video_url` / `video_file`、`video_offset`  | 譜面の `video_offset` 秒から動画を頭から再生する。譜面の BGA 画像は表示しない | その秒に BGA キューを足す。曲が配信する BGA を譜面が持たないときだけ（表示できるなら譜面自身の BGA を出す） |
| `eyecatch_image_url`                        | 曲の読み込み中に表示する                                                      | 譜面に `#STAGEFILE` がなければそれにする                                                                    |
| `back_image_url`                            | プレイの背面に表示する                                                        | 譜面に `#BACKBMP` がなければそれにする                                                                      |
| `replaygain`                                | 音量 `10^((gain + 4) / 20)`。欠落や `"<n> dB"` 以外は `-12.2 dB`              | 同じゲインを譜面の `#VOLWAV` のゲインに掛ける（`0 < n < 200` の範囲に収める）                               |
| `preview_start`                             | プレイヤーでは使わない（プレビューファイルの作成時に使う）                    | 使わない                                                                                                    |

## 形式概要

- Music Server index: `index.json`
- Song metadata: `bemuse-song.json`（または `index.json` 内の `songs[]`）
- Asset index: `assets/metadata.json`
- Asset chunk: `*.bemuse`

## `assets/metadata.json` 構造

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

| 論点              | 公式 docs      | 公式コード                                     | このリポジトリでの採用                                      |
| ----------------- | -------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| ヘッダ 4byte      | すべて `0x00`  | `metadataLength` として読み取り                | `UInt32LE metadataLength` として解釈し、0固定を前提にしない |
| `refs[].size`     | フィールドあり | 型上は未使用                                   | 任意項目として受理                                          |
| 画像/動画ファイル | 明示なし       | fallback パターンあり (`png/jpg/webm/mp4/m4v`) | keysound は package 優先、画像/動画は fallback を許可       |

## 対応チェックリスト

### parser (bemuse -> `@be-music/chart-source`)

- [ ] `index.json` (`MusicServerIndex`) を受理し、`songs[]` を列挙
- [ ] `songs[].id` / `songs[].path` を保持し、`path` 末尾 `/` を正規化
- [ ] `song.path` + `charts[].file` から譜面ファイル URL/パスを解決
- [ ] `bemuse-song.json` 単体入力を受理
- [ ] `?server=<url>` で `index.json` 省略時に自動補完して解決
- [ ] `?server=<url/to/bemuse-song.json>` を single-song server として解決
- [x] `bemusepack_url` の `undefined/null/string` を規則通りに解決（Web プレイヤー）
- [ ] `bemusepack_url` 文字列を `assetsBase` と `metadataFilename` に分解して解決
- [ ] `assets/metadata.json` を読み、`files[].name` を大小文字非区別で参照
- [ ] `*.bemuse` の `BEMUSEPACK` / `metadataLength` を検証
- [ ] `ref = [index,start,end]` で payload 範囲を抽出
- [ ] 参照不正（index 範囲外、`start > end`、payload 範囲外）をエラー化
- [ ] `SongMetadata` の拡張項目（`replaygain`, `preview_start`, `preview_url`, `video_url`, `video_offset`, `readme`, `chart_names`）を保持
- [ ] `charts[]` の付帯情報（`md5`, `noteCount`, `bpm`, `duration`, `keys`, `scratch`, `bga`）を保持
- [ ] 取得した譜面文字列を既存 `parseBMS` / `parseBmson` に委譲

### chart-writer (`@be-music/chart-source` -> bemuse assets)

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

### player / chart-audio-renderer

- [x] 入力として `index.json` / `bemuse-song.json` を受理（Web プレイヤー）
- [x] keysound は `assets/metadata.json` + `*.bemuse` から解決（Web プレイヤー）
- [x] package 未収録の画像/動画は base resources へ fallback（Web プレイヤー）
- [ ] `refs[].hash` をキーにキャッシュ戦略を適用
- [x] 画像/動画 fallback の対象拡張子を `png|jpg|webm|mp4|m4v` に固定（Web プレイヤー）
- [x] `preview_url` 未指定時の既定値 `_bemuse_preview.mp3` を解決（Web プレイヤー）
- [x] `video_url` が `video_file` を上書きする規則を適用（Web プレイヤー）
- [x] `video_offset` を動画再生開始位置へ反映（Web プレイヤー）

## MVP 受け入れ基準

- ローカルの 1 曲フォルダ（`bemuse-song.json` + `assets/*` + `.bms/.bmson`）を `parse` で読み込める
- keysound を bemuse package から取り出して `player --auto` / `audio-render` で再生できる
- 破損チャンク（magic 不正、範囲不正）で説明可能なエラーを返す
