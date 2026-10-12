[English version](./player-web.md)

# Browser player 実装メモ

この文書は、`@be-music/player-web` と `@be-music/player-web-demo` で追加された browser player の実装メモです。
timing、note、判定、score、gauge、BGA event の意味など、CLI と共有する runtime 意味論は [`player-spec.ja.md`](./player-spec.ja.md) を参照してください。

## 共通 runtime 連携

browser player は gameplay を `@be-music/player/core/engine` 経由で駆動します。
判定、keysound trigger routing、long note、地雷の発動、score、gauge、chart finish の意味論は engine が担当します。
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
プレイフィールドをダブルクリックすると demo をフルスクリーンに切り替えます。`Esc` は通常のシーン操作の前にフルスクリーンを解除します。

### Debug Menu

右上の lil-gui **Debug Menu**（起動時は折りたたみ）は、よく使う操作を先頭に置き、残りをフォルダーにまとめています。各フォルダーの開閉状態は記憶されます（`localStorage` の `be-music-demo.debug-menu-folders`）。パネル自体は常に折りたたんだ状態で始まります。

- **トップレベル:** Status（読み取り専用）、Open folder、Open files (ZIP / play log)、Skin family、Built-in skin、● Record、📸 Screenshot。Open files では譜面の ZIP アーカイブ（`?music=` と同じ読み込み）や、リプレイするプレイログ（`*.bmplay.json`）を選べます。Open folder はフォルダー選択ダイアログを使い、ドロップと同じ経路で読み込みます。
- **Play options**（既定で開く）: Auto play、Gauge、Random 1P / 2P、DP flip、Auto scratch 1P / 2P、Judge windows。曲の開始時に確定し、プレイ中は無効になります。
- **Audio**（既定で開く）: Master / Key sound / BGM の音量 (%)、Play in silent mode（Audio Session API があるブラウザーのみ。後述）、 **Compressor** フォルダー（Enabled、stage ごとの切り替え、各 compressor の threshold / knee / ratio / attack / release とリセット）。
- **Skin & display**（既定で閉じる）: Skin effects、Play layout、Judged notes、Toggle fullscreen、LR2 theme（LR2 theme を含む drop の後）、**Beatoraja skins**（シーンごとの選択。beatoraja theme の読み込み中だけ表示）、**Skin settings**（組み込みスキンに設定がある場合）、**Add skin**。
- **Library & records**（既定で閉じる）: Music / Skin ZIP URL と Load from URLs（`?music=` / `?skin=` と同じ読み込みをその場で実行）、Auto-save play history、Clear best records、**BGA video transcode** フォルダー。
- **Developer**（既定で閉じる）: Auto pause on blur、Show invisible notes、FPS（フォルダーを開いている間だけ計測するレンダラーのフレームレート）、Reset settings and reload（ベストレコード以外の demo の保存設定をすべて消去して再読み込み）。

### スマートフォンとタブレット

主ポインターが指の端末（`(pointer: coarse)`、またはスマートフォン大の画面でタッチポインターを持つ端末）を、demo はタッチ優先として扱います。

