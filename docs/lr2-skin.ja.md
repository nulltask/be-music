[English version](./lr2-skin.md)

# LR2 skin 実装メモ

この文書は、現在の `@be-music/skin-lr2` 実装をまとめます。
この package は Lunatic Rave 2 skin file を renderer 非依存の data structure へ parse します。PixiJS rendering は `@be-music/player-browser`、CLI/TUI rendering は `@be-music/player-terminal` の責務です。CLI/TUI は LR2 skin を使用しません。

## 対象範囲

- `@be-music/skin-lr2` は select、decide、play、result、course-result scene の `.lr2skin` CSV file を読み込みます。
- dropped folder や in-memory file map から theme asset を解決します。case-insensitive path、wildcard file reference、TGA / DDS image、DXA archive に対応します。
- skin timing、op condition、source rectangle、destination keyframe、scene 固有の element group を plain TypeScript object として保持します。
- PixiJS object、WebAudio node、browser DOM UI は作成しません。

## シーンモデル

skin kind はスキンの `#INFORMATION` の種類から判定し、宣言がなければ skin path と scene directory から判定します。
play skin は variant ごとにまとめ、browser player が譜面に合う layout を選べるようにします。

- `5`
- `7`
- `9`
- `10`
- `14`

LR2 には鍵盤モード用の play skin がないため、`24` / `48` KEY の譜面は `7` / `14` の play skin を借ります（`play-skin.ts` の `PLAY_SKIN_FALLBACKS`）。frame、gauge、judge の画像は skin が、レーンはホストのフォールバック playfield が描きます。

parser は select、decide、play、result、course-result data を 1 つの `LR2Skin` shape に保持します。
consumer は scene に必要な field だけを読みます。

## HD の座標系と素材

ブラウザーの Gameplay は、ノーツ・小節線・BGA・レーンカバー・エフェクトを含むすべてのレイヤーをスキンの設計座標で描き、キャンバス全体を一度だけ画面に合わせて拡縮します。HD スキンを固定の 640×480 のプレイ領域に縮小する処理は不要になります。スクロール距離とリプレイの表示時間にも同じ座標スケールを使います。

`#RESOLUTION,0` / `1` / `2` / `3` は 640×480 / 1280×720 / 1920×1080 / 3840×2160 を指定します。拡張の `#RESOLUTION,width,height` も受け付けます。指定がない場合や無効な場合は、座標から自動判定します。`#INFORMATION` のプレイ種別は 0=7KEY、1=5KEY、2=14KEY、3=10KEY、4=9KEY で、読み込み時のキーモード条件にも選択したスキンの種別を反映します。

画像とビットマップフォントは、ディレクトリを含むパスの末尾が最も長く一致する素材を優先します。単独配布の `LITONE4/` フォルダーでも元の `LR2files/Theme/LITONE4/…` 参照を保持でき、Play と Result の同名素材を取り違えません。DXA は引き続き自動展開します。

`#IMAGE,CONTINUE` と `#LR2FONT,CONTINUE` は前の画面の同じ番号の素材を引き継ぎます。`LR2Skin.resources` に有効な画像・フォントの一覧が入り、次の画面の読み込み時に `LoadLR2SkinOptions.resources` に渡せます。テーマローダーは Select → Decide → Play → Result → CourseResult の順に素材を引き継ぎ、プレイスキンの各種別は個別に読み込みます。画面ごとのスキンの組み合わせや種別を変更するアプリは、実際の前画面の素材を `loadSkin` に指定できます。

提供された LITONE4 (1080p) と WMIX_HD_set_0321 は、それぞれ 1920×1080 と 1280×720 のレイアウトを持ちます。配布ファイル自体はリポジトリに含めません。第三者製スキンのすべての挙動の再現には、各 LR2 命令と実行時機能の対応も必要です。

## Destination の制御とプレイ中の表示

`#DST_*` の先頭行が、要素全体のループ位置・タイマー・表示条件・ターンテーブルの回転指定を決めます。後続行は形状・色・不透明度を変化させ、制御列に明示的な `0` があっても先頭行の指定をリセットしません。spdframe の導入アニメーションが再実行され、プレイ中にレーン枠や読み込み表示がちらつく問題を防ぎます。

