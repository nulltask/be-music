# BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様

この文書は、`@be-music/json` が提供する BMS/BMSON 中間表現の正規仕様です。
`@be-music/json` は Be-Music の内部処理専用フォーマットであり、配布や再利用を目的とした外部交換フォーマットではありません。
また、まだ開発初期段階のため、この中間表現の後方互換性は保証しません。

## 目的

- BMS / BMSON の差分を吸収して、内部処理を単一形式で扱う
- 再文字列化時にイベント時刻を安定再現する

## パッケージ境界

- `@be-music/json` は純粋な IR パッケージです
- `@be-music/json` が提供するのは、型、正規化済みのデータ構造、clone / 初期化 / 基本的な整形 helper に限られます
- beat 変換、イベント順序、ロングノート解決、sample trigger 判定などの譜面意味論は `@be-music/chart` が担当します
- round-trip のための source-level 情報は IR の一部として保持しますが、正規化済みの譜面意味論とは `preservation` 層で分離します

## 設計原則

- IR は `parse` した入力を `stringify` したときに、元の譜面が持っていた構造をできる限り変えずに再現することを原則とします
- ここでいう構造には、重複定義の順序、制御構文、オブジェクト行の分割単位、bmson の小節線情報など、再文字列化結果に影響する要素を含みます
- 空行、コメント、空白、改行コード、文字コードなど、IR が明示的に保持しない表層情報はこの原則の対象外です
- IR を編集した結果、保持していた構造情報と正規化済みの `events` / `measures` / 拡張情報が一致しなくなった場合、stringifier は整合性を優先して再生成を行います

## ルート構造

```json
{
  "format": "be-music-json/0.1.0",
  "sourceFormat": "bms | bmson | json",
  "metadata": {},
  "resources": {},
  "measures": [],
  "events": [],
  "bms": {
    "lnType": 1,
    "lnMode": 0,
    "lnObjs": ["AA", "ZZ"],
    "defExRank": 120,
    "exRank": {
      "01": "120,90,60,30"
    },
    "argb": {
      "0A": "FF000000"
    },
    "player": 1,
    "pathWav": "sounds/",
    "baseBpm": 155,
    "stp": ["001.240"],
    "option": "HIGH-SPEED",
    "changeOption": {
      "01": "MIRROR"
    },
    "wavCmd": "legacy",
    "exWav": {
      "01": "sample_ex.wav"
    },
    "exBmp": {
      "01": "image_ex.bmp"
    },
    "bga": {
      "01": "01"
    },
    "scroll": {
      "01": 0.5
    },
    "poorBga": "01",
    "swBga": {
      "01": "02"
    },
    "videoFile": "movie.mp4",
    "midiFile": "song.mid",
    "materials": "materials.def",
    "divideProp": "lane=2",
    "charset": "Shift_JIS",
    "controlFlow": [
      {
        "kind": "directive",
        "command": "RANDOM",
        "value": "2"
      },
      {
        "kind": "object",
        "measure": 0,
        "channel": "11",
        "events": [
          {
            "measure": 0,
            "channel": "11",
            "position": [0, 1],
            "value": "01",
            "bmson": {
              "l": 120,
              "c": true
            }
          }
        ]
      }
    ]
  },
  "bmson": {
    "version": "string?",
    "info": {
      "resolution": 240,
      "chartName": "HYPER",
      "modeHint": "beat-7k"
    },
    "bga": {
      "header": [
        {
          "id": 1,
          "name": "base.png"
        }
      ],
      "events": [
        {
          "y": 0,
          "id": 1
        }
      ],
      "layerEvents": [],
      "poorEvents": []
    }
  },
  "preservation": {
    "bms": {
      "sourceLines": [
        {
          "kind": "header",
          "command": "TITLE",
          "value": "Example"
        },
        {
          "kind": "object",
          "measure": 1,
          "channel": "13",
          "events": [
            {
              "measure": 1,
              "channel": "13",
              "position": [1, 4],
              "value": "22"
            }
          ]
        }
      ],
      "objectLines": [
        {
          "measure": 1,
          "channel": "13",
          "events": [
            {
              "measure": 1,
              "channel": "13",
              "position": [1, 4],
              "value": "22"
            }
          ]
        }
      ]
    },
    "bmson": {
      "lines": [0, 960, 1920],
      "bpmEvents": [{ "y": 0, "bpm": 120 }],
      "stopEvents": [{ "y": 480, "duration": 96 }],
      "soundChannels": [
        {
          "name": "lead.wav",
          "notes": [{ "x": 1, "y": 0, "l": 120, "c": true }]
        }
      ]
    }
  }
}
```

