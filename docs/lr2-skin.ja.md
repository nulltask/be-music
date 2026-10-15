[English version](./lr2-skin.md)

# LR2 skin 実装メモ

この文書は、現在の `@be-music/lr2-skin` 実装をまとめます。
この package は Lunatic Rave 2 skin file を renderer 非依存の data structure へ parse します。PixiJS rendering は `@be-music/player-web`、CLI/TUI rendering は `@be-music/player-tui` の責務です。CLI/TUI は LR2 skin を使用しません。

## 対象範囲

- `@be-music/lr2-skin` は select、decide、play、result scene の `.lr2skin` CSV file を読み込みます。
- dropped folder や in-memory file map から theme asset を解決します。case-insensitive path、wildcard file reference、TGA / DDS image、DXA archive に対応します。
- skin timing、op condition、source rectangle、destination keyframe、scene 固有の element group を plain TypeScript object として保持します。
- PixiJS object、WebAudio node、browser DOM UI は作成しません。

## シーンモデル

skin kind は skin path と scene directory から判定します。
play skin は variant ごとにまとめ、browser player が譜面に合う layout を選べるようにします。

- `5`
- `7`
- `9`
- `10`
- `14`

LR2 には鍵盤モード用の play skin がないため、`24` / `48` KEY の譜面は `7` / `14` の play skin を借ります（`play-skin.ts` の `PLAY_SKIN_FALLBACKS`）。frame、gauge、judge の画像は skin が、レーンはホストのフォールバック playfield が描きます。

parser は select、decide、play、result data を 1 つの `Lr2Skin` shape に保持します。
consumer は scene に必要な field だけを読みます。

## コース

LR2 には、コース全体の結果を出す専用のシーンがあります。`#INFORMATION` の type 15 で、慣例では `CourseResult/` の下に置きます。`loadLr2ThemeSkinsFromFiles` はこれを `courseResultSkin` として読み込み、テーマの `Sound/` フォルダからコース結果用のジングル `courseclear` / `coursefail` も読みます。`result` の検索がこのスキンを選ぶことはありません。

LR2 はシーンが始まるたびにスキンを読み込むので、`#IF` ブロックはシーンの間ずっと変わらない状態を条件にできます。コースでは、それがコースの op です（OpenLR2 `LR2f.cpp` L5403-L5444）。

| op              | 意味                                                |
| --------------- | --------------------------------------------------- |
| 280-288         | 1〜9 ステージ目を遊んでいて、最後のステージではない |
| 289             | 最後のステージ                                      |
| 290             | コース（選択中のバー、または遊んでいるコース）      |
| 291 / 292 / 293 | コースの種類：NONSTOP / EXPERT / GRADE              |

テーマは、これらの op をオフにした状態で一度だけ解析します。`Lr2ThemeSkins.loadSkin({ kind, playVariant, parseOps })` は、読み込み済みのファイルからスキンの 1 つを解析し直します。そのとき `#IF` / `#ELSEIF` の評価中は、追加の op を真として扱います（`LoadLr2SkinOptions.parseOps`）。`pickLr2PlaySkinVariant` は譜面を遊ぶプレイスキンの variant を返すので、ホストはコースのステージ用にそのスキンを解析し直せます。

コース用スキンが読む値（数値 250-259、テキスト 150-170、104 / 105 のコースのコンボ）はシーンの状態で、`@be-music/player-web` が渡します。[コースと段位認定](./player-web.ja.md#コースと段位認定) を参照してください。

## 解析済み directive

実装済み directive:

- `#INFORMATION`, `#ENDOFHEADER`
- `#INCLUDE`
- `#IMAGE`
- `#LR2FONT`
- `#FONT`
- `#CUSTOMOPTION`
- `#CUSTOMFILE`
- `#SETOPTION`
- `#SCRATCH`
- `#STARTINPUT`
- `#LOADSTART`
- `#PLAYSTART`
- `#CLOSE`
- `#RELOADBANNER`
- `#RESOLUTION`, `#TRANSCOLOR`, `#FADEOUT`, `#SKIP`, `#LOADEND`
- `#FLIPSIDE`, `#FLIPRESULT`, `#DISABLEFLIP`
- `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`

実装済み element family:

- `#SRC_IMAGE` / `#DST_IMAGE` による image element
- number、text、slider、bargraph、button、mouse cursor element
- play scene の BGA、groove gauge、judge line、measure line、judge/combo effect、key-on effect、LN hold effect、bomb
- play scene のノート画像: `#SRC_NOTE`、`#SRC_LN_START` / `#SRC_LN_BODY` / `#SRC_LN_END`、`#SRC_MINE` と、そのオートプレイ用 `#SRC_AUTO_*`
- `#SRC_README` / `#DST_README` と `#SRC_ONMOUSE` / `#DST_ONMOUSE` element
- select scene の bar body、title、level、lamp、my lamp、rival / rival lamp、rank、flash、cursor、click target
- result scene の gauge chart と score chart
- `STAGEFILE`、`BACKBMP`、`BANNER`、skin thumbnail、black、white の LR2 special graphic

## アセット解決

`loadLr2SkinFromSourceFiles()` は source file collection を受け取り、現在の skin file から相対 path を解決します。
resolver は LR2 風の path separator を normalize し、実際の LR2 theme でよくある path casing の揺れに備えて case-insensitive lookup を行います。

resolver は LR2 theme が使う wildcard asset reference も扱います。
asset が DXA archive 内にある場合、DXA reader が archive entry を同じ lookup path へ露出します。
TGA image は `tga.ts`、DDS image は `dds.ts` でデコードします（ブラウザは DDS をデコードできないため、browser player がこれを `.dds` のデコーダとして登録します）。bitmap font は `#LR2FONT` declaration を元に `font.ts` で準備します。

## Browser player での利用

`@be-music/player-web` は次の scene module で parsed skin model を使用します。

- `scene/lr2/select.ts`
- `scene/lr2/decide.ts`
- `scene/lr2/gameplay.ts`
- `scene/lr2/result.ts`

`skin/lr2/render.ts` と `skin/lr2/scene-render.ts` の共有 helper は destination keyframe、op-gated visibility、source cell、sprite transform、text、number、slider、bargraph を評価します。
browser player は song metadata、current judge、combo、gauge、score、BGA texture、play option、result history などの runtime value を parsed skin element へ結び付けます。

## 互換性の境界

parser は意図的に permissive です。
有用な object を作れない malformed element line は skip し、skin の残りは読み込み続けます。
これは、壊れた任意 asset 1 つで browser player 全体を止めないための LR2 theme loading 向け方針です。

検証済みとして扱うのは Lunatic Rave 2 default skin set のみです。
他の LR2 skin も読み込み自体は可能ですが、細かな layout 差、未実装の animation detail、未対応の button behavior が残る場合があります。

## 既知の未対応

- parser は LR2 の全 directive と全 `button_type` を実装しているわけではありません。
- `#CUSTOMOPTION` と `#CUSTOMFILE` は parse して公開しますが、user-facing な option persistence は host application の責務です。
- system font rendering は browser renderer 側の責務です。`@be-music/lr2-skin` は宣言された font metadata だけを保持します。
- PixiJS texture upload、video BGA playback、WebAudio system sound、DOM text input overlay など renderer 固有の挙動はこの package の外にあります。
