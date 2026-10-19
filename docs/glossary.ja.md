[English version](./glossary.md)

# 用語集

この文書は、`be-music` の仕様書と実装で使う用語を定義します。
一般的な BMS/BMSON 用語にできるだけ沿いつつ、**このリポジトリでどう扱うか**を優先します。

## 用語運用ルール

- **chart** は、譜面ファイルや再生・選択・保存の単位を指す既定語です。
- **music / 曲 / 楽曲** は、タイトルとアーティストで人間が認識する作品単位です。1 つの music に複数の chart が属することがあります。
- **song** は、このリポジトリの既定語ではありません。`song.mid`、`bemuse-song.json`、`songs[]` のような外部仕様名やファイル名をそのまま参照するときに使います。
- **Music Select** は画面名です。この画面で選択・復元する単位は chart です。
- 選曲画面が一覧するライブラリでは、chart は **ライブラリの譜面**（`LibraryChart`）です。譜面のバーは `{ kind: 'chart', chart }`、フォルダは `charts` を並べ、コースのステージは `chart` を指します。公開の名前の一部はまだ song のままです（`PlayResult.song`、`BrowserSongCollectionStore`、`BrowserSongAssetSource`、スキン SDK の `songRecord`、`BeMusicSongRecord`、`resolveSongStats`）。新しい名前は chart を使います。

## 譜面とリソース

- **BMS**: Be-Music Source 系のテキスト譜面形式です。`#TITLE`、`#WAVxx`、`#mmmcc:...` のようなヘッダ行とオブジェクト行で構成します。
- **bmson**: JSON ベースの譜面形式です。`info`、`sound_channels`、`bga`、`lines` などの構造を持ちます。
- **チャート (chart)**: 1 つの譜面ファイル、またはその再生単位です。Music Select では 1 entry が 1 chart に対応します。
- **メタデータ (metadata)**: 曲名、アーティスト、ジャンル、コメント、`#STAGEFILE`、`#BACKBMP`、`#BANNER` など、譜面本体以外の付加情報です。
- **リソース (resource)**: 譜面や skin から参照される音声、画像、動画、テキストなどの外部ファイルです。
- **keysound**: ノートや BGM の発音に使う音声リソースです。BMS では主に `#WAVxx`、bmson では `sound_channels` が対応します。
- **preview**: Music Select で再生する短い試聴音です。`#PREVIEW` や bmson の `info.preview_music` を優先して使います。
- **BGA**: gameplay 中に表示する背景画像/動画です。base、layer、layer2、POOR などの cue を持ちます。
- **POOR BGA**: `POOR` 判定時に表示する専用 BGA です。譜面側で定義されている場合だけ使います。
- **STAGEFILE**: chart 選択後の loading screen に表示する画像です。gameplay 中の BGA とは別用途です。
- **BACKBMP**: BMS `#BACKBMP` または bmson の back-image metadata から解決する skin special graphic slot です。browser LR2 / beatoraja scene は chart imagery として解決できます。
- **BANNER**: Music Select に表示する横長画像です。BMS では `#BANNER`、bmson では `info.banner_image` を使います。

## 再生と判定