`bms` は BMS 固有の追加情報を保持する拡張領域です。

- `lnType`: `#LNTYPE` の値
- `lnMode`: `#LNMODE` の値
- `lnObjs`: 複数 `#LNOBJ` 宣言を宣言順で保持した配列 (2桁 base36)
- `defExRank`: `#DEFEXRANK` の値
- `exRank`: `#EXRANKxx` のマップ
- `argb`: `#ARGBxx` のマップ
- `player`: `#PLAYER` の値
- `pathWav`: `#PATH_WAV` の値
- `baseBpm`: `#BASEBPM` の値
- `stp`: `#STP` の値配列
- `option`: `#OPTION` の値
- `changeOption`: `#CHANGEOPTIONxx` のマップ
- `wavCmd`: `#WAVCMD` の値
- `exWav`: `#EXWAVxx` のマップ
- `exBmp`: `#EXBMPxx` のマップ
- `bga`: `#BGAxx` のマップ
- `scroll`: `#SCROLLxx` のマップ
- `speed`: `#SPEEDxx` のマップ
- `poorBga`: `#POORBGA` の値
- `swBga`: `#SWBGAxx` のマップ
- `videoFile`: `#VIDEOFILE` の値
- `midiFile`: `#MIDIFILE` の値
- `materials`: `#MATERIALS` の値
- `divideProp`: `#DIVIDEPROP` の値
- `charset`: `#CHARSET` の値
- `controlFlow`: 制御構文 (`#RANDOM`/`#IF`/`#SWITCH` 系) と、その内側のヘッダ/オブジェクト行
- `controlFlow.kind = "object"` は通常イベントと同じ `events` 形式（必要に応じて `measureLength`）で保持
- パーサは制御構文をこの配列へ保持し、分岐の実行は再生/レンダリング時に行います
- `scroll` の値は有限数を許可し、`0` および負値も保持対象です

`bmson` は bmson 固有の追加情報を保持する拡張領域です。

- `version`: bmson のバージョン文字列
- `info`: `resolution` に加え、`subartists`, `chartName`, `modeHint`, `judgeRank`, `total`, 画像/プレビュー系を保持
- `bga`: `header`, `events`, `layerEvents`, `poorEvents` を保持

`preservation` は round-trip のための source-level 情報を保持する補助層です。

- `preservation.bms.sourceLines`: 空行/コメントを除く BMS の全行を宣言順で保持するスナップショット
- `preservation.bms.sourceLines` は BMS の header / object / 制御構文の相対位置を保ったまま `stringifyBms(parseChart(...))` を再現するための第一選択です
- `preservation.bms.objectLines`: 制御構文の外側にあるオブジェクト行の宣言順スナップショット
- `preservation.bms.objectLines` は制御構文外の object 行だけを扱いたい処理向けの部分スナップショットです
- `preservation.bms.objectLines` が `events` / `measures` と一致しない場合、stringifier はこの配列を無視して再生成します
- `preservation.bmson.lines`: 小節線 `y` 値の配列 (昇順・重複なし・`0` 始まり)
- `preservation.bmson.bpmEvents`: `bpm_events` の配列順スナップショット
- `preservation.bmson.stopEvents`: `stop_events` の配列順スナップショット
- `preservation.bmson.soundChannels`: `sound_channels` の配列順スナップショット。未使用チャンネルも保持します

## Event 構造 (正規)

```ts
type BeMusicPosition = readonly [numerator: number, denominator: number];

interface BeMusicEvent {
  measure: number;
  channel: string;
  position: BeMusicPosition;
  value: string;
  bmson?: {
    l?: number;
    c?: boolean;
  };
}
```

## `position` の意味

- `position[0]`: 分子 (`numerator`)
- `position[1]`: 分母 (`denominator`)

制約:

- `denominator >= 1`
- `0 <= numerator < denominator`
- いずれも整数

## 比較・ソート規則

イベント比較順:

1. `measure`
2. `position` (分数の厳密比較)
3. `channel`
4. `value`

分数比較は浮動小数を使わず、クロス積で判定します。

## 変換規則

- `stringifier` は `position` 分母情報を使って小節内解像度を決定します
- `parseJson` は `position` タプルを必須とし、欠損イベントはエラー扱いにします
- beat 変換やイベント順序などの譜面意味論 helper は `@be-music/chart` が提供します
