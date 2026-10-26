[English version](./glossary.md)

# 用語集

この文書は、`be-music` の仕様書と実装で使う用語を定義します。
一般的な BMS/bmson 用語にできるだけ沿いつつ、**このリポジトリでどう扱うか**を優先します。

## 用語運用ルール

- **chart（譜面）** は、時刻を持つオブジェクトとリソース参照からなる演奏単位です。**譜面ファイル（chart file）** はその保存表現であり、演奏内容の同一性とファイルのバイト列の同一性を区別します。
- **track（楽曲）** は、演奏用の配置とは独立した音楽作品を指します。1 つの楽曲が複数の譜面を持つことがあります。タイトルとアーティストは説明用のメタデータであり、一意な ID ではありません。この組だけから独立した楽曲エンティティや同一性を推定しません。
- 個々の楽曲の名前には **track** / `Track` / `trackId` を使います。**music** は音楽全般を指す一般語として使えますが、エンティティ名にはしません。**音声アセット（audio asset）** はファイルの実体、**音声トラック（audio track）** は録音やエディタのタイムライン上のレーンとして区別します。**Music Select** という画面名や `preview_music` などの外部キーは維持します。
- **song** は、このリポジトリの既定語ではありません。`song.mid`、`bemuse-song.json`、`songs[]` のような外部仕様名やファイル名をそのまま参照するときに使います。
- **Music Select** は画面名です。この画面で選択・復元する単位は chart です。
- 選曲画面が一覧するライブラリでは、chart は **ライブラリの譜面**（`LibraryChart`）です。譜面のバーは `{ kind: 'chart', chart }`、フォルダは `charts` を並べ、コースのステージは `chart` を指します。コード名も chart に統一しています（`PlayResult.chart`、`BrowserChartCollectionStore`、`BrowserAssetSource`、スキン SDK の `chartBestRecord`、`BeMusicChartBestRecord`、`resolveChartStats`）。新しい名前は chart を使います。

## 推奨表記

ドキュメント・ソースコメント・画面の文言では、次の表記を使います。コードの識別子は[命名規則](../AGENTS.md)に従います。BMS・bmson・外部サービスが要求する名前は維持します。プロジェクト独自の名前はこの用語に揃えます。

| 概念                             | 英語                 | 日本語                | コード                                           |
| -------------------------------- | -------------------- | --------------------- | ------------------------------------------------ |
| 時刻を持つノートなどの演奏用配置 | chart                | 譜面                  | `chart`                                          |
| 複数の譜面が共有する音楽作品     | track                | 楽曲                  | `track`                                          |
| JSON ベースの譜面形式            | bmson                | bmson                 | `bmson` / `Bmson`。既存の `BMSON_*` 定数は維持   |
| ノートを評価した結果             | judgment             | 判定                  | 既存 API の `judge` は維持                       |
| 入力を記録したリプレイ           | replay               | リプレイ              | `replay` / `Replay`                              |
| プロフィール画像                 | avatar               | アバター              | `avatar`                                         |
| 一意な公開ユーザー名             | handle               | ユーザー名            | `handle`                                         |
| アバターの横に表示する名前       | display name         | 表示名                | `displayName`                                    |
| 認証済みセッションの開始・終了   | sign in / sign out   | ログイン / ログアウト | `signIn` / `signOut`。認証ライブラリの契約は維持 |
| デプロイ先の環境                 | production / preview | 本番 / プレビュー     | `production` / `preview`                         |

**プレイ履歴（play history）** はプレイの集合や一覧、**リプレイ（replay）** は 1 回分の入力リプレイを指し、区別します。英語では修飾語・名詞に **sign-in / sign-out**、動詞に **sign in / sign out** を使います。UI の操作や対象を表す記号は **アイコン（icon）**、ユーザーのプロフィール画像は **アバター（avatar）** です。

記録データの正規語は **リプレイ（replay）** です。型は `BeMusicReplay`、変数は `replay`、操作は `parseReplay`・`serializeReplay`・`simulateReplay` のように動詞で区別します。`log` は診断・実行ログを指します。

