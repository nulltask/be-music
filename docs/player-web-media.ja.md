[English version](./player-web-media.md)

# ブラウザープレイヤーの音声・BGA・録画

[ブラウザープレイヤーの概要](./player-web.ja.md)

<details>
<summary>目次</summary>

- [Audio, BGA, recording](#audio-bga-recording)
  - [音声出力](#音声出力)
  - [BGA の描画](#bga-の描画)
  - [録画とリザルト](#録画とリザルト)
  - [Leaderboard への送信](#leaderboard-への送信)
  - [BGA 動画の transcode](#bga-動画の-transcode)
  - [BGA カメラ](#bga-カメラ)
  - [オーディオサービス](#オーディオサービス)

</details>

## Audio, BGA, recording

### 音声出力

試聴とプレイ中の音声には Web Audio を使います。

- `@be-music/player-browser/audio` は platform audio session 用の helper を export します（engine 内部の `WebAudioSession` とは別物です）。`supportsSystemAudioSession`、`getSystemAudioSession`、`applySystemAudioSessionType` は `navigator.audioSession.type` を feature detection して設定し、`applySilentModePlayback(on)` はオンで `'playback'`、オフで `'auto'` を設定します。例外は握りつぶし、API がない環境では何もしません。`AudioContext` の作成・resume より前と、音声を unlock する gesture の中で呼んでください。
- gameplay audio は既定の split topology で key、BGM、master compressor stage を分けます。
- `?compressor=legacy` は比較用に旧 single-compressor 構成を維持します。
- `?compressor=off` は player で compressor construction を無効化します。
- beatoraja theme audio は Lua `main_state.audio_play` / `audio_loop` call、select BGM、navigation system sound、decide BGM、result jingle に同じ browser bundle lookup を使います。

### BGA の描画

- BGA は chart BGA event が参照する still image と video asset を扱います。
- BGA rect（LR2 の `#DST_BGA`、beatoraja の `bga`、built-in frame）はいずれも 256x256 の BMS キャンバスとして扱います。長辺 256 px 以下の静止画は等倍のまま X 軸中央・上詰めで黒地の上に置き、それより大きい画像と動画は rect いっぱいに描きます（[フォーマット互換性](./format-compat-bms.ja.md#217-bga)）。
- default family は LR2 skin と同じ chart BGA layer stack を built-in BGA frame 内に描画します。
- BMS rendering は `#BGAxx` の部分領域、EXBMP 静止画・不透明動画の透過色、面ごとの A1〜A4 ARGB、キー入力連動 A5 SWBGA を反映します。SWBGA は透過色付き動画の切り出しと NONSTOP のリソース変換にも対応します。選択と表示はステージ境界で終了し、アニメーションと動画の時計は FIT に合わせます。[BMS 対応範囲](bms-spec.ja.md)を参照してください。
- bmson の BGA は `bga.bga_events`、`bga.layer_events`、`bga.poor_events` を使います。BMS のレイヤーでは黒いピクセルを透明にし、bmson のレイヤーではそのまま描画します。
- ブラウザが再生できない BGA 動画（`.wmv`、`.avi`、`.mpg` など）は、ffmpeg.wasm と single-threaded の `@ffmpeg/core` で H.264 に transcode し、transcode の途中から再生を始めます（[BGA 動画の transcode](#bga-動画の-transcode)）。現在の 0.12.x の multithreaded core は libx264 でクラッシュするため含めていません。BGA 動画の音声はいずれにしても扱いません。

### 録画とリザルト

- 譜面が最後まで進むと、少し待ってからリザルト画面を開きます。すでに鳴っている音は画面が切り替わった後も続きます。
- 録画は MP4 または WebM に書き出します。シーンがプレイ用の音声バスを破棄する前に、録画を止めてファイルへの書き込みを完了します。
- リプレイの記録・ダウンロード・再生は [リプレイ仕様](./replay.ja.md) を参照してください。

### Leaderboard への送信

手動プレイの結果を送るには、Options の Leaderboard で「Submit to Leaderboard」をオンにします。既定ではオフです。リプレイの自動保存と同じく、プレイ開始時の設定が適用されます。送信にはログインが必要で、ゲストアカウントも使えます。

送信するプレイは「Submit when」で選びます。この設定もプレイ開始時に確定します。

- 「EX-SCORE improves (first play always)」が既定です。開始時に、その譜面と判定ルールの自己ベストを `be-music.chart-best-records` から読みます。EX-SCORE の記録がない初回と、自己ベストを上回ったプレイを送ります。
- 「Always」では、送信条件を満たすプレイをすべて送ります。

コースは EX-SCORE 以外の指標も順位に使い、送信回数も少ないため、この設定による絞り込みの対象外です。`leaderboard-submit-rule.ts` の `shouldSubmitPlay` が送信の要否を決め、送った結果の表示は Leaderboard が決めます。送信を見送った場合はステータス行に表示します。

リザルト画面を開くと、ブラウザーは譜面からフィンガープリントのドキュメントを組み立て直し、リプレイと照合します。サーバーから求められた場合は譜面ドキュメントを添えて再送します。順位はステータス行に表示します。[Leaderboard 仕様](./leaderboard.ja.md)

デプロイ先の Worker は `/api/*` と `/leaderboard/*` を Service Binding 経由で Leaderboard の Worker に転送します。`pnpm player:web` を使う場合は、`pnpm --filter @be-music/app-leaderboard run dev` で起動したローカルの Leaderboard か、`LEADERBOARD_DEV_ORIGIN` で指定した先にプロキシします。

ゲストアカウントを引き継ぐには Options → Leaderboard の「このアカウントを保存」を選び、パスキーを登録するか Google または Discord を連携します。引き継いだプレイはアカウントのユーザー名で一覧に表示されます。パスキー・Google・Discord で別のアカウントにログインすると、このブラウザーのゲストプレイがそのアカウントに移ります。

### BGA 動画の transcode

ブラウザが BGA 動画をデコードできないとき、`loadVideoTextureFromBytes` はそれを H.264 に transcode し、ネイティブの動画と同じ `<video>` / Pixi `VideoSource` の経路で再生します。ホストが Worker を登録し（`./compute` の `configureBGAVideoWorkers`。各エントリーは `runBGAVideoDecodeWorker()` / `runBGAVideoEncodeWorker()` を呼ぶ）、ブラウザに Media Source Extensions があれば、transcode は逐次的に進みます。動画は fragmented MP4 を `MediaSource`（iPhone のように `ManagedMediaSource` があればそちら）経由で届いた順に再生するため、BGA は最初のフレームができた時点で使えます。

```mermaid
flowchart LR
  subgraph decode["デコード Worker"]
    ffmpeg["ffmpeg.wasm"] --> device["出力デバイス"]
  end
  subgraph encode["エンコード Worker"]
    webcodecs["WebCodecs H.264"] --> mux["Mediabunny fMP4"]
  end
  device -- "y4m フレーム" --> webcodecs
  device -- "libx264 fMP4" --> main
  mux -- "fMP4" --> main["メインスレッド<br/>MediaSource"]
  main --> video["video 要素"]
```

- デコード Worker は無改造の ffmpeg.wasm コアを起動し、ffmpeg の出力先としてキャラクターデバイスを登録します。これで `exec` の実行中に出力が少しずつ JavaScript に届きます。出力は偶数の寸法に縮小し、最大 60 fps の固定フレームレートに揃えるため、可変フレームレートの素材も時刻がずれません。
- cross-origin isolated なページでは、ffmpeg が y4m の生フレームを書き、エンコード Worker が WebCodecs（ハードウェア優先）で符号化して Mediabunny で多重化します。デコーダはエンコーダより数フレーム以上先行すると `SharedArrayBuffer` のカウンターで待つ（`Atomics.wait`）ため、フレームを捨てることも生フレームが溜まることもありません。
- それ以外のページ（`Cross-Origin-Embedder-Policy: credentialless` に対応しない Safari など、ページを isolated にできないブラウザー）、「Use WebCodecs encoder」がオフのとき、WebCodecs のエンコーダが失敗したときは、ffmpeg 自身の libx264 で直接 fragmented MP4 を書きます。デコードと同じスレッドで符号化するので、デコードの速さは自然に抑えられます。
- media source は stream が終わるまで仮の長さを宣言するため、まだ transcode されていない位置へシークした cue はそこでフレームを待ちます。複数のトラックで同じバイト列を使う動画は 1 つの transcode を共有し、transcode は同時に 2 本まで走り、それを使う最後の動画を閉じると取り消します。
- Worker か MSE がないとき、または最初のフレームより前に stream が失敗したときは、従来どおりファイル全体を transcode してから再生します。
- **Transcode quality**（Options → Advanced → BGA video transcode。低、標準（既定）、高、最高）で、どの経路で変換するときの画質も決めます。libx264 の `-crf`（34、30、25、21。`resolveBGATranscodeCRF`）と、WebCodecs のエンコーダーのビットレート（1 ピクセル・1 フレームあたり 0.05、0.08、0.15、0.25 ビット、最低 500 kb/s。`estimateBGATranscodeBitrate`）です。次に読み込む譜面から反映し、別の画質で変換済みのストリームは使い回しません。

### BGA カメラ

Options → **Camera** で、プレイ画面の BGA の枠に、譜面の BGA の代わりにカメラの映像を映せます。ウェブカメラで手元を写して打鍵の様子を見せたり、配信で顔を出したりするときに使います。内蔵スキン（Synesthesia・Plain・Native）、LR2 スキン、beatoraja スキンのどれでも使えます。

```mermaid
stateDiagram-v2
    [*] --> off
    off --> standby: オンにする
    standby --> starting: プレイを表示
    starting --> live: getUserMedia
    starting --> denied: 拒否
    starting --> missing: 未接続
    live --> standby: プレイを離れる
    live --> missing: 抜線 / トラック終了
    missing --> starting: 再接続
    live --> off: オフにする
```

- **共通の入口。** アプリの `BGACameraService`（`services/bga-camera.ts`）が `getUserMedia` でカメラを開き、`MediaStream` を `PlayScene.setBGACamera({ stream, mirror })` でプレイに渡します。シーンはそれを `BGACameraFeed`（`media/bga-camera.ts`。譜面の動画 BGA と同じく、ミュートした `<video>` と Pixi の `VideoSource`）に包み、プレイセッションの `bgaCamera` に置きます。`renderBGA`（内蔵と LR2 のプレイ画面）と beatoraja の BGA 層は、譜面の BGA の代わりにその texture をすべての BGA の矩形に、黒地に全体が収まるように描き（`fitBGACameraRect`）、譜面の動画は止めます。BGA を自分で合成する Be-Music Skin（`drawsBGA`。Native スキン）には、256x256 の canvas を `frame.bga.base` として渡します。BGA の設定や譜面に BGA があるかどうかにかかわらず映し、内蔵スキンはそのために BGA の枠を描きます。左右反転は texture を反転する（`groupD8.MIRROR_HORIZONTAL`）ので、sprite は変えません。
- **カメラが動くとき。** 設定がオンで、プレイがステージにあるときだけです。シーンルーターの `setScene` が表示中のシーンをサービスに伝えるので、選曲・決定・リザルト画面ではカメラを止めます。リトライでは開いているカメラをそのまま引き継ぎます。オン / オフ、カメラ、左右反転の変更は、プレイ中でも次のフレームから反映されます。
- **カメラの選択。** 一覧は `enumerateDevices` から作り、`devicechange` で更新します。一度カメラを許可するまで、ブラウザはカメラの名前を教えないので、フォルダに **Allow camera access** ボタンを置き、一度だけ許可を求めてすぐカメラを止めます。名前が分かったあとは無効になります。選んだカメラは `deviceId` と名前の両方で覚えるので、ブラウザが id を変えても見つけ直せます（`bga-camera-settings.ts` の `pickCamera`）。
- **カメラを失ったとき。** プレイ中にカメラが抜かれたり、許可が取り消されたりするとトラックが終わります。サービスはカメラを閉じ、プレイは次のフレームから譜面の BGA に戻り、ステータス行で知らせます。選んだカメラがつながっていなければ待ち、つながったときに開きます。
- **プレビュー。** **Show camera in BGA** がオンで Camera タブを表示している間、選んだカメラをタブの中に、プレイと同じ向き（左右反転を含む）で映します。ボタンを押す必要はなく、プレイの前に画角を合わせられます。プレイ中ならその映像を共有し、設定をオフにする、タブを離れる、ダイアログを閉じる（プレビューが表示されなくなる）、カメラがなくなる、のいずれかで止めます。
- **解像度と縦横比。** **Camera resolution**（カメラのまま、480p、720p、1080p）と **Camera aspect ratio**（カメラのまま、4:3、16:9、1:1）は、カメラに `ideal` の制約として求めます（`cameraConstraints`）。対応しないカメラは近い値で開きます。変えるとその値でカメラを開き直します。
- **プライバシー。** 映像はプレイの canvas にしか行かず、どこにも送りません。Capture の録画は canvas を記録するので、BGA の枠ごとカメラの映像も記録されます。
- **cross-origin isolation。** `MediaStream` は cross-origin のリソースではないので、COEP `credentialless` の影響を受けません。cross-origin isolated の状態で、Chromium の偽カメラ（`--use-fake-device-for-media-stream`）を使って確かめました。
- **リプレイとゴースト。** リプレイも同じプレイシーンで再生するので、カメラを映せます。ゴーストのプレイフィールドやペースメーカーは自分の BGA を描かないので、影響しません。

### オーディオサービス

`createAudioService()`（`@be-music/player-browser/audio`）は、プレイ中の譜面の音以外を鳴らす唯一の手段です（[ADR 0007](./adr/0007-one-system-audio-context.ja.md)）。scene session はできるごとにこれで音を鳴らします。どの選曲画面、決定画面、プレイ画面、リザルト画面もこれで鳴らします（プレイは `openPlayGraph` で専用のグラフを開きます）。Web プレイヤーは起動時にサービスを 1 つ作り、これで作るすべての scene に渡します。beatoraja のテーマを読み込むと、beatoraja の選曲画面のパスで指す効果音と選曲 BGM、beatoraja の選曲画面・決定画面・プレイ画面・リザルト画面のスキンの音のために、そのファイルを設定します（`setTheme({ files })`）。

```mermaid
flowchart LR
  subgraph system["システム用、共有"]
    bgm[BGM] --> duck[プレビュー中は消音]
    duck --> music[音楽バス]
    jingle[ジングル] --> music
    preview[譜面のプレビュー] --> music
    music --> analyzer[解析]
    cue[効果音・スキンの音] --> cues[効果音バス]
  end
  subgraph play["プレイ用、プレイごと"]
    samples[譜面のサンプル] --> bus[オーディオバス]
  end
  music --> master[マスター音量]
  cues --> master
  bus --> master
```

- システム用の AudioContext は最初に使うときに作ります。ユーザー操作の前のページで、ブラウザーが開始を拒む AudioContext を作らないためです。音はバイト列（またはテーマのファイル）ごとに 1 回だけデコードし、デコードの失敗も覚えておきます。
- `setTheme({ sounds, files })` でテーマの `SystemSoundSet`（player-scene-model）と、beatoraja のテーマならそのファイルを設定します。`playCue(slot)` はその効果音を 1 回鳴らします。`playBGM` と `playJingle` はスロットか解決済みの `SystemSound` を受け取ります。パスで指定された音（beatoraja テーマの効果音など）はテーマのファイルから読みます。
- `playBGM(sound, { owner, volume, loop, duckUnderPreview })` が鳴らす BGM は常に 1 つです。別の BGM なら置き換え、同じ BGM ならそのまま鳴らし続けてオーナーと音量だけを変えます。譜面のプレビューが鳴っている間は消音します。`duckUnderPreview` が `false` なら消音しません。
- `skinSounds.play` / `loop` / `stop` は beatoraja スキンの `main_state.audio_*` です。`skinSounds.owned(owner)` は同じ呼び出しをオーナー付きで行います。
- `preview.focus(target, owner)` は 1 つの `ChartPreviewEngine` を動かします。`analyzer.sample(now)` は、音に反応する Be-Music Skin のために音楽バスを解析します。
- `openPlayGraph(chart, mode, busOptions, { owner })` は、プレイ専用の `interactive` な AudioContext と、`#VOLWAV` を反映したオーディオバスを開き、バスの出力に解析を付けます。`close({ delayMs, beforeClose })` で、余韻を鳴らしきってから閉じます。
- `chartSamples` は、直前のプレイのデコード済みサンプルを持ちます。クイックリトライ（F5、リザルトでの R）や、同じ楽曲の別の譜面のプレイ（NORMAL → HYPER）で、サンプルをデコードし直しません（[#953](https://github.com/nulltask/be-music/issues/953)）。デコード結果は、`#WAV` のパスが（譜面のフォルダー、`#PATH_WAV`、コーデックの代替を経て）解決される音声ファイルごとに、オブジェクトの同一性で持ちます。2 つの譜面がデコード結果を共有するのは、パスがまったく同じファイルに解決されるときだけです。別のフォルダーにある同名のファイルや、別の `#PATH_WAV` ではデコードし直します。`chart/play-audio.ts` は、プレイが鳴らしうるすべてのファイルを渡してこれを確保します。それらのファイルのデコード結果は残り、それ以外はプレイがデコードする前に手放すので、キャッシュが持つのは多くても 1 プレイ分で、別の `#RANDOM` 分岐で増えることはありません。別のソース（ドロップしたフォルダーやアーカイブ。同一のオブジェクトか）や別のコンテキストのサンプルレートのプレイは、先にすべてを手放します。キャッシュが持つのはデコードしたままのものだけです。プレイごとに RANDOM を引き直し、ピッチを保つ伸縮、`#WAVCMD` / `#EXWAV`、ピークゲインは新しいバッファーに施し（ピークゲインは複製を拡大縮小します）、新しいリプレイを記録します。サンプルは、選曲画面のカーソルが同じ楽曲（同じソースとフォルダー）の譜面にある間は残ります。プレビューがそれ以外の譜面に合うか、どの譜面にも合わなくなると手放します（`chartSamples.keepTrackOf`）。Web プレイヤーは `pagehide` で `chartSamples.release()` を呼びます。SILENT のプレイと `dispose()` も手放します。

  ```mermaid
  stateDiagram-v2
    state "空" as Empty
    state "保持" as Holding
    [*] --> Empty
    Empty --> Holding: 譜面のプレイ
    Holding --> Holding: 同じ譜面のリトライ
    Holding --> Holding: 別の譜面（先に手放す）
    Holding --> Empty: 選曲画面、pagehide、SILENT、dispose
  ```

- `stopOwned(owner)` は、そのオーナーが鳴らしたものをすべて止めます。BGM、ジングル、効果音、スキンの音、そのオーナーがフォーカスしたプレビュー、まだ閉じ始めていないプレイのグラフです。AudioContext を閉じても音は止まらなくなったので、scene は画面を出るときにこれを呼びます。オーナーなしで鳴らした音は最後まで鳴ります（選曲画面を出るときの決定音など）。`dispose()` はすべてを止め、すべての AudioContext を閉じます。
