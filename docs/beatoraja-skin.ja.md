[English version](./beatoraja-skin.md)

# beatoraja skin 実装メモ

この文書は、現在の `@be-music/beatoraja-skin` 実装をまとめます。
この package は beatoraja の JSON skin と Lua skin theme を renderer 非依存の data structure に parse します。
PixiJS rendering は `@be-music/player-web` の責務です。CLI/TUI render path は beatoraja skin を読み込みません。

## 対象範囲

- `@be-music/beatoraja-skin` は play、select、decide、result、course-result、grade-result scene の `*.json` / `*.luaskin` entry を読み込みます。
- dropped folder や in-memory file map から theme asset を解決します。entry script の directory に対して path を normalize し、`*` wildcard (`play/background/*.png` 等) と case-insensitive lookup に対応します。
- beatoraja の Lua 2-phase 評価契約を honor します。entry を `skin_config = nil` で 1 度評価し header (`property[]` + `filepath[]` schema) を取得、次に user の選択を inject して `main()` 経由で完全な skin table を得ます。
- package は plain TypeScript object のみを返します。PixiJS object、WebAudio node、browser DOM UI は作成しません。

## Skin formats

beatoraja theme は 2 種類の interchangeable な entry format を持ちます。

| 拡張子 | format | discovery |
| --- | --- | --- |
| `*.json` | static JSON skin tree (trailing comma 含む) | `JSON.parse` で eager に parse |
| `*.luaskin` + 兄弟 `*.lua` | `require()` で兄弟 module を読む Lua 5.3 script | Fengari で評価 (下記参照) |

どちらも `BeatorajaSkin` (full) / `BeatorajaSkinHeader` (selector UI summary) と一致する value を返します。

## Skin type

各 skin の `type` 数値 field は beatoraja 本家の `SkinType` enum に対応します。
package は `BEATORAJA_SKIN_TYPE` 定数と `playVariantForSkinType` / `sceneForSkinType` helper を export します。

| code | label | scene |
| --- | --- | --- |
| 0 | `PLAY_7KEYS` | play (`'7'`) |
| 1 | `PLAY_5KEYS` | play (`'5'`) |
| 2 | `PLAY_14KEYS` | play (`'14'`) |
| 3 | `PLAY_10KEYS` | play (`'10'`) |
| 4 | `PLAY_9KEYS` | play (`'9'`) |
| 5 | `MUSIC_SELECT` | select |
| 6 | `DECIDE` | decide |
| 7 | `RESULT` | result |
| 10 | `COURSE_RESULT` | course-result |
| 15 | `GRADE_RESULT` | grade-result |
| 16 | `PLAY_24KEYS` | play (`'24'`) |
| 17 | `PLAY_24KEYS_DOUBLE` | play (`'24d'`) |

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

## Asset 解決

`resolveBeatorajaPath()` は entry skin file からの相対 path を解決します。
`..` segment、slash の normalize、case-insensitive lookup を honor します。
Windows で作成された beatoraja theme では、skin file 内 path と実 file の casing が違うことが多いためです。

`expandBeatorajaWildcard()` は `source[]` / `filepath[]` で使われる `*` pattern を展開します。
user の `filepath[]` 選択がある場合はそれが wildcard より優先されます。
それ以外は sort した最初の match が決定論的に選ばれます。

## Theme discovery

`discoverBeatorajaTheme()` は file map を walk し、scene 別 entry を持つ `BeatorajaTheme` を生成します。
play skin は variant ごと (`'7' / '5' / '9' / '10' / '14' / '24' / '24d'`) に group 化し、
同じ variant を `.json` / `.luaskin` の両方が cover する場合は JSON 側を優先します (parse が速く決定論的なため)。
個別 skin の error は `BeatorajaThemeDiscoveryWarning[]` に集約され、theme 全体の discovery を中断しません。

`pickBeatorajaPlaySkin(playSkins, desired)` は chart の variant に対する fallback chain を解決します。

## Browser player への配線

`@be-music/player-web` は `loadBeatorajaThemeFromFiles()` と helper 群
(`loadBeatorajaPlaySkinFromBundle` / `loadBeatorajaSelectSkinFromBundle` / `loadBeatorajaResultSkinFromBundle` / `loadBeatorajaDecideSkinFromBundle`)
を提供し、parser pipeline を browser 親和的な `File[]` API で wrap します。
state は LR2 theme state と並列に保持され、demo は drop が両方を含む場合に両方の summary を log します。

beatoraja skin の PixiJS rendering は後続 patch で実装されます。
現状は parser の配線、drop 時の theme discovery、bundle の inspection 用 expose までが含まれます。

## 互換性の境界

parser は意図的に permissive です。

- 未知の skin type は `'other'` として surface し error にしません。
- JSON の trailing comma (`,]`/`,}`) は parse 前に strip します。
- 整数 key と string key が混在する Lua table は record (string-keyed object) として返します。array vs record の判定は「全 key が 1..N の integer かつ `#t == N`」という厳密 rule で行います。
- `value` / `values` を持たない条件 group (`if` だけ) は silent に drop します (default theme でも no-op です)。

package は beatoraja 本家の `SkinObject` registry を実行しません。
raw skin tree と、その上に PixiJS scene を組むのに必要な helper 群のみを expose します。