譜面を指すコード名は chart、楽曲は track に揃えます。beatoraja の `song` テーブルや `BMSONDecoder` などの外部名は原文を維持します。

ソースの識別子と本プロジェクトの出力値には `____`、画面上のゲーム名には `????`、ゲーム自体の説明には日本語では「**名前を言ってはいけないあのゲーム**」、英語では **That-Which-Must-Not-Be-Named** を使います。旧識別子の互換読み込み・移行は行いません。

## 譜面とリソース

- **BMS**: Be-Music Source 系のテキスト譜面形式です。`#TITLE`、`#WAVxx`、`#mmmcc:...` のようなヘッダ行とオブジェクト行で構成します。
- **bmson**: JSON ベースの譜面形式です。`info`、`sound_channels`、`bga`、`lines` などの構造を持ちます。
- **譜面 (chart)**: 時刻を持つオブジェクトとリソース参照からなる演奏単位です。譜面ファイルは BMS・bmson・内部 JSON による保存表現です。Music Select では抽象的な音楽作品ではなく、ライブラリの譜面を選びます。
- **メタデータ (metadata)**: 曲名、アーティスト、ジャンル、コメント、`#STAGEFILE`、`#BACKBMP`、`#BANNER` など、譜面本体以外の付加情報です。
- **リソース (resource)**: 譜面や skin から参照される音声、画像、動画、テキストなどの外部ファイルです。
- **keysound**: ノートや BGM の発音に使う音声リソースです。BMS では主に `#WAVxx`、bmson では `sound_channels` が対応します。
- **試聴音（audio preview）**: Music Select で再生する短い音です。デプロイ環境も扱う文脈では audio preview と明示します。`#PREVIEW` や bmson の `info.preview_music` を優先して使います。
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
- **拍（beat）**: 四分音符を単位とする譜面上の位置です。通常の 4/4 小節は 4 拍で、小節長の倍率によって拍数が変わります。秒や、小節内の相対位置 `position` とは区別します。
- **BPM**: 1 分あたりの拍数です。譜面の時間進行を決めます。
- **STOP**: 一定時間だけ譜面時間を停止するイベントです。見た目と判定時刻の両方に影響します。
- **SCROLL**: ノートの見た目の流れ方を変える係数です。判定時刻ではなく表示位置に影響します。
- **SPEED**: `SCROLL` と組み合わせて使う、補間付きの視覚距離係数です。
- **ロングノート (long note / LN)**: 始点と終点を持つノートです。保持、離し、終点到達の扱いは `LNMODE` に依存します。
- **LNOBJ**: BMS の `#LNOBJ` で宣言する long note 終端オブジェクトです。
- **LNMODE**: BMS long note の判定確定ルールです。`1`、`2`、`3` で終点判定や hold break 時の扱いが変わります。
- **地雷 (mine)**: 押すとダメージを受けるノートです。LR2 に合わせ、レーンを押したまま判定線を通過するか、`PGREAT` 窓内で押すと爆発します。爆発は譜面値ベースの gauge damage を与えるだけで、判定にはなりません。
- **判定（judgment）**: `PERFECT`・`GREAT`・`GOOD`・`BAD`・`POOR` など、ノートに対する評価です。結果は judgment、判定する動作は judge と呼びます。種類は `JudgmentKind`、時刻付きの結果は `JudgmentTiming` です。エンジンの動作名やフォーマットのフィールドである `judge`・`judgeRuleset` は役割を区別して扱います。
- **FAST / SLOW**: 判定タイミングの早押し/遅押しの補助表示です。現行実装では `GREAT` と `GOOD` のみ集計します。
- **EX-SCORE**: 名前を言ってはいけないあのゲーム互換のスコアです。一般に `PERFECT=2`、`GREAT=1`、それ以外 `0` で集計します。
- **SCORE**: 画面に表示する得点です。LR2 では 20 万点満点の通常スコア、ほかの現行ルールセットでは EX-SCORE を使います。
- **groove gauge**: クリア判定に使うゲージです。shared core の既定は LR2 互換の `GROOVE` (`NORMAL`) で、export された helper は browser play option 向けに `HARD`、`DEATH`、`EASY` も扱います。
- **ハイスピード（hi-speed）**: ノートのスクロール表示を調整する設定です。表示や見える時間の範囲を変えますが、ノートの時刻や再生テンポは変えません。外部スキンの `HI-SPEED`・`HIGH-SPEED` や既存の `hiSpeed` という名前は維持します。
- **MANUAL / AUTO SCRATCH / AUTO**: 再生モードです。`MANUAL` は手動、`AUTO SCRATCH` は scratch だけ自動、`AUTO` は全自動です。
- **制御構文 (control flow)**: BMS の `#RANDOM`、`#IF`、`#SWITCH` などの分岐命令です。parser は保持し、ホストが再生/レンダリング前に、明示的な `RandomDraws` でプレイごとに 1 回解決します。
- **RandomDraws**: 1 回のプレイでの譜面の制御構文の結果です。`#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` の行ごとにファイル順で 1 項目（コマンド、range、value）を持ちます。`drawRandomOutcomes` で 1 回引き、resolver、エンジン、リプレイで共有します。
- **Source レイヤー / Resolved レイヤー**: 譜面を読む 2 つのレイヤーです。Source レイヤー（`BeMusicJSON`）はファイルに書いてあること、Resolved レイヤー（`@be-music/chart-model` の `resolveChart` が作る `ResolvedChart`）は、フォーマットの既定値と de facto の規則をすべて適用した、プレイヤーが演奏するものです。[アーキテクチャ](./architecture.ja.md) を参照してください。

