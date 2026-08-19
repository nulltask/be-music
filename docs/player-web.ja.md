[English version](./player-web.md)

# Browser player 実装メモ

この文書は、`@be-music/player-web` と `@be-music/player-web-demo` で追加された browser player の実装メモです。
timing、note、判定、score、gauge、BGA event の意味など、CLI と共有する runtime 意味論は [`player-spec.ja.md`](./player-spec.ja.md) を参照してください。

## 共通 runtime 連携

browser player は gameplay を `@be-music/player/core/engine` 経由で駆動します。
判定、keysound trigger routing、long note、地雷優先度、score、gauge、chart finish の意味論は engine が担当します。
LR2 gameplay scene は LR2 の `PLAYSTART` gate で 1 回 engine を起動し、beatoraja gameplay scene は `BeatorajaRuntimeAdapter` の背後に engine を mount します。
どちらの経路も engine の frame snapshot を scene state へ反映し、UI command を Pixi の視覚効果へ変換します。

browser runtime は次の adapter module を使います。

| module                                                                            | 役割                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web-audio-session.ts`](../packages/player-web/src/runtime/web-audio-session.ts) | engine の `AudioSession` 契約を Web Audio で実装します。即時発音、BGM scheduling、channel stop、pause/resume、key/BGM routing、動的 volume change、bmson `c=true` continuation、`#WAVCMD` gain を扱います。 |
| [`web-input-runtime.ts`](../packages/player-web/src/runtime/web-input-runtime.ts) | DOM `keydown` / `keyup` を engine の input bus へ写像します。OS auto-repeat を除外し、`Escape` / `F5` / `Space` を command event へ送り、lane press には物理 event timestamp を付けます。                   |
| [`web-ui-runtime.ts`](../packages/player-web/src/runtime/web-ui-runtime.ts)       | engine UI signal を Pixi host へ流します。frame snapshot は note、score、gauge、result state を更新し、command は lane flash、key hold、POOR BGA、judge/combo effect を駆動します。                         |
| [`engine-driver.ts`](../packages/player-web/src/runtime/engine-driver.ts)         | audio、input、UI adapter を組み立て、1 譜面分の `manualPlay` / `autoPlay` を呼び出します。                                                                                                                  |

`@be-music/player/core/engine` は `node:path` / `node:timers/promises` 依存を排除済みで、 browser bundle にそのまま
含められます。 `createNodeAudioSink` (Node 専用 audio backend) も lazy import なので、 host が
`PlayerOptions.createAudioSession` factory (= `createWebAudioSession`) を渡す経路では一切到達しません。

## 対象範囲

- `@be-music/player-web` は browser 向けの song loading、preview playback、built-in default / LR2 / beatoraja skin rendering、PixiJS scene、WebAudio bus、gameplay recording を提供します。
- `@be-music/player-web-demo` は core package を drag-and-drop loading、LR2 / beatoraja theme loading、debug control、recording control へ接続する private Vite application です。
- browser player は shared core と terminal player と同じ parser、chart、player helper を通して BMS/BME/BML/PMS と bmson の譜面を扱います。

## demo の起動

```bash
pnpm run player:web
```

この command は Vite demo を起動します。page には次のものを drop できます。

- BMS/BMSON の楽曲 folder
- 楽曲 folder を含む ZIP
- LR2 theme folder
- beatoraja theme folder
- 楽曲 folder と LR2 または beatoraja theme folder の同時 drop

chart file を含む混在 drop では、loader は chart directory を song file、それ以外を theme file として扱います。
chart file が存在しない場合、drop 全体を theme candidate として扱います。LR2 detection は `.lr2skin` file、beatoraja detection は `.luaskin` file または `skin/` path segment 配下の JSON file を使います。

## Browser loading model

- dropped path は共有の `@be-music/utils/core` path helper で normalize します。
- chart discovery は `.bms`, `.bme`, `.bml`, `.pms`, `.bmson` を受け付けます。
- file lookup は case-insensitive です。大文字小文字だけが異なる LR2 / beatoraja 風の asset reference でも browser drop で解決できます。
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

[LR2 skin 実装メモ](./lr2-skin.ja.md) では、renderer に依存しない parser と theme loader の境界をまとめています。
LR2 default skin を verified compatibility target とし、custom theme は実装済み directive family の範囲に収まるほど安定して動きます。

select scene は、hi-speed、autoplay、BGA mode/size、filter、sort、HS-FIX、HIDDEN/SUDDEN、lane cover、auto scratch、DP flip、1P/2P random / mirror mode、gauge variant を扱う LR2 PLAY OPTION control を scene 内で提供します。
select 時の option は chart preparation 時に gameplay へ引き継ぎます。
現在の shared-engine path は引き続き `GROOVE` gauge summary を publish します。LR2 gauge button は主に skin op state と scene-local setup を駆動し、2P independent gauge math はまだ接続していません。