- **チャネル (channel)**: 譜面上の source-level lane または event 識別子です。BMS の `11`、`16`、`54` のような値や、bmson の `notes.x` などが元になります。
- **レーン (lane)**: runtime が実際に入力・描画・判定を行う単位です。source-level channel を chart mode に応じて lane へ割り当てます。
- **scratch**: スクラッチ用レーンです。SP では `16`、DP では `16` と `26` が対応します。
- **FREE ZONE**: `17` / `27` を使う特殊ノートです。9KEY 以外では scratch レーンに重ねて描画し、通常の score/gauge 対象からは外します。
- **小節 (measure)**: 譜面上の区切りです。BMS の `#mmmcc` の `mmm` や、IR の `measure` が対応します。
- **beat**: 小節長を正規化した譜面上の時間単位です。`@be-music/chart` と player runtime は beat を基準に時刻や表示位置を計算します。
- **BPM**: 1 分あたりの拍数です。譜面の時間進行を決めます。
- **STOP**: 一定時間だけ譜面時間を停止するイベントです。見た目と判定時刻の両方に影響します。
- **SCROLL**: ノートの見た目の流れ方を変える係数です。判定時刻ではなく表示位置に影響します。
- **SPEED**: `SCROLL` と組み合わせて使う、補間付きの視覚距離係数です。
- **ロングノート (long note / LN)**: 始点と終点を持つノートです。保持、離し、終点到達の扱いは `LNMODE` に依存します。
- **LNOBJ**: BMS の `#LNOBJ` で宣言する long note 終端オブジェクトです。
- **LNMODE**: BMS long note の判定確定ルールです。`1`、`2`、`3` で終点判定や hold break 時の扱いが変わります。
- **地雷 (mine)**: 押すとダメージを受けるノートです。LR2 に合わせ、レーンを押したまま判定線を通過するか、`PGREAT` 窓内で押すと爆発します。爆発は譜面値ベースの gauge damage を与えるだけで、判定にはなりません。
- **判定 (judge)**: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` の結果です。score、combo、gauge へ影響します。
- **FAST / SLOW**: 判定タイミングの早押し/遅押しの補助表示です。現行実装では `GREAT` と `GOOD` のみ集計します。
- **EX-SCORE**: IIDX 互換のスコアです。一般に `PERFECT=2`、`GREAT=1`、それ以外 `0` で集計します。
- **SCORE**: 20 万点満点へ正規化した通常スコアです。
- **groove gauge**: クリア判定に使うゲージです。shared core の既定は LR2 互換の `GROOVE` (`NORMAL`) で、export された helper は browser play option 向けに `HARD`、`DEATH`、`EASY` も扱います。
- **HIGH-SPEED**: ノート表示密度を変えるユーザー設定です。譜面の時刻自体は変えません。
- **MANUAL / AUTO SCRATCH / AUTO**: 再生モードです。`MANUAL` は手動、`AUTO SCRATCH` は scratch だけ自動、`AUTO` は全自動です。
- **制御構文 (control flow)**: BMS の `#RANDOM`、`#IF`、`#SWITCH` などの分岐命令です。parser は保持し、ホストが再生/レンダリング前に、明示的な `RandomDraws` でプレイごとに 1 回解決します。
- **RandomDraws**: 1 回のプレイでの譜面の制御構文の結果です。`#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` の行ごとにファイル順で 1 項目（コマンド、range、value）を持ちます。`drawRandomOutcomes` で 1 回引き、resolver、エンジン、プレイログで共有します。
- **Source 層 / Resolved 層**: 譜面を読む 2 つの層です。Source 層（`BeMusicJson`）はファイルに書いてあること、Resolved 層（`@be-music/chart` の `resolveChart` が作る `ResolvedChart`）は、フォーマットの既定値と de facto の規則をすべて適用した、プレイヤーが演奏するものです。[アーキテクチャ](./architecture.ja.md) を参照してください。

## Runtime Package

- **player core**: `@be-music/player` の共有の規則と engine です。パッケージのルートは engine（`manualPlay`、`autoPlay`）で、解決済みの譜面からプレイを準備して判定し、UI / audio / input の runtime 契約を持ちます。ほかの入口は規則（`./ruleset`、`./course`、`./records`、`./playlog`）と、ホストがプレイと共有するもの（`./signals`、`./lanes`、`./display`）です。timing、ノートの解決、timeline は `@be-music/chart` にあります。
- **terminal player**: `@be-music/player-tui` の CLI / TUI frontend です。core engine の上に Music Select、terminal gameplay、terminal BGA、loading screen、SEA build を提供します。
- **browser player**: `@be-music/player-web` の PixiJS/WebAudio runtime と `@be-music/player-web-demo` の Vite host です。runtime はホスト向けの API から、どの画面もファミリービューが描くシーンセッションとして作り、ライブラリとスキンの読み込みとプレイの録画も持ちます。demo は browser drop、theme、Debug Menu、シーンルーターを扱います。
- **skin family**: browser player の scene を描くスキンの種類です。`built-in`（be-music skin）、`lr2`、`beatoraja` があります（`SceneFamily`）。host は読み込んだ theme とプレイヤーの選択から選びます。
- **built-in family（default skin family）**: 外部 theme がない場合、または host が明示的に選ぶ場合に使う skin family です。select、play、result（スキンが宣言していれば decide も）を be-music skin で描きます。play view は LR2 と同じく共通のプレイフィールドを描き、そのまわりの chrome はスキンが描きます。
- **be-music skin**: `@be-music/skin-sdk` に沿って書くコードベースのスキンです。player はキャンバスと毎フレームのデータを渡し、スキンは自分が持ち込んだ renderer で各画面を描きます。
- **built-in skins**: browser player に同梱する be-music skin です。既定の Synesthesia、Phantom、Plain と、opt-in の Lattice があります。
- **touch layout / portrait stage**: タッチ主体の端末向けの gameplay layout です。touch layout は等幅のレーンをステージいっぱいに並べます。`portraitStage` を持つスキンは縦向き（9:16）のステージでも表示できます。
- **LR2 skin**: `@be-music/lr2-skin` が扱う Lunatic Rave 2 CSV skin format です。この package は PixiJS に依存せず、skin file の parse と theme asset 解決を行います。
- **beatoraja skin**: `@be-music/beatoraja-skin` が扱う beatoraja JSON / Lua skin format です。この package は PixiJS に依存せず、header / full skin の parse、option / asset 解決、element normalization を行います。