## Runtime Package

- **player core**: `@be-music/player-engine` の共有の規則と engine です。パッケージのルートは engine（`manualPlay`、`autoPlay`）で、解決済みの譜面からプレイを準備して判定し、UI / audio / input の runtime 契約を持ちます。ほかのエントリポイントは規則（`./ruleset`、`./course`、`./records`、`./replay`）と、ホストがプレイと共有するもの（`./signals`、`./lanes`、`./display`）です。timing、ノートの解決、timeline は `@be-music/chart-model` にあります。
- **Node 音声アダプター**: `@be-music/player-node-audio` が提供する Node 用の音声実装です。ホストが `createAudioSession: createNodeAudioSession` としてエンジンに渡します。エンジンは音声契約を所有し、アダプターがデコードと出力を担当します。
- **terminal player**: `@be-music/player-terminal` の CLI / TUI frontend です。core engine の上に Music Select、terminal gameplay、terminal BGA、loading screen、SEA build を提供します。
- **browser player**: `@be-music/player-browser` の PixiJS/WebAudio runtime と `@be-music/app-play` の Vite host です。runtime はホスト向けの API から、どの画面もファミリービューが描くシーンセッションとして作り、ライブラリとスキンの読み込みとプレイの録画も持ちます。player は browser drop、theme、Debug Menu、シーンルーターを扱います。
- **skin family**: browser プレイヤーの scene を描くスキンの種類です。`built-in`（be-music skin）、`lr2`、`beatoraja` があります（`SceneFamily`）。host は読み込んだ theme とプレイヤーの選択から選びます。
- **built-in family（default skin family）**: 外部 theme がない場合、または host が明示的に選ぶ場合に使う skin family です。select、play、result（スキンが宣言していれば decide も）を be-music skin で描きます。play view は LR2 と同じく共通のプレイフィールドを描き、そのまわりの chrome はスキンが描きます。
- **be-music skin**: `@be-music/player-skin-sdk` に沿って書くコードベースのスキンです。表示用フレームを受け取り、Canvas 描画と任意の DOM 画面を組み合わせます。DOM は選曲・決定・リザルトを置き換え、ゲームプレイでは Canvas のプレイフィールドに HUD を追加します。`gameplay.drawsOnDOM` を設定したスキンはプレイフィールドも DOM で描きます。
- **built-in skins**: browser player に同梱する be-music skin です。既定の Synesthesia、Phantom、Plain、Native（DOM + Canvas）と、opt-in の Lattice があります。Native は `@be-music/player-ui` の再利用可能な部品を使います。
- **touch layout / portrait stage**: タッチ主体の端末向けの gameplay layout です。touch layout は等幅のレーンをステージいっぱいに並べます。`portraitStage` を持つスキンは縦向き（9:16）のステージでも表示できます。
- **LR2 skin**: `@be-music/skin-lr2` が扱う Lunatic Rave 2 CSV skin format です。この package は PixiJS に依存せず、skin file の parse と theme asset 解決を行います。
- **beatoraja skin**: `@be-music/skin-beatoraja` が扱う beatoraja JSON / Lua skin format です。この package は PixiJS に依存せず、header / full skin の parse、option / asset 解決、element normalization を行います。