`LR2PlayFrame.judgments` には、各サイドの直前の判定を任意で渡せます。`resolveLR2PlayState` は op 241–246・261–266 を公開し、LITONE4 などの判定色付きレーザーを制御します。ブラウザーのビューはキーオンのタイマー 100–119 とキーオフのタイマー 120–139 を接続し、キーを離すとスキンが定義した消灯アニメーションに切り替えます。小節線はノートのタイミング基準からの指定位置と表示条件を反映します。

ビットマップフォントは TGA・DDS・ブラウザーが扱える画像シートを混在させられます。PNG は共通のバイト列デコーダーで読み込み、拡張子のない Blob URL が原因で読み込みに失敗することを防ぎます。未対応文字の代替表示にも文字全体と同じフェードを適用します。

要求されたキー構成のスキンがないときは、SP 譜面には SP、DP 譜面には DP のスキンを優先してから反対側のレイアウトを借ります。spdframe は 640×480、WMIX_HD は 1280×720、提供された LITONE4 は 1920×1080 の座標系です。これらの配布物はローカルでの互換性確認に使い、Be-Music には同梱しません。

## コース

LR2 には、コース全体の結果を出す専用のシーンがあります。`#INFORMATION` の type 15 で、慣例では `CourseResult/` の下に置きます。`loadLR2ThemeSkinsFromFiles` はこれを `courseResultSkin` として読み込み、コース結果用のジングルも読みます。`result` の検索がこのスキンを選ぶことはありません。

LR2 は BGM とシステムサウンドを、各ファイルを名指しするサウンドセット `LR2files/Sound/*.lr2ss` から探します。標準の `lr2.lr2ss` は `#COURSECLEAR` / `#COURSEFAIL` を `Sound/lr2/course_clear.wav` / `course_fail.wav` に割り当てています。`loadLR2ThemeSkinsFromFiles` は、ドロップされたサウンドセット（`lr2.lr2ss` を優先）から選曲 / 決定の BGM、クリア / 失敗 / コースのジングル、カーソル・フォルダ・オプションの音を読みます。`*` のフォルダは `#CUSTOMFILE` の既定値で埋め、名指しされたファイルがなければ別の音声拡張子のものを使います。サウンドセットがないときや、ファイルを名指ししていない（または名指ししたファイルがドロップにない）ときは、`Sound/lr2/` の下をステム名で探し（コースのジングルは `course_clear` か `courseclear`）、選曲 / 決定の BGM は `BGM/` フォルダの下を探します。汎用の `result` のジングルはサウンドセットにコマンドがなく、いつも `Sound/lr2/` から取ります。

LR2 はシーンが始まるたびにスキンを読み込むので、`#IF` ブロックはシーンの間ずっと変わらない状態を条件にできます。コースでは、それがコースの op です（OpenLR2 `LR2f.cpp` L5403-L5444）。

| op              | `LR2_OP`                                            | 意味                                                |
| --------------- | --------------------------------------------------- | --------------------------------------------------- |
| 280-288         | `COURSE_STAGE1`-`COURSE_STAGE9`                     | 1〜9 ステージ目を遊んでいて、最後のステージではない |
| 289             | `COURSE_STAGE_FINAL`                                | 最後のステージ                                      |
| 290             | `COURSE`                                            | コース（選択中のバー、または遊んでいるコース）      |
| 291 / 292 / 293 | `COURSE_NONSTOP` / `COURSE_EXPERT` / `COURSE_GRADE` | コースの種類：NONSTOP / EXPERT / GRADE              |

テーマは、これらの op をオフにした状態で一度だけ解析します。`LR2ThemeSkins.loadSkin({ kind, playVariant, parseOps })` は、読み込み済みのファイルからスキンの 1 つを解析し直します。そのとき `#IF` / `#ELSEIF` の評価中は、追加の op を真として扱います（`LoadLR2SkinOptions.parseOps`）。`pickLR2PlaySkinVariant` は譜面を遊ぶプレイスキンの variant を返すので、ホストはコースのステージ用にそのスキンを解析し直せます。

