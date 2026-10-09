[English version](./beatoraja-skin.md)

# beatoraja skin 実装メモ

この文書は、現在の `@be-music/beatoraja-skin` 実装をまとめます。
この package は beatoraja の JSON skin と Lua skin theme を renderer 非依存の data structure に parse します。
PixiJS rendering は `@be-music/player-web` の責務です。CLI/TUI render path は beatoraja skin を読み込みません。

## 対象範囲

- `@be-music/beatoraja-skin` は play、select、decide、result、course-result scene の `*.json` / `*.luaskin` entry を読み込みます。
- dropped folder や in-memory file map から theme asset を解決します。entry script の directory に対して path を normalize し、`*` wildcard (`play/background/*.png` 等) と case-insensitive lookup に対応します。
- beatoraja の Lua 2-phase 評価契約を honor します。entry を `skin_config = nil` で 1 度評価し header (`property[]`、`filepath[]`、custom `offset[]` schema) を取得、次に user の選択を inject して `main()` 経由で完全な skin table を得ます。
- package は plain TypeScript object のみを返します。PixiJS object、WebAudio node、browser DOM UI は作成しません。

## Skin formats

beatoraja theme は 2 種類の interchangeable な entry format を持ちます。

| 拡張子                     | format                                          | discovery                      |
| -------------------------- | ----------------------------------------------- | ------------------------------ |
| `*.json`                   | static JSON skin tree (trailing comma 含む)     | `JSON.parse` で eager に parse |
| `*.luaskin` + 兄弟 `*.lua` | `require()` で兄弟 module を読む Lua 5.3 script | Fengari で評価 (下記参照)      |

どちらも `BeatorajaSkin` (full) / `BeatorajaSkinHeader` (selector UI summary) と一致する value を返します。

## Skin type

各 skin の `type` 数値 field は beatoraja 本家の `SkinType` enum に対応します。
package は `BEATORAJA_SKIN_TYPE` 定数と `playVariantForSkinType` / `sceneForSkinType` helper を export します。

| code | label                | scene                            |
| ---- | -------------------- | -------------------------------- |
| 0    | `PLAY_7KEYS`         | play (`'7'`)                     |
| 1    | `PLAY_5KEYS`         | play (`'5'`)                     |
| 2    | `PLAY_14KEYS`        | play (`'14'`)                    |
| 3    | `PLAY_10KEYS`        | play (`'10'`)                    |
| 4    | `PLAY_9KEYS`         | play (`'9'`)                     |
| 5    | `MUSIC_SELECT`       | select                           |
| 6    | `DECIDE`             | decide                           |
| 7    | `RESULT`             | result                           |
| 8    | `KEY_CONFIG`         | other                            |
| 9    | `SKIN_SELECT`        | other                            |
| 10   | `SOUND_SET`          | other                            |
| 11   | `THEME`              | other                            |
| 12   | `PLAY_7KEYS_BATTLE`  | play (unsupported battle layout) |
| 13   | `PLAY_5KEYS_BATTLE`  | play (unsupported battle layout) |
| 14   | `PLAY_9KEYS_BATTLE`  | play (unsupported battle layout) |
| 15   | `COURSE_RESULT`      | course-result                    |
| 16   | `PLAY_24KEYS`        | play (`'24'`)                    |
| 17   | `PLAY_24KEYS_DOUBLE` | play (`'24d'`)                   |
| 18   | `PLAY_24KEYS_BATTLE` | play (unsupported battle layout) |

## Lua sandbox

`evaluateBeatorajaLuaSkin()` は Fengari の上に手作りした sandbox で entry script を実行します。
default theme が実際に使う `base` / `table` / `string` / `math` のみ expose し、`package` / `io` / `os` / `debug` は除外します。
`dofile` / `loadfile` / `load` / `loadstring` / `collectgarbage` は nil 化し、悪意ある skin が theme 外に到達できないようにします。

`require()` は事前登録した module source registry の上に再実装しています。
host は entry script と同一 directory および 1 階層上 (beatoraja theme は `play_parts.lua` を共通化していることがあります) の `.lua` を全て登録します。
module は cache されるので、後続の `require()` は同じ table を返します。

2-phase 契約:

```lua
local t = require("play24main")
if skin_config then
  return t.main()
else
  return t.header
end
```