## 内部モデル

- **IR (`@be-music/chart-source`)**: BMS/bmson/JSON chart を共通表現として扱う内部中間表現です。外部交換フォーマットではありません。
- **pure IR**: `@be-music/chart-source` が譜面意味論を持たず、正規化済みデータ構造と preservation data の保持に徹する設計方針です。
- **sourceFormat**: その IR がもともと `bms`、`bmson`、`json` のどれから来たかを示す属性です。
- **round-trip**: `parse -> IR -> stringify` の往復で、元の譜面構造をできるだけ再現することです。
- **preservation**: round-trip のために source-level 情報を保持する補助レイヤーです。正規化済みの `events` / `measures` とは分けて管理します。
- **sourceLines**: BMS の header、object、control-flow 行を宣言順で保持する preservation 情報です。
- **objectLines**: 制御構文の外側にある object 行だけを保持する preservation 情報です。
- **event**: 正規化後の譜面イベントです。`measure`、`channel`、`position`、`value` を持ちます。
- **position**: IR のイベント位置です。`[numerator, denominator]` で小節内相対位置を表します。
- **chart semantics (`@be-music/chart-model`)**: IR の上にある譜面意味論です。beat 解決、イベント順序、long note 解決、sample trigger、BGA timeline、reference BPM などを含みます。
- **bms.controlFlow**: parser が保持する BMS 制御構文配列です。parse 時には分岐を確定しません。解決済みの譜面では空配列です。

## ユーザーとプロフィール

- **ユーザー（user）**: サービスをまたいでプレイやデータを所有する主体です。所有権は安定したユーザー ID（OIDC の境界では issuer と subject の組）で識別し、ユーザー名・表示名・アバターとは区別します。
- **アカウント（account）**: 認証によってユーザーにアクセスするための、利用者向けの概念です。外部プロバイダーとの対応は **外部ログイン連携（linked login account）** と明示します。Better Auth の `account` テーブルは別の be-music ユーザーではなく、この対応を保持します。
- **ゲスト／匿名ユーザー（guest / anonymous user）**: 永続的なログイン資格情報を登録せずに作られたユーザーです。guest は画面での呼び方、anonymous は保存された認証状態を指します。ユーザー ID を持ち、プレイを所有できます。
- **プロフィール（profile）**: ユーザー名・表示名・アバターからなる公開上の見せ方です。変更してもユーザーの同一性は変わりません。
- **認証セッション（session）**: 有効期間を持つ認証状態です。Accounts と各アプリのローカルセッションは、同じユーザーを指していても別の状態です。エンジンのプレイセッションやシーンセッションとは区別します。
- **プレビュー環境（preview environment）**: 本番への反映前に変更を確認するデプロイ環境です。試聴音とは異なる概念です。

## 譜面の同一性