- **タッチプレイ:** 組み込みスキンと LR2 のプレイ画面では、各レーンの下側から画面下端までがそのレーンのタッチ領域です。指ごとに独立して押す・押し続ける（ロングノート）・離すが働き、指を隣のレーンへ滑らせると元のレーンを離して新しいレーンを押します。タッチはキーボードと同じ入力経路を通るので、判定、キービーム、プレイログも同じように動きます。プレイ中は左上に一時停止ボタンがあり、一時停止中は Quit も表示されます。
- **タッチレイアウト:** 組み込みスキンはタッチ用のゲームプレイレイアウトに切り替わります。ステージの大部分に同じ幅のレーンを並べ（鍵盤は最大 72 デザイン px、横向きのスマートフォンで約 58 CSS px）、判定ラインを少し下げ、BGA は表示しません。24 / 48 KEY の譜面は標準レイアウトのままです。Debug Menu の **Play layout**（Auto / Desktop / Touch）で次のプレイから切り替えられます。
- **選曲画面:** 行やボタンはマウスと同じくタップで操作できます。リストは上下にスワイプしてスクロールします。
- **エフェクト:** Debug Menu で以前に選んでいなければ、スキンのエフェクトは Reduced から始まります。
- **画面:** ページの UI はステージに重ならないよう退きます（検索ボックスは入力中だけ表示し、Help はアイコンだけになります）。スマートフォンでは最初のタップでブラウザーが許す範囲でフルスクリーンと横向きを要求し、縦持ちのときは回転を促す表示を出します。
- **消音モードでの再生:** iOS / iPadOS の Safari は、既定では Web Audio を ambient な音として扱います。他のアプリの音楽と混ざって鳴り、着信/サイレントスイッチで消音されます。ブラウザーに [Audio Session API](https://w3c.github.io/audio-session/)（`navigator.audioSession`、Safari 16.4 以降）がある場合、Debug Menu の **Audio** フォルダーに **消音モードでも再生**（英語表示では Play in silent mode）が表示されます。オンにすると demo は audio session の type を `'playback'` にし、サイレントスイッチがオンでも音が鳴りますが、他のアプリで再生中の音楽は停止します（システムが「再生中」コントロールを表示することもあります）。オフ（既定）ではブラウザー既定の `'auto'` に戻し、Web Audio は他のアプリと混ざって鳴り、スイッチに従います。設定はリロード後も保持され、音声の開始前、最初のタップやキー入力時（各シーンが音声を開始するタイミング）、ページが再び表示されたときに適用されます。他のブラウザーには Web Audio を消音するこの種のスイッチがないため、設定は表示しません。スマートフォンやタブレットで設定がオフのまま初めて音が鳴るときは、画面上部に設定をオンにできる小さなヒントを出します。ヒントはブラウザーごとに 1 回だけ表示され、閉じるボタンで閉じるか、しばらくすると自動で消えます。

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
選んだ gauge は shared engine に渡り、engine は有効なルールセットの gauge 一覧からそれを解決して、そのカーブで進めます（HARD は実際に減り、DEATH は実際に途中終了します）。リプレイはプレイログに記録された gauge で進みます。2P independent gauge math はまだ接続していません。

グルーヴゲージのバーは LR2 の 50 ビード(各 2 %)として、単一の `#SRC_GROOVEGAUGE` の 4 セルスプライト(`表赤/表緑/裏赤/裏緑` = lit-red, lit-green, unlit-red, unlit-green)で描画します。80 % のクリア境界以上のビードは緑セル、未満は赤セルを使います。survival 系ゲージ(HARD / DEATH)は LR2 ではクリア境界が無いため、バー全体を赤で描画します。バーは現在のゲージ値のみを追従し、peak-hold(残像)ビードは描きません(LR2 にも無い)。ビードのセル選択ロジックは `scene/lr2/gameplay-hud.ts` の純関数 `resolveGrooveGaugeBeads` です。

scene に依存しない LR2 Pixi helper は [`skin/lr2/render.ts`](../packages/player-web/src/skin/lr2/render.ts) と
[`skin/lr2/scene-render.ts`](../packages/player-web/src/skin/lr2/scene-render.ts) にあります。destination keyframe 評価、sprite transform、source cell 選択、text rendering、number、slider、bargraph を共通化します。scene module は state 固有の値解決、timer、input behavior だけを保持します。

## Default skin family

built-in default family は、LR2 / beatoraja theme がない場合、または host が default family を明示的に選んだ場合に使う skinless path です。
theme file なしで select、gameplay、result の表示を提供します。

この family はすべての画面を be-music スキン（公開パッケージ `@be-music/skin-sdk` 上に書かれたコード定義のスキン）で描きます。
スキンの作り方は [be-music スキンの作り方](./be-music-skin.ja.md) を参照してください。

gameplay は `PixiGameplayView` と共通の engine、note renderer、BGA renderer、audio bus、input handling を共有します。
ただし default chrome は `scene/default/gameplay.ts` から `skinlessChromeRenderer` option 経由で注入します。
LR2 gameplay scene は default renderer を import せず、共有 gameplay runtime と render layer だけを提供します。
これにより、default skin の見た目の変更は `scene/default/` 配下に閉じ、LR2 skin rendering は parse 済み `.lr2skin` data に紐づいたままになります。

default gameplay chrome は `scene/gameplay-lanes.ts` の共通 lane geometry helper を使います。
scratch lane は key lane より幅広く、2P scratch は右側に表示し、DP layout では両 side を SP 幅へ押し込んで全 lane を縮小するのではなく、片側分の lane 幅を保持します。
default family は通常テキストに LINE Seed JP、判定と combo 表示に Azeret Mono を使います。

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

LR2 と beatoraja は同じ high-level scene set をそれぞれ持ちます。default family は decide scene を持たず、同じ select、gameplay、result の形を skinless に提供します。

- chart browsing、preview playback、skin-side interaction を扱う select scene
- active family が提供する場合、gameplay 前の短い transition を扱う decide scene
- note、lane、BGA、HUD、judgment、audio、recording tap を扱う gameplay scene
- score summary と skin-rendered result presentation を扱う result scene

scene は `enter()`, `exit()`, `dispose()` を実装します。
`exit()` は transition 向けに一時的な listener と ticker work を外し、`dispose()` は scene 所有 resource を恒久的に解放します。

## ノートの表示範囲

gameplay view は、描くノート・地雷・小節線を 2 つの規則のどちらかで決めます（[`note-draw-window.ts`](../packages/player-web/src/scene/core/note-draw-window.ts)）。

- **LR2 の規則** — `#SCROLL` / `#SPEED` を含まず、`lr2` / `iidx` ruleset で判定する譜面。位置がレーン上端と判定ラインの間にあるオブジェクトを描きます。
- **beatoraja の規則** — 1 以外の `#SCROLL` か `#SPEED` を含むすべての譜面（LR2 はどちらも扱わないため beatoraja を基準にします。値がすべて 1 の譜面は通常の譜面と同じに扱います）と、`beatoraja` ruleset で判定するすべての譜面。beatoraja の `LaneRenderer` と同じく、判定ラインの位置から譜面を順にたどり、最初にレーン上端を越えた位置で打ち切ります。その先は、後の負の `#SCROLL` でレーン内に戻ってくるノートも描きません。

時刻を過ぎたオブジェクトの扱いも異なります。LR2 の規則では、まだ打っていない遅れたノートは判定ラインに達するか判定されるまで残るため、そのノートの位置で始まる STOP の間はライン上に留まります。beatoraja の規則では、ノート・地雷・小節線は判定の有無にかかわらず時刻になった瞬間に消えます（`LaneRenderer` は時刻がまだ先のものだけを描きます）。ロングノートは押しているかどうかにかかわらず終端の時刻が先にある間は残り、始点を過ぎると終端の時刻まで始点を判定ライン上に描きます。これらの規則はスキンではなく譜面と ruleset で決まるため、`beatoraja` ruleset で遊ぶ LR2 スキンでも同じになります。前方向にだけスクロールする譜面では、このような STOP を除いて 2 つの規則の見た目は変わりません。

beatoraja の描画は判定ラインでノートを切り取らないため、負の `#SCROLL` で判定ラインより下に来た、時刻がまだ先のノートはそこに描かれます。be-music も beatoraja の規則ではそうしたノート・地雷・ロングノート・小節線をステージの下端まで描き、LR2 の規則ではライン下に何も描きません。スキンには `y` がレーンの `bottom` より下のオブジェクトとして渡ります（[be-music スキン](./be-music-skin.ja.md)）。

terminal player も、双方向にスクロールする譜面では同じ位置でたどるのを打ち切ります。

beatoraja のプレイスキンも、ノートと小節線を同じ `#SCROLL` / `#SPEED` の距離で置き、どちらかを含む譜面ではノートを beatoraja の規則で描きます（[`scroll-placement.ts`](../packages/player-web/src/scene/beatoraja/scroll-placement.ts)）。それ以外の譜面では拍の差による配置のままです。

## HS-FIX

プレイオプションの HS-FIX は LR2 のボタンをそのまま使い、beatoraja のハイスピード固定（`LaneRenderer.init`）に合わせます。プレイヤーが設定するハイスピードは譜面の基準 BPM（`#BASEBPM`、なければ開始 BPM）での値で、HS-FIX は別の BPM でのスクロールがそれと同じ感覚になるように掛け直します。

| be-music   | ハイスピードを合わせる BPM                                                               | beatoraja                                          |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `OFF`      | なし（スクロールは BPM に従う）                                                          | `OFF` と `STARTBPM`（基準がすでに開始 BPM のため） |
| `MAXBPM`   | 最大 BPM                                                                                 | `MAXBPM`                                           |
| `MINBPM`   | 最小 BPM                                                                                 | `MINBPM`                                           |
| `AVERAGE`  | メイン BPM。最も多くのノートが置かれた BPM（`@be-music/chart` の `resolveChartMainBpm`） | `MAINBPM`                                          |
| `CONSTANT` | 本当の一定スクロールが入るまではメイン BPM                                               | —                                                  |

`AVERAGE` は以前は時間の加重平均でした。BPM × N + STOP のギミックで値が大きく偏り（145 BPM の譜面で約 810、ノートが 5.6 倍遅く流れる）、さらに最後の区間だけ STOP を含む時計で測っていました。メイン BPM は beatoraja が使う値です。同数のときは先に現れる BPM を選びます（beatoraja はハッシュマップの順序で選ぶ）。ノートの大半をギミック用の BPM に置いた譜面（"the life" は 717 ノートを 16,000,160 に置く）では、beatoraja でも be-music でもその BPM がメイン BPM になるので、HS-FIX `OFF` で遊んでください。

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
- `@be-music/player-web/runtime` は platform audio session 用の helper を export します（engine 内部の `WebAudioSession` とは別物です）。`supportsSystemAudioSession`、`getSystemAudioSession`、`applySystemAudioSessionType` は `navigator.audioSession.type` を feature detection して設定し、`applySilentModePlayback(on)` はオンで `'playback'`、オフで `'auto'` を設定します。例外は握りつぶし、API がない環境では何もしません。`AudioContext` の作成・resume より前と、音声を unlock する gesture の中で呼んでください。
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
- リプレイ再生を除く毎プレイでプレイログ（`*.bmplay.json` 入力リプレイ — 解決済み譜面、生の押下/解放列、プレイ設定。[playlog.ja.md](./playlog.ja.md) 参照）を記録します。demo は result scene のマウント時に自動ダウンロードし、Debug Menu の「Library & records」フォルダにある「Auto-save play history」チェックボックス（デフォルト OFF。曲開始時にラッチされ、プレイ中は disabled）で制御します。`bms-playlog` CLI がこのファイルから LR2 / beatoraja / IIDX のリザルトを再現します。プレイログをページへドロップすると、対応する楽曲がロード済みの場合に記録されたランをリプレイ再生します。

## Compatibility boundary

browser player は、この repository の parser、chart、audio-renderer、player、utils、LR2 skin、beatoraja skin package を共有する runtime consumer です。
browser behavior が terminal player と分岐する場合は、pure な path、timing、scroll、lookup、event mapping helper を shared package へ移し、package-local test で覆う方針を優先します。
PixiJS scene wiring は browser rendering や WebAudio resource に依存する場合、`player-web` に残してかまいません。