## 内部モデル

- **IR (`@be-music/json`)**: BMS/BMSON/JSON chart を共通表現として扱う内部中間表現です。外部交換フォーマットではありません。
- **pure IR**: `@be-music/json` が譜面意味論を持たず、正規化済みデータ構造と preservation data の保持に徹する設計方針です。
- **sourceFormat**: その IR がもともと `bms`、`bmson`、`json` のどれから来たかを示す属性です。
- **round-trip**: `parse -> IR -> stringify` の往復で、元の譜面構造をできるだけ再現することです。
- **preservation**: round-trip のために source-level 情報を保持する補助層です。正規化済みの `events` / `measures` とは分けて管理します。
- **sourceLines**: BMS の header、object、control-flow 行を宣言順で保持する preservation 情報です。
- **objectLines**: 制御構文の外側にある object 行だけを保持する preservation 情報です。
- **event**: 正規化後の譜面イベントです。`measure`、`channel`、`position`、`value` を持ちます。
- **position**: IR のイベント位置です。`[numerator, denominator]` で小節内相対位置を表します。
- **chart semantics (`@be-music/chart`)**: IR の上にある譜面意味論です。beat 解決、イベント順序、long note 解決、sample trigger、BGA timeline、reference BPM などを含みます。
- **bms.controlFlow**: parser が保持する BMS 制御構文配列です。parse 時には分岐を確定しません。解決済みの譜面では空配列です。

## 実行時と表示

- **candidate note**: 入力イベントが来たときに、そのレーン集合で判定対象として探す未判定ノートです。
- **keysound fallback**: LR2 互換の空打鍵時発音です。判定対象ノートがない場合、manual play は early BAD 窓がすでに開いた同レーン最新の可視または不可視 WAV を再発音できます。ただし、そのノートの判定窓が開く前の未来 pending WAV は先読みしません。
- **empty POOR / 空POOR**: LR2 互換の空打鍵副作用です。judge 表示を `POOR` にし、POOR BGA を発火し、`EMPTY_POOR` gauge delta を適用しますが、judge counter、combo、EX-SCORE、score は変えません。
- **stateSignals / uiSignals**: engine 本体から UI adapter へ状態を渡す信号群です。judge、combo、frame、lane flash、hold state などを通知します（`@be-music/player/signals` の `createPlayerStateSignals`、`createPlayerUiSignalBus`）。
- **UI runtime**: player core と TUI/PixiJS などの具体的 frontend をつなぐ runtime display adapter です。
- **gameplay worker / UI worker**: terminal frontend で重い gameplay、rendering、video BGA 処理を分離する Node worker 構成です。
- **ANSI rendering**: 画像や BGA を terminal の文字セルと色付き文字列へ落とし込んで表示する方式です。
- **Kitty graphics protocol**: 対応端末で画像を overlay として直接表示する方式です。terminal player では既定で有効で、`--no-kitty-graphics` で無効化できます。
- **render throttle**: TUI 描画を target fps に抑える仕組みです。
- **settle delay**: Music Select の focus 移動後、preview 再生を始める前に置く短い遅延です。
- **focus key**: Music Select で最後に選んでいた項目を directory ごとに復元するための識別子です。chart だけでなく `random` entry も含みます。
- **content hash**: 楽曲一覧 cache で chart 本文の同一性を判定する hash 値です。現行実装では raw bytes の SHA-256 を使います。
- **cache hash**: 保存済み cache entry 自体の破損を検知する hash 値です。
- **Sound / Visual status**: loading screen で audio 側と visual 側の進捗を別々に表示する状態です。
- **structured log**: TUI 出力とは分離して書き出す NDJSON 実行ログです。通常は `~/.be-music/logs/player.ndjson` に出力します。
- **video BGA streaming**: gameplay 開始前には動画 BGA の最初の frame だけを確保し、残りを gameplay 開始後に段階的に decode する方針です。
- **プレイログ (playlog)**: 1 回のプレイの入力を記録したもの（`*.bmplay.json`）です。解決済み譜面、すべてのキーの押下と解放、プレイ設定を持ちます。`bms-playlog` は LR2、beatoraja、IIDX のルールセットでこれを再シミュレーションします。
- **PlayerSummary**: 再生終了後の集計結果です。judge counts、FAST/SLOW、EX-SCORE、SCORE、gauge、clear state などを含みます。