- **譜面ファイルのハッシュ（chart file hash）**: SHA-256・MD5 など、ファイルの生バイト列から計算した値です。演奏内容が同じでも、整形や形式変換で変わることがあります。ターミナルの選曲キャッシュの `contentHash` もこの値です。`cacheHash` は別にキャッシュした要約の破損を検知します。
- **譜面フィンガープリント（chart fingerprint）**: プレイを譜面ごとにまとめる、内容に基づく識別子です。制御構文の全分岐を含み、ファイルのハッシュや 1 回のプレイで選ばれた分岐とは区別します。
- **プレイフィンガープリント（play fingerprint）**: そのプレイで選んだ譜面の分岐を、内容に基づいて識別する値です。特定のプレイヤーの演奏結果を識別する値ではなく、RANDOM・MIRROR などのレーンオプションによってもプレイ結果の ID にはなりません。[フィンガープリント](./fingerprint-spec.ja.md)を参照してください。

## 実行時と表示

- **candidate note**: 入力イベントが来たときに、そのレーン集合で判定対象として探す未判定ノートです。
- **keysound fallback**: LR2 互換の空打鍵時発音です。判定対象ノートがない場合、manual play は early BAD 窓がすでに開いた同レーン最新の可視または不可視 WAV を再発音できます。ただし、そのノートの判定窓が開く前の未来 pending WAV は先読みしません。
- **empty POOR / 空POOR**: LR2 互換の空打鍵副作用です。判定表示を `POOR` にし、POOR BGA を発火し、`EMPTY_POOR` gauge delta を適用しますが、判定カウンター、combo、EX-SCORE、score は変えません。
- **stateSignals / uiSignals**: engine 本体から UI adapter へ状態を渡す信号群です。judge、combo、frame、lane flash、hold state などを通知します（`@be-music/player-engine/signals` の `createPlayerStateSignals`、`createPlayerUISignalBus`）。
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
- **リプレイ（replay）**: 1 回のプレイを決定的に再現するための記録（`*.bmplay.json`）です。解決済み譜面・入力イベント・プレイ設定を持ち、プレイ結果の集計や、複数のプレイからなるプレイ履歴とは区別します。`bms-replay` は LR2、beatoraja、名前を言ってはいけないあのゲームのルールセットでこれを再シミュレーションします。
- **PlayerSummary**: 再生終了後の集計結果です。判定数、FAST/SLOW、EX-SCORE、SCORE、gauge、clear state などを含みます。

## コース・記録・表示

- **コースの実行（course run）**: コースを 1 回遊ぶこと。ステージを順に遊ぶか、NONSTOP では結合した 1 本のプレイです。1 回分として順位付け・記録します。_避ける語_: course session、course play。
- **ステージ（stage）**: コースの実行の中の 1 譜面。
- **持ち越し（carry-in）**: ステージが始まるときのゲージ値・コースのコンボ・コースの最大コンボ。前のステージが残したものです。
- **投げ（give up）**: コースの実行を ESC で抜けること。投げた実行は落ちた実行です。
- **結合したプレイ（stitched play）**: NONSTOP のコースを遊ぶ 1 本の譜面。ステージをつなぎ方と配置に従って結合して作ります。
- **判定ルールセット（judge ruleset）**: プレイを判定し順位付けする基準のゲーム。判定幅・ゲージ・ランプが決まります。`lr2`・`beatoraja`・`____`。
- **ゲージの種類（gauge type）**: プレイヤーが選ぶゲージ。LR2 の名前で `GROOVE`・`HARD`・`DEATH`・`EASY`（`GaugeType`）。判定ルールセットはそれぞれ自分のゲージで遊ばせ、そのゲージはゲージ ID（`NORMAL`・`HAZARD`・`CLASS` など）で呼びます。
- **クリアランプ（clear lamp）**: プレイで得たクリアの区分（FAILED〜MAX、`ClearLamp`）。判定ルールセットごとに付く範囲が違います。どのプレイも 1 つの規則で決めます（`@be-music/player-engine/ruleset` の `resolveClearLamp`、`resolveCourseClearLamp`）。
- **BP**: ミスの数。BAD・POOR・空 POOR に、途中で落ちたり ESC で投げたりして判定されなかったノート（コースでは到達しなかったノートも）を加えたもの（`resolveMissCount`）。
- **自己ベスト（best record）**: 同じ判定ルールセット・譜面またはコースについて、最良のランプ・最高 EX-SCORE・最大コンボ・最少 BP を項目ごとに保持したものです（`BestRecord`）。各値は異なるプレイから得られることがあり、1 回のプレイ結果とは区別します。
- **表示設定（view settings）**: 判定とは別に、プレイヤーが見ていたもの。ハイスピード、ハイスピード固定、表示時間、各サイドの SUDDEN+・HIDDEN+・LIFT です。_避ける語_: display options。
- **プレイテンポ（play tempo）**: 譜面に対してプレイがどれだけ速く進むか（`speed`）。テンポを変えたプレイは練習扱いです。