グルーヴゲージのバーは LR2 の 50 ビード(各 2 %)として、単一の `#SRC_GROOVEGAUGE` の 4 セルスプライト(`表赤/表緑/裏赤/裏緑` = lit-red, lit-green, unlit-red, unlit-green)で描画します。80 % のクリア境界以上のビードは緑セル、未満は赤セルを使います。survival 系ゲージ(HARD / DEATH)は LR2 ではクリア境界が無いため、バー全体を赤で描画します。バーは現在のゲージ値のみを追従し、peak-hold(残像)ビードは描きません(LR2 にも無い)。ビードのセル選択ロジックは `scene/lr2/gameplay-hud.ts` の純関数 `resolveGrooveGaugeBeads` です。

scene に依存しない LR2 Pixi helper は [`skin/lr2/render.ts`](../packages/player-web/src/skin/lr2/render.ts) と
[`skin/lr2/scene-render.ts`](../packages/player-web/src/skin/lr2/scene-render.ts) にあります。destination keyframe 評価、sprite transform、source cell 選択、text rendering、number、slider、bargraph を共通化します。scene module は state 固有の値解決、timer、input behavior だけを保持します。

## Default skin family

built-in default family は、LR2 / beatoraja theme がない場合、または host が default family を明示的に選んだ場合に使う skinless path です。
theme file なしで select、decide、gameplay、result の表示を提供します。見た目は独自の cut-in chrome で、navy の void、cyan の slash、gold の lock-on、斜め parallelogram の plate、頂点が独立して揺れる菱形を使います。加算合成の cyan / gold flash を navy plate の上に重ねます。モーションは要素ごとに slam し、配色は crimson ではなく navy / ice / cyan です。ラベルは generic (`MUSIC SELECT` / `READY` / `CLEARED`) のままにし、第三者 UI asset は使いません。

gameplay は `PixiGameplayView` と共通の engine、note renderer、BGA renderer、audio bus、input handling を共有します。
ただし default chrome は `scene/default/gameplay.ts` から `skinlessChromeRenderer` option 経由で注入します。
LR2 gameplay scene は default renderer を import せず、共有 gameplay runtime と render layer だけを提供します。
これにより、default skin の見た目の変更は `scene/default/` 配下に閉じ、LR2 skin rendering は parse 済み `.lr2skin` data に紐づいたままになります。

default gameplay chrome は `scene/gameplay-lanes.ts` の共通 lane geometry helper を使います。
scratch lane は key lane より幅広く、2P scratch は右側に表示し、DP layout では両 side を SP 幅へ押し込んで全 lane を縮小するのではなく、片側分の lane 幅を保持します。
canvas chrome の本文スタンプは Dela Gothic One、数値 / 判定は Staatliches です。demo host の CSS は playfield 外の overlay 向けに LINE Seed JP を維持します。

HUD の各要素は独自の enter delay と slam を持ち、scene 間は斜めの cut-in wipe でつなぎます。incoming scene は全面カバーから開き、短い decide splash は最後の拍で wipe を閉じて、gameplay が READY の上に HUD を載せるのではなく void から開けるようにします。playfield のコンボは note より手前の overlay に、暗い菱形 plate の上へ paper / gold（cyan は使わない）で描き、譜面が詰まっても埋もれないようにします。`SkinlessGameplayChromeRuntime` の `sceneElapsedMs` は intro を壁時計の `nowMs` ではなく `PixiGameplayView.start()` に合わせます。

## beatoraja skin と theme support

`@be-music/player-web` は `loadBeatorajaThemeFromFiles()` 経由で `@be-music/beatoraja-skin` を利用します。
browser layer は JSON / Lua skin entry の discovery 後、同じ dropped bundle から source、texture、font、theme BGM、system sound を読み込みます。

実装済みの beatoraja browser feature:

- `BeatorajaPlaySkinView` を使う select、decide、gameplay、result scene
- play variant `5`, `7`, `9`, `10`, `14`。`24` / `24d` skin は discovery しますが、chart gameplay では mount しません
- skin `property[]`、`filepath[]`、custom offset、category group、mid-session `replaceSkin()` refresh
- score、combo、judge、gauge、chart metadata、clear lamp、rank、play option 向けの runtime `TIMER_*`、`OPTION_*`、`TEXT`、`NUM` wiring
- beatoraja-style note、LN/CN/HCN cap/body、lane marker、BGA still/video layer、judge popup、timing visualizer、gauge graph、BPM graph、note-distribution graph、result score/gauge history graph
- select scene の folder browsing、search、keymode filter、sort cycle、favorite、chart preview playback、select BGM、navigation system sound
- decide / result BGM、`STAGEFILE` / `BACKBMP` / `BANNER` の chart-image synthetic slot、loading-progress visual