コース用スキンが読む値（数値 250-259、テキスト 150-170、104 / 105 のコースのコンボ）はシーンの状態です。[`@be-music/skin-lr2/state`](#シーンの状態) がコースの `CourseView` から求めます。`CourseView` はホストが作り（`@be-music/player-scene-model` の `resolveCourseView`）、`@be-music/player-browser` のシーンに渡します。[コースと段位認定](./player-web.ja.md#コースと段位認定) を参照してください。

## 番号表

スキンはエンジンの状態を番号で指します。`#DST_*` の行や `#IF` の op、その行が従う `timer`、`#SRC_NUMBER` の `num`、`#SRC_TEXT` の `st`、`#SRC_BUTTON` と `#SRC_SLIDER` の `type`、`#SRC_BAR_BODY` と `#SRC_BAR_LAMP` の番号、実行時に結び付ける画像の `gr` です。`@be-music/skin-lr2/ids` はこれらに種類ごとの表で名前を付け、各項目に意味を、節の見出しにそれを設定・参照する画面を書いています。

| 表                                    | 名前を付けるもの        | 節                                                                                                                                                           |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LR2_OP`                              | op（`dst_option`）      | 選択中のバー、プレイオプション、読み込みとリプレイ、リザルトの結果、自己ベスト、譜面、プレイ中のランク・ゲージ・判定、コース、リザルトのランク、コースの作成 |
| `LR2_TIMER`                           | `timer`                 | 全シーン、選曲（バーの一覧、パネル、コースの作成）、プレイ（READY、ゲージ、判定、フルコンボ、レーンのタイマー列、リズム）、リザルト                          |
| `LR2_NUM`                             | `#SRC_NUMBER` の `num`  | オプションと時刻、プレイヤーの累計、選択中の譜面、プレイ中のスコア、リザルトの更新前後、コースのステージのレベル                                             |
| `LR2_TEXT`                            | `#SRC_TEXT` の `st`     | 曲の情報、検索語、スキン、オプションパネルの表示、コース                                                                                                     |
| `LR2_BUTTON`                          | `#SRC_BUTTON` の `type` | パネル、バーの一覧とプレイ、プレイオプション、コースの作成                                                                                                   |
| `LR2_SLIDER`                          | `#SRC_SLIDER` の `type` | バーの一覧の位置、ハイスピード、レーンカバー、プレイの進み                                                                                                   |
| `LR2_BAR_BODY` / `LR2_BAR_BODY_KINDS` | `#SRC_BAR_BODY` の番号  | バーの種類と、解析後の `LR2BarBodyKind`                                                                                                                      |
| `LR2_BAR_LAMP` / `LR2_BAR_LAMP_KINDS` | `#SRC_BAR_LAMP` の番号  | クリアランプと、解析後の `LR2BarLampKind`。ランプの op 100-105 も同じ順                                                                                      |
| `LR2_GR`                              | `gr`                    | LR2 が実行時に結び付ける画像（STAGEFILE、BACKBMP、BANNER、スキンのサムネイル、黒、白）                                                                       |

短い範囲は番号ごとに名前を付けます（コースのステージ 280-289、パネルの op 20-29 とパネルのボタン 1〜9、NONSTOP のつなぎ）。長い範囲は最初の番号だけを持ちます。レーンのタイマー列（`LR2_TIMER.BOMB_1P`、`LN_HOLD_1P`、`KEY_ON_1P`、`KEY_OFF_1P` とその 2P 側）はスクラッチのタイマーで、`LR2_LANE_TIMER_BANK_SIZE` 本のレーンのうち鍵盤 N は `+ N` です。`LR2_OP.COURSE_STAGES_OVER + N`、`COURSE_SONGS_ADDED + N`、`COURSE_STAGE_DIFFICULTY + 10 × i + 難易度` はコースの作成とステージの難易度の op です。

番号は標準スキンの説明と OpenLR2 に従い、両者が食い違うところは `LR2body.exe` に従います。292 が EXPERT、293 が GRADE です（標準スキンの説明は逆です）。op 571 は意図どおりコースを作っている間だけ立てます。バイナリでは 572 に抜け落ち、どちらでも立ちます。

標準スキンの説明ではっきりしないところは、OpenLR2 の `LR2_skinobject.cpp`（`GetOptionFlag_dst`、`SetObjectValue_Num`）と `ProcS_Select` に従います。op 20 はオプションパネルがどれも開いていない間、21-29 はパネル 1〜9 が開いている間に立ちます。op 53 は EXTRA MODE です。数値 102 は判定済みのノーツに対するスコアレート（プレイ中の値）、115 は全ノーツに対するレートです。テキスト 16 / 26 は LR2 の楽曲データベースにある譜面のタグです（`LR2_TEXT.TAG`。beatoraja はここにアーティストとサブアーティストを描きます）。

[#430](https://github.com/nulltask/be-music/issues/430) で確度が低いとした番号も、同じソースと `SaveResult`、`ProcI_Result` で確かめました。

- op 1 はフォルダのバー（LR2 のフォルダ、レベルフォルダ、カスタムフォルダ）で立ちます。op 34 は GHOST がオフのときで、判定が自動のときも立ちます。be-music にはゴーストがないので、常に立ちます。op 400-402 はキーコンフィグ画面のページ（7 / 14、9、5 / 10 KEYS）で、その後の画面でもそのまま残ります。op 999 は 900-998 と同じ `#CUSTOMOPTION` の op です。
- op 200-207 は、判定済みのノーツに対する EX スコアのランク（`exscore × 9 / (判定済みノーツ × 2)`）で、最初のノーツが判定されるまではどれも立ちません。
- 数値 38-41 はプレイをまたいだプレイヤーの連続コンボ、その最長、LR2 のトライアルレベル（プレイのミッションの段階）とその一つ下です。92-94 はインターネットランキングの順位、人数、クリア率です。150-153 は、プレイのこの時点での自己ベストとターゲットの EX スコア（LR2 のペースメーカー）と、EX スコアとそれぞれとの差です。
- 数値 109 と 154 は次の DJ ランクまでの差です。EX スコアから、全ノーツに対する次のランクの境界 `floor(ノーツ × 2 × (ランク + 1) / 9)` を引きます。境界に届くまでは負の値で、F は E まで、AAA は満点までを数えます。
- 自己ベストのレート（73、85-89）は整数の百分率で、切り捨てます。
- テキスト 20-29 は LR2 のタグ編集で書き換える欄です。20-28 はリザルト以外のどの画面でも 10-18 を繰り返し、リザルトでは LR2 がテキスト 20 をインターネットランキングのメッセージに使います。テキスト 18 / 28 は `#DIFFICULTY` の番号（0-5）で、op 150-155 がその名前に当たります。テキスト 29 は LR2 の ex レベルで、プレイヤーが楽曲データベースに設定するレベルです。LR2 はテキスト 10-29 を選曲画面で設定し、決定・プレイ・リザルトでもそのまま保ちます。

beatoraja は LR2 互換の番号を LR2 と同じ値で持つので、`@be-music/skin-beatoraja` はそれらを自分の名前のままこの表から取り（`BEATORAJA_OP.FOLDERBAR` は `LR2_OP.FOLDER_BAR`、`TIMER_READY` は `LR2_TIMER.READY`）、beatoraja 独自の番号だけを自分で持ちます。beatoraja にとって別の意味を持つ LR2 の番号もいくつかあり、それは beatoraja 自身の表が名前を付けます。数値 92 はメイン BPM（`BEATORAJA_NUM.MAINBPM`）、op 400 は CONSTANT のオプション（表では名前を付けておらず、立てるものもありません）で、beatoraja には数値 38-41・93-94 とテキスト 17-29 がありません。parser の解析時の op と `@be-music/player-browser` の LR2 ファミリーのビュー（`view/lr2/`）もこの表を使います。

ここで名前を付けないもの：op 900-999（スキン独自の `#CUSTOMOPTION`）、`#SRC_BARGRAPH` の種類、`#DST_*` の欄の小さな列挙（`blend`、`center`、`acc`。`skin/lr2/render.ts` が読むところで対応付けます）。

## シーンの状態

`@be-music/skin-lr2/state` は、`@be-music/player-scene-model` のシーンモデル（[シーンモデル](./scene-model.ja.md)）を [番号表](#番号表) に対応付けます。画面ごとに、どの op が立つか、各数値とテキストに何を描くか、各スライダーをどこに置くか（`LR2SceneState`。選曲画面の `LR2SelectState` は各ボタンのどのセルを描くかも返します）、選曲画面とプレイ画面のある瞬間にどのタイマーを始め、どれを止めるか（`LR2TimerUpdate`：始めるタイマーとその開始時刻、止めるタイマー）、そして決定画面とリザルト画面のある瞬間にどのタイマーが動いているか（`resolveLR2DecideTimers`、`resolveLR2ResultTimers`：動いている各タイマーとその開始時刻）とリザルトのグラフをどこまで描くか（`resolveLR2GraphReveal`）を返します。スキンファミリーのビューは、スキンが描く番号をこの状態に問い合わせます。ビューが持つのは、自分で刻むタイマーの番号とレーンの番号だけです。

```mermaid
flowchart LR
  subgraph models["@be-music/player-scene-model"]
    entry["LibraryEntry<br/>PlayOptions"]
    play["PlayState"]
    result["PlayResult"]
    course["CourseView"]
  end
  subgraph state["@be-music/skin-lr2/state"]
    select["resolveLR2SelectState"]
    decide["resolveLR2DecideState"]
    playing["resolveLR2PlayState"]
    results["resolveLR2ResultState"]
    timers["resolveLr2…Timers"]
  end
  ids["LR2SceneState<br/>op · 数値 · テキスト<br/>スライダー"]
  starts["LR2TimerUpdate<br/>タイマー → 開始時刻"]

  entry --> select
  play --> playing
  result --> results
  course --> state
  select --> ids
  decide --> ids
  playing --> ids
  results --> ids
  timers --> starts
```

| 関数                                                        | 受け取るもの                                                                                                                                        | 返すもの                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `resolveLR2SelectState`                                     | カーソルの下のバー（`LibraryEntry`）、`PlayOptions`、記録のランプ、開いているパネル、スキンのカスタムオプション、画面の事実                         | op、数値、テキスト、スライダー、ボタンのセル                                       |
| `resolveLR2SelectButton`                                    | `#SRC_BUTTON` の type                                                                                                                               | ボタンが求めること：パネル、ハイスピードの増減、オプションの切り替えや設定、プレイ |
| `resolveLR2SelectTimers`                                    | 画面の表示、カーソルの移動、パネルの開閉、コースの作成の開始と終了                                                                                  | タイマー 0、10-13、17 / 18、21-29、31-39                                           |
| `pickLR2BarBody`、`resolveLR2BarLevel`、`resolveLR2BarLamp` | 一覧のバー、その譜面、記録のランプ                                                                                                                  | バーに描くボディ、レベル、ランプ                                                   |
| `resolveLR2DecideState`                                     | これから遊ぶ譜面と、そのコース                                                                                                                      | op、テキスト、コースの数値                                                         |
| `resolveLR2PlayState`                                       | プレイの準備（`LR2PlaySetup`：譜面、レーン、特徴、オプション、ゲージ、コース）と 1 フレーム（`LR2PlayFrame`：`PlayState` の表示設定、スコア、時刻） | op、数値、テキスト、スライダー、バーグラフ                                         |
| `resolveLR2PlayTimers`、`resolveLR2LaneTimer`               | プレイの瞬間（シーンの段階、判定、フルコンボ、ゲージ、レーン、シーク）、レーン                                                                      | タイマー 0、2、3、40-42、44、46-49、レーンのタイマー列 50-139                      |
| `resolveLR2ResultState`                                     | `PlayResult`、そのコース、遊んだスキンの `#FLIPRESULT`、スキンのカスタムオプション                                                                  | op、数値、テキスト、スライダー、バーグラフ                                         |
| `resolveLR2CourseOps`、`resolveLR2CourseText` など          | `CourseView`、作成中のコース                                                                                                                        | コースの op・数値・テキスト、コース作成の op・テキスト・ボタン                     |

これらの関数は純粋で決定的です。クロックも DOM もレンダラーも読まず、乱数も引かず、import するのはシーンモデル、エンジンのルール、譜面モデル、番号表、解析したスキンの型だけです。時刻は入力として受け取ります。クロックの数値は `LR2Clock` で、プレイの時刻はフレームで、各タイマーの開始は瞬間の `at` で渡します。`pnpm run check` は `src/state/` に、実行環境に依存しないこととクロックを読まないことの lint 規則を課します。Web ランタイムの LR2 ファミリーのビュー（`view/lr2/`。選曲画面、決定画面、プレイ画面、リザルト画面のもの）がこれらを呼びます。

LR2 のプレイビュー（`@be-music/player-browser` の `view/lr2/play-view.ts`）は、プレイの op、数値、テキスト、スライダー、バーグラフを、フレームごとに `resolveLR2PlayState` で読みます。渡すのはフレームの `PlayState`、スコア、時刻、スコアの表示値、BPM、フレームレートです。プレイのタイマーは、フレームごとのきっかけから `resolveLR2PlayTimers` で始めて止め、一度きりのものはビュー自身のタイマー管理が終わらせます。

| きっかけ                            | タイマー                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| シーンの開始                        | 0 と 1（`#STARTINPUT` のあと）                                                |
| 読み込みの終わり、譜面の開始        | 40（READY）、41                                                               |
| プレイの終わり（最後まで、ESC、F5） | 2（`#FADEOUT`）                                                               |
| プレイの失敗（ゲージが尽きた）      | 3（`#CLOSE`）のみ                                                             |
| 片側の判定                          | 46 / 47。判定ごとに始め直す                                                   |
| フルコンボ                          | 48 と 49。スキンの演出が終わるまで                                            |
| ゲージの上昇、100 % への到達        | 42 は上昇の演出が終わるまで。44 は 100 % を下回るまで                         |
| レーンのボム                        | そのレーンのボムのタイマー（50-69）。プレイフィールドがボムを消すまで         |
| レーンでロングノートを押している間  | そのレーンのホールドのタイマー（70-89）。離したあと、その長さでフェードアウト |

キーオンの組（100-119）はプレイのセッションのキービームを映します。セッションはどの種類のキービームもチャンネルごとに持ち（`keyBeamStartedAt`、`keyBeamFadeStartedAt`）、LR2 のビューは点いているチャンネルをそれぞれのキーオンのタイマー（`resolveLR2LaneTimer('key-on', …)`）に対応させます。レーンの番号とタイマーの番号は LR2 のビューの中にとどめ、セッションと共有のプレイフィールドはチャンネルで扱います。

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

`loadLR2SkinFromSourceFiles()` は source file collection を受け取り、現在の skin file から相対 path を解決します。
resolver は LR2 風の path separator を normalize し、実際の LR2 theme でよくある path casing の揺れに備えて case-insensitive lookup を行います。

resolver は LR2 theme が使う wildcard asset reference も扱います。
asset が DXA archive 内にある場合、DXA reader が archive entry を同じ lookup path へ露出します。
TGA image は `tga.ts`、DDS image は `dds.ts` でデコードします（ブラウザは DDS をデコードできないため、browser player がこれを `.dds` のデコーダとして登録します）。bitmap font は `#LR2FONT` declaration を元に `font.ts` で準備します。

## Browser player での利用

`@be-music/player-browser` は次のファミリーのビューで parsed skin model を使用します。

- `view/lr2/select-view.ts`（`select-bars.ts` とともに）
- `view/lr2/decide-view.ts`
- `view/lr2/play-view.ts`（`play-elements.ts`、`play-timers.ts`、`play-turntable.ts`、`play-hud.ts` とともに）
- `view/lr2/result-view.ts`

`skin/lr2/render.ts` と `skin/lr2/scene-render.ts` の共有 helper は destination keyframe、op-gated visibility、source cell、sprite transform、text、number、slider、bargraph を評価します。
ビューは [シーンの状態を求める関数](#シーンの状態) を通して op を立て、タイマーを始め、数値・テキスト・ボタン・スライダーを解決します。
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
- system font rendering は browser renderer 側の責務です。`@be-music/skin-lr2` は宣言された font metadata だけを保持します。
- PixiJS texture upload、video BGA playback、WebAudio system sound、DOM text input overlay など renderer 固有の挙動はこの package の外にあります。
- シーンの状態が LR2（OpenLR2）とまだ違うところ。どれも be-music にまだないデータや画面が要ります。
  - プレイヤーの累計（数値 30-41）は 0 です。プレイの履歴を保っていません。
  - インターネットランキングは何も読みません。数値 92-94 と、リザルト画面のテキスト 20 のメッセージです。
  - ペースメーカーは 0 です。数値 150 / 151 は 0、152 / 153 は EX スコアを読みます。自己ベストのゴーストもターゲットもプレイに届いていません。
  - テキスト 29 は、LR2 がデータベースに保つ ex レベルの代わりに、INSANE の譜面のプレイレベルを読みます。
  - リザルト画面のバーグラフとスライダーは、LR2 のバーグラフの種類（1 進み、2 読み込み、10-15 EX スコア・自己ベスト・ターゲット）ではなく独自の番号で読みます。LR2 の種類はプレイを自己ベストやターゲットと比べますが、リザルトはそれらをまだ持っていません。
  - リザルト画面の op 400-402 は譜面のキーモードに従い、ほかの画面では立てません。そのページに従えるキーコンフィグ画面がありません。
