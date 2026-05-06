[Japanese version](./json-spec.ja.md)

# BMS/BMSON intermediate representation (`@be-music/json`) implementation specification

This document is the canonical specification for the BMS/BMSON intermediate representation provided by `@be-music/json`.
`@be-music/json` is a format for Be-Music's internal processing only, and is not an external exchange format for distribution or reuse.
Also, as it is still in the early stages of development, backward compatibility of this intermediate representation cannot be guaranteed.

## Purpose

- Absorb BMS / BMSON differences and handle internal processing in a single format
- Preserve event timing stably during round trips

## Package boundaries

- `@be-music/json` is a pure IR package
- `@be-music/json` only provides types, normalized data structures, and clone/initialization/basic formatting helpers
- `@be-music/chart` is in charge of score semantics such as beat conversion, event order, long note resolution, sample trigger judgment, etc.
- Source-level information for round-trips is kept as part of the IR, but separated from the normalized score semantics in the `preservation` layer.

## Design principles

- When stringifying parsed input, the IR aims to preserve the original chart structure as faithfully as possible.
- The structure here includes elements that affect the re-stringing result, such as the order of overlapping definitions, control syntax, object line division units, and BMSON bar line information.
- Surface information that is not explicitly maintained by the IR, such as blank lines, comments, white space, line breaks, character codes, etc., is not subject to this principle.
- As a result of editing the IR, if the retained structural information and the normalized `events` / `measures` / extension information no longer match, the stringifier will prioritize consistency and regenerate it.

## Root structure

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
    "base": 62,
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

`bms` is an extension area that holds additional BMS-specific information.

- `lnType`: value of `#LNTYPE`
- `lnMode`: value of `#LNMODE`
- `lnObjs`: Array holding multiple `#LNOBJ` declarations in declaration order (2 digit base36)
- `defExRank`: value of `#DEFEXRANK`
- `exRank`: Map of `#EXRANKxx`
- `argb`: map of `#ARGBxx`
- `player`: value of `#PLAYER`
- `pathWav`: value of `#PATH_WAV`
- `base`: value of `#BASE`; currently `36` or `62`. Omitted value means `36`.
- `baseBpm`: value of `#BASEBPM`
- `stp`: `#STP` value array
- `option`: value of `#OPTION`
- `changeOption`: Map of `#CHANGEOPTIONxx`
- `wavCmd`: value of `#WAVCMD`
- `exWav`: Map of `#EXWAVxx`
- `exBmp`: Map of `#EXBMPxx`
- `bga`: Map of `#BGAxx`
- `scroll`: Map of `#SCROLLxx`
- `speed`: Map of `#SPEEDxx`
- `poorBga`: value of `#POORBGA`
- `swBga`: Map of `#SWBGAxx`
- `videoFile`: value of `#VIDEOFILE`
- `midiFile`: value of `#MIDIFILE`
- `materials`: value of `#MATERIALS`
- `divideProp`: value of `#DIVIDEPROP`
- `charset`: value of `#CHARSET`
- `controlFlow`: Control syntax (`#RANDOM`/`#IF`/`#SWITCH` series) and the header/object lines inside it
- `controlFlow.kind = "object"` is kept in the same `events` format as normal events (with `measureLength` if necessary)
- Parser keeps control syntax in this array and branches are executed at playback/render time
- `scroll` values ​​allow finite numbers, `0` and negative values ​​are also retained

### BMS object ID base

BMS defaults to base-36 object IDs (`0-9A-Z`), and lowercase ASCII letters are normalized to uppercase.
When `bms.base` is `62`, object IDs use the beatoraja-style base-62 set (`0-9A-Za-z`) and preserve case.

This affects all two-character indexed IDs stored in the IR:

- Resource maps such as `resources.wav`, `resources.bmp`, `resources.bpm`, `resources.stop`, and `resources.text`
- BMS extension maps such as `bms.exRank`, `bms.argb`, `bms.exWav`, `bms.exBmp`, `bms.bga`, `bms.scroll`, `bms.speed`, and `bms.swBga`
- BMS object event `value` fields, including events retained in `preservation.bms.sourceLines` and `bms.controlFlow`
- `bms.lnObjs`

Code that consumes IDs should call `resolveBmsBase(json)` and pass the result to ID normalization helpers instead of uppercasing manually.
This keeps `0a` and `0A` distinct for base-62 charts while preserving base-36 behavior for ordinary charts.

`bmson` is an extension area that holds additional bmson-specific information.

- `version`: bmson version string
- `info`: In addition to `resolution`, retains `subartists`, `chartName`, `modeHint`, `judgeRank`, `total`, and image/preview system.
- `bga`: Keep `header`, `events`, `layerEvents`, `poorEvents`

`preservation` is an auxiliary layer that maintains source-level information for round-trips.

- `preservation.bms.sourceLines`: Snapshot that preserves all lines of BMS in declaration order, excluding blank lines/comments.
- `preservation.bms.sourceLines` is the first choice to reproduce `stringifyBms(parseChart(...))` while preserving the relative position of BMS header / object / control syntax
- `preservation.bms.objectLines`: declaration order snapshot of object lines outside of control constructs
- `preservation.bms.objectLines` is a partial snapshot for processing where you only want to handle object lines outside the control syntax
- If `preservation.bms.objectLines` does not match `events` / `measures`, stringifier ignores and regenerates this array
- `preservation.bmson.lines`: Array of bar line `y` values ​​(ascending order, no duplicates, starting from `0`)
- `preservation.bmson.bpmEvents`: ordered snapshot of `bpm_events`
- `preservation.bmson.stopEvents`: ordered snapshot of `stop_events`
- `preservation.bmson.soundChannels`: Ordered snapshot of `sound_channels`. Also retains unused channels

## Event structure (regular)

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

## Meaning of `position`

- `position[0]`: numerator (`numerator`)
- `position[1]`: denominator (`denominator`)

Constraints:

- `denominator >= 1`
- `0 <= numerator < denominator`
- Both are integers

## Comparison/sorting rules

Event comparison order:

1. `measure`
2. `position` (exact comparison of fractions)
3. `channel`
4. `value`

Fraction comparisons do not use floating point numbers and are determined by cross products.

## Conversion rules

- `stringifier` uses `position` denominator information to determine intra-bar resolution
- `parseJson` requires `position` tuple and treats missing events as errors
- Score semantics helpers such as beat conversion and event order are provided by `@be-music/chart`