[beatoraja skin 実装メモ](./beatoraja-skin.ja.md) では、renderer に依存しない parser と theme loader の境界をまとめています。
beatoraja default skin を primary compatibility target とし、community theme は同文書の normalized element family と runtime ID の範囲に収まるほど安定して動きます。

## Scene lifecycle

browser player は session 全体で 1 つの `PixiSceneHost` を使います。
host は 1 つの PixiJS `Application` を所有し、同時に 1 つの scene root だけを attach し、scene transition を直列化し、host dispose 時だけ renderer を破棄します。

LR2 と beatoraja は同じ high-level scene set をそれぞれ持ちます。default family も同じ 4 scene を提供し、`.lr2skin` なしの短い decide interstitial を含みます。

- chart browsing、preview playback、skin-side interaction を扱う select scene
- active family が提供する場合、gameplay 前の短い transition を扱う decide scene
- note、lane、BGA、HUD、judgment、audio、recording tap を扱う gameplay scene
- score summary と skin-rendered result presentation を扱う result scene

scene は `enter()`, `exit()`, `dispose()` を実装します。
`exit()` は transition 向けに一時的な listener と ticker work を外し、`dispose()` は scene 所有 resource を恒久的に解放します。

## Renderer と performance control

- PixiJS は既定で WebGPU preference を使い、browser が初期化できない場合は PixiJS 側で fallback します。
- `?renderer=webgl` で renderer 比較用に WebGL を強制できます。
- skin / BGA texture は LR2 / beatoraja の pixel-art asset を保つため nearest sampling を使います。
- beatoraja source texture は bitmap が保守的な GPU texture-size cap を超える場合、upload 前に downscale します。
- gameplay path は decide scene から gameplay へ渡す前に、chart parse、audio decode、BGA resource preload を進めます。
- 共有の scroll-distance helper により、terminal player と browser の note placement behavior を揃えます。
- default gameplay chrome は pooled Pixi child を graphics / text に再利用し、text style を cache して skinless renderer の frame ごとの allocation churn を抑えます。
- WebGL context に依存しない pure な browser-core helper は benchmark 対象です。

```bash
pnpm bench -- --packages player-web
```

## Audio, BGA, recording

- chart preview と gameplay audio は WebAudio を使います。
- gameplay audio は既定の split topology で key、BGM、master compressor stage を分けます。
- `?compressor=legacy` は比較用に旧 single-compressor 構成を維持します。
- `?compressor=off` は demo で compressor construction を無効化します。
- beatoraja theme audio は Lua `main_state.audio_play` / `audio_loop` call、select BGM、navigation system sound、decide BGM、result jingle に同じ browser bundle lookup を使います。
- BGA は chart BGA event が参照する still image と video asset を扱います。
- default family は LR2 skin と同じ chart BGA layer stack を built-in BGA frame 内に描画します。
- BMS rendering は、実装済み subset として `#BGAxx` sub-region、`#SWBGAxx` switching、`#ARGBxx` / `#EXBMPxx` tint / alpha を反映します。
- bmson rendering は `bga.bga_events`、`bga.layer_events`、`bga.poor_events` を使います。BMS layer channel と異なり、bmson layer image は黒を透明化せず黒ピクセルとして保持します。
- browser demo は、未対応 video asset を playback 前に ffmpeg.wasm path で transcode できます。
- chart の自然終了時は、短い post-chart delay を置いてから result scene を開きます。視覚的に result へ遷移しても、残っている gameplay audio tail は中断しません。
- gameplay recorder は WebM output を書き出し、active recording が gameplay bus の破棄前に flush されるよう、scene disposal より前に stop / finalization を終えます。
- 毎プレイでプレイログ（`*.bmplay.json` 入力リプレイ — 解決済み譜面、生の押下/解放列、プレイ設定。[playlog.ja.md](./playlog.ja.md) 参照）を記録します。demo は result scene のマウント時に自動ダウンロードし、Debug Menu の「Auto-save play history」チェックボックス（デフォルト ON。曲開始時にラッチされ、プレイ中は disabled）で制御します。`bms-playlog` CLI がこのファイルから LR2 / beatoraja / IIDX のリザルトを再現します。プレイログをページへドロップすると、対応する楽曲がロード済みの場合に記録されたランをリプレイ再生します。

## Compatibility boundary

browser player は、この repository の parser、chart、audio-renderer、player、utils、LR2 skin、beatoraja skin package を共有する runtime consumer です。
browser behavior が terminal player と分岐する場合は、pure な path、timing、scroll、lookup、event mapping helper を shared package へ移し、package-local test で覆う方針を優先します。
PixiJS scene wiring は browser rendering や WebAudio resource に依存する場合、`player-web` に残してかまいません。