第 1 phase は `skinConfig: undefined`、第 2 phase は populated な `BeatorajaSkinConfig` を渡します。

## 条件 group

各 element list 内の `if`/`values`、`if`/`value` block は `flattenBeatorajaElements()` で flat な element stream に展開できます。
正規化 entry は active な `if` op-code を保持し、renderer は `isElementVisible()` で runtime に visibility を制御します。
負数 op は negation 扱い (op が active で**ない**ことを要求) です。

## Element normalization

package は読み込んだ skin tree を upstream に近い形で保持しつつ、renderer 向けには型付き normalizer を expose します。
normalizer は `src/elements/` 配下にあり、image、imageset、value、float-value、text、slider、note、judge、judge graph、gauge、gauge graph、BPM graph、timing visualizer、timing distribution graph、song list、custom event、direction、destination、PM character、generic graph element を扱います。

destination normalization は keyframe、offset、op gate、interpolation data を renderer 非依存の object に変換します。
value / image helper は `divx` / `divy` cell math、frame の carry-forward、loop wrapping を解決するため、renderer は source JSON / Lua table を再解釈せずに現在 frame を sample できます。

## Asset 解決

`resolveBeatorajaPath()` は entry skin file からの相対 path を解決します。
`..` segment、slash の normalize、case-insensitive lookup を honor します。
Windows で作成された beatoraja theme では、skin file 内 path と実 file の casing が違うことが多いためです。

`expandBeatorajaWildcard()` は `source[]` / `filepath[]` で使われる `*` pattern を展開します。
user の `filepath[]` 選択がある場合はそれが wildcard より優先されます。
それ以外は sort した最初の match が決定論的に選ばれます。

## Theme discovery

`discoverBeatorajaTheme()` は file map を walk し、scene 別 entry を持つ `BeatorajaTheme` を生成します。
play skin は variant ごと (`'7' / '5' / '9' / '10' / '14' / '24' / '24d'`) に group 化します。
複数 entry が同じ slot を cover する場合は、JSON entry、`skin/default/`、辞書順の順で優先します。
個別 skin の error は `BeatorajaThemeDiscoveryWarning[]` に集約され、theme 全体の discovery を中断しません。

`pickBeatorajaPlaySkin(playSkins, desired)` は chart の variant に対する fallback chain を解決します。

## Browser player への配線

`@be-music/player-web` は `loadBeatorajaThemeFromFiles()` を提供し、dropped browser `File[]` を `BeatorajaThemeBundle` に wrap します。
host はその bundle から、この package の `loadBeatorajaSkin()` / `loadBeatorajaPlaySkin()`、`source[]` 向けの `bundleBeatorajaSources()`、Pixi texture 向けの `loadBeatorajaTexturesFromBundle()`、CSS / bitmap font 向けの `loadBeatorajaFonts()` を呼びます。
state は LR2 theme state と並列に保持されるため、demo は両方の theme format を同時に保持できます。

browser renderer は select、decide、gameplay、result skin の共有 view として `BeatorajaPlaySkinView` を使います。
scene module は `TEXT`、`NUM`、`OPTION`、timer、chart image、graph、gauge、note layer、BGA layer、system sound、result history など runtime 固有の resolver を提供します。
gameplay は `BeatorajaRuntimeAdapter` で engine UI signal を beatoraja timer、op code、judge popup、combo digit、key beam、LN hold timer、timing sample へ変換します。

browser gameplay path は parser が discovery する chart variant `5`、`7`、`9`、`10`、`14`、`24`、`24d` をすべて mount します。
keyboard mode のレーンは、upstream の `play24main.lua` が使う `1000` 番台 timer base (`bomb_1p_key10 = 1010` など) で参照します。これらは `runtime-ids.ts` に実装済みです。

## 互換性の境界

parser は意図的に permissive です。

- 未知の skin type は `'other'` として surface し error にしません。
- JSON の trailing comma (`,]`/`,}`) は parse 前に strip します。
- 整数 key と string key が混在する Lua table は record (string-keyed object) として返します。array vs record の判定は「全 key が 1..N の integer かつ `#t == N`」という厳密 rule で行います。
- `value` / `values` を持たない条件 group (`if` だけ) は silent に drop します (default theme でも no-op です)。

package は beatoraja 本家の `SkinObject` registry を実行しません。
raw skin tree と、その上に PixiJS scene を組むのに必要な helper 群のみを expose します。