## コース・記録・表示

- **コースの実行（course run）**: コースを 1 回遊ぶこと。ステージを順に遊ぶか、NONSTOP では結合した 1 本のプレイです。1 回分として順位付け・記録します。_避ける語_: course session、course play。
- **ステージ（stage）**: コースの実行の中の 1 譜面。
- **持ち越し（carry-in）**: ステージが始まるときのゲージ値・コースのコンボ・コースの最大コンボ。前のステージが残したものです。
- **投げ（give up）**: コースの実行を ESC で抜けること。投げた実行は落ちた実行です。
- **結合したプレイ（stitched play）**: NONSTOP のコースを遊ぶ 1 本の譜面。ステージをつなぎ方と配置に従って結合して作ります。
- **判定ルールセット（judge ruleset）**: プレイを判定し順位付けする基準のゲーム。判定幅・ゲージ・ランプが決まります。`lr2`・`beatoraja`・`iidx`。
- **ゲージの種類（gauge type）**: プレイヤーが選ぶゲージ。LR2 の名前で `GROOVE`・`HARD`・`DEATH`・`EASY`（`GaugeType`）。判定ルールセットはそれぞれ自分のゲージで遊ばせ、そのゲージはゲージ ID（`NORMAL`・`HAZARD`・`CLASS` など）で呼びます。
- **クリアランプ（clear lamp）**: プレイで得たクリアの区分（FAILED〜MAX、`ClearLamp`）。判定ルールセットごとに付く範囲が違います。どのプレイも 1 つの規則で決めます（`@be-music/player/ruleset` の `resolveClearLamp`、`resolveCourseClearLamp`）。
- **BP**: ミスの数。BAD・POOR・空 POOR に、コースでは判定されなかったノートを加えたもの（`resolveMissCount`）。
- **自己ベスト（best record）**: 1 つの判定ルールセットで、譜面またはコースについてプレイヤーが持つ最良のクリアランプ・EX-SCORE・最大コンボ・BP（`BestRecord`。`@be-music/player/records` の規則で保ちます）。
- **表示設定（view settings）**: 判定とは別に、プレイヤーが見ていたもの。ハイスピード、ハイスピード固定、表示時間、各サイドの SUDDEN+・HIDDEN+・LIFT です。_避ける語_: display options。
- **プレイテンポ（play tempo）**: 譜面に対してプレイがどれだけ速く進むか（`speed`）。テンポを変えたプレイは練習扱いです。

## アーキテクチャ

