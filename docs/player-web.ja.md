[English version](./player-web.md)

# Browser player 実装メモ

この文書は、`@be-music/player-web-core` と `@be-music/player-web-demo` で追加された browser player の実装メモです。
timing、note、判定、score、gauge、BGA event の意味など、CLI と共有する runtime 意味論は [`player-spec.ja.md`](./player-spec.ja.md) を参照してください。

## 監査メモ

- 監査起点コミット: `97b05e825c60e2242b621f63a1ebbfccd415362b`
- 監査時点コミット: `cef0f2f8a604c3a034e04b798953915e01a72549` (PR #73 merge)
- 監査対象範囲: PR #73 の browser player package、CLI/browser 共通 playback helper、web 関連 test、benchmark 追加

## 対象範囲

- `@be-music/player-web-core` は browser 向けの song loading、preview playback、LR2 skin parsing、PixiJS scene、WebAudio bus、gameplay recording を提供します。
- `@be-music/player-web-demo` は core package を drag-and-drop loading、theme loading、debug control、recording control へ接続する private Vite application です。
- browser player は CLI と同じ parser / player helper を通して BMS/BME/BML/PMS と bmson の譜面を扱います。

## demo の起動

```bash
pnpm run player:web
```

この command は Vite demo を起動します。page には次のものを drop できます。

- BMS/BMSON の楽曲 folder
- 楽曲 folder を含む ZIP
- LR2 theme folder
- 楽曲 folder と LR2 theme folder の同時 drop

chart file を含む混在 drop では、loader は chart directory を song file、それ以外を theme file として扱います。
chart file が存在しない場合、drop 全体を theme として扱います。

## Browser loading model

- dropped path は共有の `@be-music/utils/core` path helper で normalize します。
- chart discovery は `.bms`, `.bme`, `.bml`, `.pms`, `.bmson` を受け付けます。
- file lookup は case-insensitive です。大文字小文字だけが異なる LR2 風の asset reference でも browser drop で解決できます。
- 大きな audio / video file は既定で lazy な `File` reference のまま保持します。image、skin、chart、小さな metadata file は collection loading 中に bytes として読み込みます。
- folder walking と file read は bounded concurrency と progress callback を使い、大きな folder でも browser の FileSystem API や UI update loop を過剰に詰まらせないようにします。
- parse error は drop 全体を abort せず、collection に蓄積します。

## LR2 skin と theme support

core parser は LR2 CSV skin file を select、decide、gameplay、result scene 向けに扱います。
play skin は key variant (`5`, `7`, `9`, `10`, `14`) ごとにまとめ、play 開始時に譜面に合う layout を選びます。

実装済みの skin feature:

- 現在の skin file からの相対 `#INCLUDE` 解決
- `#CUSTOMOPTION` と `#CUSTOMFILE`
- `#SRC_IMAGE`, `#DST_IMAGE`, number, text, slider, bar, gauge, judge line, measure line, BGA, result 用 graph 系 element
- LR2 default skin が使う timer と op condition 評価
- `#LR2FONT` bitmap font と system-font text fallback
- TGA image decode と DXA archive extraction
- LR2 theme file 向けの case-insensitive / wildcard asset lookup

demo は、dropped theme に存在する場合、select / decide screen 向けの LR2 theme BGM と system sound も読み込みます。

## Scene lifecycle

browser player は session 全体で 1 つの `PixiSceneHost` を使います。
host は 1 つの PixiJS `Application` を所有し、同時に 1 つの scene root だけを attach し、scene transition を直列化し、host dispose 時だけ renderer を破棄します。

現在の scene set:

- chart browsing、preview playback、skin-side interaction を扱う select scene
- gameplay 前の短い transition を扱う decide scene
- note、lane、BGA、HUD、judgment、audio、recording tap を扱う gameplay scene
- score summary と LR2 result skin rendering を扱う result scene

scene は `enter()`, `exit()`, `dispose()` を実装します。
`exit()` は transition 向けに一時的な listener と ticker work を外し、`dispose()` は scene 所有 resource を恒久的に解放します。

## Renderer と performance control

- PixiJS は既定で WebGPU preference を使い、browser が初期化できない場合は PixiJS 側で fallback します。
- `?renderer=webgl` で renderer 比較用に WebGL を強制できます。
- skin / BGA texture は LR2 の pixel-art asset を保つため nearest sampling を使います。
- gameplay path は decide scene から gameplay へ渡す前に、chart parse、audio decode、BGA resource preload を進めます。
- 共有の scroll-distance helper により、CLI と browser の note placement behavior を揃えます。
- WebGL context に依存しない pure な browser-core helper は benchmark 対象です。

```bash
pnpm bench -- --packages player-web-core
```

## Audio, BGA, recording

- chart preview と gameplay audio は WebAudio を使います。
- gameplay audio は既定の split topology で key、BGM、master compressor stage を分けます。
- `?compressor=legacy` は比較用に旧 single-compressor 構成を維持します。
- `?compressor=off` は demo で compressor construction を無効化します。
- BGA は chart BGA event が参照する still image と video asset を扱います。
- browser demo は、未対応 video asset を playback 前に ffmpeg.wasm path で transcode できます。
- gameplay recorder は WebM output を書き出し、active recording が gameplay bus の破棄前に flush されるよう、scene disposal より前に stop / finalization を終えます。

## Compatibility boundary

browser player は、この repository の parser、chart、audio-renderer、player、utils package を共有する runtime consumer です。
browser behavior が CLI player と分岐する場合は、pure な path、timing、scroll、lookup、event mapping helper を shared package へ移し、package-local test で覆う方針を優先します。
PixiJS scene wiring は browser rendering や WebAudio resource に依存する場合、`player-web-core` に残してかまいません。