## アーキテクチャ

- **シーンモデル（scene model）**: スキンの種類によらない 1 画面の状態と規則。何を見せ、どう応えるか。[ADR 0002](./adr/0002-scene-model-package.ja.md) と [シーンモデル](./scene-model.ja.md) を参照。
- **設計したエントリポイント（designed entry point）**: ファイル構成ではなく、使う側のために作ったパッケージの subpath。`@be-music/player-engine` は `.`（エンジン）、`./signals`、`./lanes`、`./display`、`./ruleset`、`./replay`、`./records`、`./course` を、`@be-music/player-browser` は `.`、`./host`、`./skin`、`./collection`、`./audio`、`./recording`、`./compute`、`./controller` を公開します。それ以外は内部です。[ADR 0005](./adr/0005-public-entry-points.ja.md) を参照。
- **ライブラリ / ライブラリの譜面 / ライブラリの項目（library / library chart / library entry）**: 選曲画面が一覧する対象。ルートでフォルダにまとめた譜面と、コースフォルダです（`Library`）。その中の 1 つの譜面がライブラリの譜面（`LibraryChart`）で、一覧の 1 本のバーは譜面・フォルダ・コースのいずれかです（`LibraryEntry`、`kind: 'chart' | 'folder' | 'course'`）。
- **一覧の状態（browse state）**: プレイヤーがライブラリのどこにいて、一覧がどんな形か。開いているフォルダ、各階層のカーソル、検索、ソートとフィルター（一覧のオプション）、お気に入りです（`BrowseState`）。そのスナップショット（`BrowseSnapshot`。`captureBrowse` で取り、`restoreBrowse` で戻します）がプレイの通るシーンをまたいで状態を保ちます。
- **譜面フィルター式（chart filter expression）**: `?` で始まる検索。beatoraja のランダムコースが使う SQL の `WHERE` 句（`ORDER BY` / `LIMIT` も可）で、各譜面の `song` の列、ベストレコード（`score.*`）、楽曲情報（`information.*`）に対して評価します（`parseBrowseSearch`、`parseCourseChartFilter`）。
- **プレイ状態（play state）**: どのプレイ画面も読むプレイの状態で、エンジンのフレームと判定で進みます。進行中のゲージと EX スコアとそのグラフ、コンボ、判定タイミング、表示設定です（`PlayState`。変えるのは `reducePlayState` だけです）。
- **プレイ結果（play result）**: 単独のプレイ、コースのステージ、コース全体、NONSTOP のプレイの唯一の結果の型（`PlayResult`）。どれかは実行の種類（`single`、`stage`、`course`、`nonstop`）が示します。どのリザルト画面もこれを読みます。
- **効果音セット（system sound set）**: テーマの効果音とジングルをスロットごとに持つもの（カーソル、決定、フォルダ、オプションパネル、選曲の BGM、クリア / 失敗のジングルなど）。それぞれバイト列かテーマ内のパスに解決済みです（`SystemSoundSet`）。
- **シーンセッション（scene session）**: 画面の振る舞いの唯一の実装で、すべてのスキンの種類が共有します（`@be-music/player-browser` の `session/`）。一覧の操作、譜面の準備、エンジン、入力、音、終了処理です。毎ティック、シーンモデルの上に作ったフレームをファミリービューに渡し、インテントを受け取ります。[ADR 0001](./adr/0001-skin-families-only-draw.ja.md) を参照。
- **ファミリービュー（family view）**: 1 つのスキンの種類が、シーンモデルをどう描くか（`view/built-in/`、`view/lr2/`、`view/beatoraja/`）。セッションのフレームを描き、プレイヤーの操作をインテントとして返します。エンジンは動かしません。
- **ファミリーキット（family kit）**: ホストが画面を描かせるために渡すもので、スキンの種類ごとに違います。be-music skin とそのプレイヤーの設定（`built-in`）、LR2 skin（`lr2`）、読み込んだ beatoraja のテーマの項目（`beatoraja`）です（`SelectKit`、`DecideKit`、`PlayKit`、`ResultKit`）。
- **ホスト向けの API（host API）**: `@be-music/player-browser/host`。一度に 1 つの画面を表示する `PixiSceneHost` と、各画面をファミリーキットから `SessionScene` として作る `createSelectScene`、`createDecideScene`、`createPlayScene`、`createResultScene` です。
- **画面のライフサイクル（scene lifecycle）**: どの画面も実装する唯一の契約（`PixiScene`）。`root`、`identity`（`{ kind, family }`）、`enter`、`exit`、`dispose` です。ホストは `setScene` でだけ画面を切り替えます。
- **インテント（intent）**: ビューへの操作が画面にとって何を意味するか。フォルダを開く、コースを始める、ゲージを切り替える、など。
- **プレイループ / 判定ストラテジー（play loop / judge strategy）**: すべてのプレイが通る 1 つのエンジンのループと、そこに差し込む手動・AUTO・リプレイの判定。[ADR 0003](./adr/0003-one-play-loop.ja.md) を参照。
- **シーク（seek）**: 動いているプレイを譜面の別の秒数へ動かすこと。プレイループへのコマンド（`{ kind: 'seek' }`）で、プレイを始め直すことはありません。その位置の判定の状態は先頭からのプレイがそこで持つもので、シークのたびにフレームの世代が 1 つ進みます。シークしたプレイは練習扱いで、リプレイを記録しません。[ADR 0016](./adr/0016-seek-play-loop-command.ja.md) を参照。
- **シーンルーター（scene router）**: ホストで今の画面とすべての切り替えを受け持つ唯一の部品（Web プレイヤーの `app/scene-router.ts`）。[ADR 0006](./adr/0006-scene-router.ja.md) を参照。
- **音声サービス（audio service）**: Web プレイヤーがプレイの譜面以外の音を鳴らす唯一の手段（`@be-music/player-browser/audio` の `createAudioService`）。選曲の BGM、効果音、ジングル、譜面のプレビュー、スキンの音を 1 つのシステム `AudioContext` で鳴らします。プレイはこれを通して自分のコンテキストを開きます（`openPlayGraph`）。画面は自分が鳴らす音の所有者（owner）として自分を渡し、`stopOwned` で止めます。[ADR 0007](./adr/0007-one-system-audio-context.ja.md) を参照。

## 関連文書

- [コード内ドメイン用語の整理案](./code-vocabulary.ja.md)

- [仕様書トップ](./README.ja.md)
- [BMS 実装仕様](./bms-spec.ja.md)
- [bmson 実装仕様](./bmson-spec.ja.md)
- [Bemuse 実装仕様](./bemuse-spec.ja.md)
- [Player 実装仕様](./player-spec.ja.md)
- [Terminal player 実装メモ](./player-tui.ja.md)
- [Browser player 実装メモ](./player-web.ja.md)
- [シーンモデル](./scene-model.ja.md)
- [アーキテクチャ](./architecture.ja.md)
- [リプレイ（プレイ履歴）仕様](./replay.ja.md)
- [be-music スキンの作り方](./be-music-skin.ja.md)
- [LR2 skin 実装メモ](./lr2-skin.ja.md)
- [beatoraja skin 実装メモ](./beatoraja-skin.ja.md)
- [BMS/bmson 中間表現 (`@be-music/chart-source`) 実装仕様](./json-spec.ja.md)