- **シーンモデル（scene model）**: スキンの種類によらない 1 画面の状態と規則。何を見せ、どう応えるか。[ADR 0002](./adr/0002-scene-model-package.ja.md) と [シーンモデル](./scene-model.ja.md) を参照。
- **設計した入口（designed entry point）**: ファイル構成ではなく、使う側のために作ったパッケージの subpath。`@be-music/player` は `.`（エンジン）、`./signals`、`./lanes`、`./display`、`./ruleset`、`./playlog`、`./records`、`./course`、`./audio-sink` を、`@be-music/player-web` は `.`、`./host`、`./skin`、`./collection`、`./audio`、`./recording` を公開します。それ以外は内部です。[ADR 0005](./adr/0005-public-entry-points.ja.md) を参照。
- **ライブラリ / ライブラリの譜面 / ライブラリの項目（library / library chart / library entry）**: 選曲画面が一覧する対象。ルートでフォルダにまとめた譜面と、コースフォルダです（`Library`）。その中の 1 つの譜面がライブラリの譜面（`LibraryChart`）で、一覧の 1 本のバーは譜面・フォルダ・コースのいずれかです（`LibraryEntry`、`kind: 'chart' | 'folder' | 'course'`）。
- **一覧の状態（browse state）**: プレイヤーがライブラリのどこにいて、一覧がどんな形か。開いているフォルダ、各階層のカーソル、検索、ソートとフィルター（一覧のオプション）、お気に入りです（`BrowseState`）。その保存形（`BrowseSnapshot`。`captureBrowse` で取り、`restoreBrowse` で戻します）がプレイの通るシーンをまたいで状態を保ちます。
- **プレイ状態（play state）**: どのプレイ画面も読むプレイの状態で、エンジンのフレームと判定で進みます。進行中のゲージと EX スコアとそのグラフ、コンボ、判定タイミング、見え方の設定です（`PlayState`。変えるのは `reducePlayState` だけです）。
- **プレイ結果（play result）**: 単独のプレイ、コースのステージ、コース全体、NONSTOP のプレイの唯一の結果の形（`PlayResult`）。どれかは実行の種類（`single`、`stage`、`course`、`nonstop`）が示します。どのリザルト画面もこれを読みます。
- **効果音セット（system sound set）**: テーマの効果音とジングルをスロットごとに持つもの（カーソル、決定、フォルダ、オプションパネル、選曲の BGM、クリア / 失敗のジングルなど）。それぞれバイト列かテーマ内のパスに解決済みです（`SystemSoundSet`）。
- **シーンセッション（scene session）**: 画面の振る舞いの唯一の実装で、すべてのスキンの種類が共有します（`@be-music/player-web` の `session/`）。一覧の操作、譜面の準備、エンジン、入力、音、終わり方です。毎ティック、シーンモデルの上に作ったフレームをファミリービューに渡し、インテントを受け取ります。[ADR 0001](./adr/0001-skin-families-only-draw.ja.md) を参照。
- **ファミリービュー（family view）**: 1 つのスキンの種類が、シーンモデルをどう描くか（`view/built-in/`、`view/lr2/`、`view/beatoraja/`）。セッションのフレームを描き、プレイヤーの操作をインテントとして返します。エンジンは動かしません。
- **ファミリーキット（family kit）**: ホストが画面を描かせるために渡すもので、スキンの種類ごとに違います。be-music skin とそのプレイヤーの設定（`built-in`）、LR2 skin（`lr2`）、読み込んだ beatoraja のテーマの項目（`beatoraja`）です（`SelectKit`、`DecideKit`、`PlayKit`、`ResultKit`）。
- **ホスト向けの API（host API）**: `@be-music/player-web/host`。一度に 1 つの画面を表示する `PixiSceneHost` と、各画面をファミリーキットから `SessionScene` として作る `createSelectScene`、`createDecideScene`、`createPlayScene`、`createResultScene` です。
- **画面のライフサイクル（scene lifecycle）**: どの画面も実装する唯一の契約（`PixiScene`）。`root`、`identity`（`{ kind, family }`）、`enter`、`exit`、`dispose` です。ホストは `setScene` でだけ画面を切り替えます。
- **インテント（intent）**: ビューへの操作が画面にとって何を意味するか。フォルダを開く、コースを始める、ゲージを切り替える、など。
- **プレイループ / 判定の戦略（play loop / judge strategy）**: すべてのプレイが通る 1 つのエンジンのループと、そこに差し込む手動・AUTO・リプレイの判定。[ADR 0003](./adr/0003-one-play-loop.ja.md) を参照。
- **シーンルーター（scene router）**: ホストで今の画面とすべての切り替えを受け持つ唯一の部品（Web のデモの `app/scene-router.ts`）。[ADR 0006](./adr/0006-scene-router.ja.md) を参照。
- **音のサービス（audio service）**: Web のプレイヤーがプレイの譜面以外の音を鳴らす唯一の手段（`@be-music/player-web/audio` の `createAudioService`）。選曲の BGM、効果音、ジングル、譜面のプレビュー、スキンの音を 1 つのシステム `AudioContext` で鳴らします。プレイはこれを通して自分のコンテキストを開きます（`openPlayGraph`）。画面は自分が鳴らす音の持ち主（owner）として自分を渡し、`stopOwned` で止めます。[ADR 0007](./adr/0007-one-system-audio-context.ja.md) を参照。

## 関連文書

- [仕様書トップ](./README.ja.md)
- [BMS 実装仕様](./bms-spec.ja.md)
- [BMSON 実装仕様](./bmson-spec.ja.md)
- [Bemuse 実装仕様](./bemuse-spec.ja.md)
- [Player 実装仕様](./player-spec.ja.md)
- [Terminal player 実装メモ](./player-tui.ja.md)
- [Browser player 実装メモ](./player-web.ja.md)
- [シーンモデル](./scene-model.ja.md)
- [アーキテクチャ](./architecture.ja.md)
- [プレイログ（プレイ履歴）仕様](./playlog.ja.md)
- [be-music スキンの作り方](./be-music-skin.ja.md)
- [LR2 skin 実装メモ](./lr2-skin.ja.md)
- [beatoraja skin 実装メモ](./beatoraja-skin.ja.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](./json-spec.ja.md)
