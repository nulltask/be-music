[English version](./player-tui.md)

# Terminal player 実装メモ

この文書は、`@be-music/player-tui` と `bms-player` CLI で実装する terminal frontend の実装メモです。
timing、note、判定、score、gauge、BGA cue などの共有再生意味論は [Player 実装仕様](./player-spec.ja.md) で定義します。
browser 固有の PixiJS / WebAudio 挙動は [Browser player 実装メモ](./player-web.ja.md) に記述します。

## Runtime 境界

`@be-music/player-tui` は、共有 `@be-music/player` engine を使う Node frontend です。
CLI runner は chart file の parse、directory selection、loading / result screen 描画、1 回の gameplay session 起動を担当します。
gameplay 本体は worker thread 上で動き、`@be-music/player/core/engine` の `autoPlay()` または `manualPlay()` を呼びます。

main thread は terminal input を所有し、worker 側の 2 つの surface を調停します。

- `node-gameplay-worker.ts` は共有 engine を実行し、load progress、log、frame patch、input request、最終 `PlayerSummary` を転送します。
- `node-ui-worker.ts` は terminal renderer を所有し、compact frame patch、UI command、pause state、high-speed change、judge/combo state を受け取ります。
- `node-input-runtime.ts` は main thread で raw keyboard input を捕捉し、正規化した input command を gameplay worker へ送ります。

TTY support がない場合や TUI 初期化に失敗した場合、player は text output へ fallback します。
`--no-tui` を渡した場合も TUI 経路を無効化します。この mode では実効 play mode は `AUTO` です。

## Entry flow

input path が単一 chart の場合、CLI はその chart を parse し、loading screen を準備し、gameplay を実行し、その後 result screen を表示します。
単一 chart mode の result screen は replay を受け付けます。

input path が directory の場合、CLI は `.bms`、`.bme`、`.bml`、`.pms`、`.bmson` file を再帰的に探索します。
Music Select list を構築し、次の小さな state machine で遷移します。

- `select`: chart browse、difficulty filter、play mode 変更、high-speed 変更、random entry 選択を扱います。
- `play`: 選択した play mode と high-speed で 1 chart を再生します。
- `result`: 直前の play result を表示し、replay、select へ戻る、exit を受け付けます。
- `exit`: 適切な process exit code で終了します。

directory mode では gameplay 中の `Esc` は Music Select へ戻ります。
`Ctrl+C` は exit code `130` で終了します。
restart は新しい playback run を作り、control-flow random branch を引き直します。

## Music Select

Music Select は chart metadata、chart row、play mode、high-speed、difficulty filter、audio backend state、任意の banner を表示します。
chart row は directory ごとに group 化し、`PLAYER`、`DIFFICULTY`、`PLAYLEVEL`、file label、relative path の順で sort します。
先頭 row は random-entry pseudo chart です。

chart summary builder は各 chart を parser で読み、metadata 抽出用に deterministic random value で BMS control flow を解決し、note count、表示用 player / rank / play level、BPM range、banner path、preview identity を計算します。
metadata 抽出に失敗しても chart は list から除外せず、欠けた field は空欄として表示します。

summary cache は `~/.be-music/chart-selection-cache.json` に保存します。
各 entry は chart 本文の SHA-256 content hash で key 化し、派生 metadata を含む cache hash で検証します。
hash が一致している間、player は再 parse を省略します。

## Preview playback

選曲画面は短い settle delay の後に preview playback を開始し、cursor 連打で不要な render work が走らないようにします。
`#PREVIEW` を優先し、relative preview path の解決では `#PATH_WAV` も考慮します。
preview file が使えない場合、controller は chart の最初の sample trigger から fallback preview を render します。

preview audio は Node audio sink を使い、render 済み PCM を loop 再生します。
controller は小さな in-memory preview cache を持ち、次に focus した chart が同じ preview file または fallback signature へ解決される場合は再生を継続します。

## Input model

input runtime は、共有 engine に渡す前に keyboard input を token string へ正規化します。
非 Windows terminal では既定で Kitty keyboard protocol へ opt-in し、左右 modifier key を区別できるようにします。
Windows では Win32 terminal input mode へ opt-in します。
protocol opt-in を上書きする場合は、`BE_MUSIC_KEYBOARD_PROTOCOLS=kitty`、`win32`、または comma-separated combination を設定します。

主な command mapping は次のとおりです。

- `Space`: pause / resume。
- `Esc`: 現在の play を interrupt し、summary を返します。
- `Ctrl+C`: exit code `130` の interrupt。
- restart key input: `restart` interruption を発生させ、chart を再実行します。
- `Alt` / `Option` + 奇数 lane input: high-speed を `0.5` 減らします。
- `Alt` / `Option` + 偶数 lane input: high-speed を `0.5` 増やします。

manual lane input は worker boundary を越える前に wall-clock milliseconds で timestamp を付けます。
engine はその timestamp を playback clock へ戻し、UI frame 間に入った key press でも物理 timing で判定します。

## TUI rendering

TUI は song metadata、mode、BPM / SCROLL / STOP status、progress、current measure、judgment window、high-speed、score counter、FAST / SLOW、lane body、judge/combo state、input label、groove gauge、BGA、任意の audio debug line を表示します。
target refresh rate の既定値は `60fps` です。`--tui-fps <value>` は任意の正の値を受け付けます。

UI worker は可能な限り full frame payload ではなく compact frame patch を受け取ります。
terminal resize event、pause state、high-speed change、judge/combo update、deferred UI command flush も追跡します。

## BGA と terminal image

terminal BGA renderer は共有 BGA timeline helper を使い、base、layer、layer2、POOR track に対応します。
BMP、PNG、JPEG、対応 video frame を読み込み、active frame を ANSI color block または Kitty graphics image へ合成します。
BMS layer channel は black pixel を transparent として扱います。bmson layer image は black pixel を画像データとして保持します。

`#STAGEFILE` は loading screen 専用です。
terminal 全体に cover fit で描画し、画像が見つからない場合や非対応の場合は text loading へ fallback します。
`#BANNER` と bmson `info.banner_image` は terminal に十分な幅がある場合、Music Select に表示します。

Kitty graphics は対応 terminal で既定有効です。
ANSI rendering を強制する場合は `--no-kitty-graphics` を使います。
video BGA は既定で progressive decode します。`--no-video-bga-streaming` を使うと旧来の full-predecode behavior に戻します。

## 設定とログ

CLI は player settings を `~/.be-music/player.json` に保存します。
この file には次を保存します。

- play mode: `manual`、`auto-scratch`、`auto`;
- 共有 `0.5` から `10.0` の範囲で正規化した high-speed;
- directory ごとの last selected chart file;
- directory ごとの last Music Select focus key。

command-line の play-mode / high-speed flag は、その実行では persisted value より優先します。

structured log の既定 path は `~/.be-music/logs/player.ndjson` です。
別の出力先を使う場合は `--log-file <path>` を指定します。

## Compatibility boundary

terminal player は LR2 skin file や beatoraja skin file を読み込みません。
独自の TUI を描画し、note、scoring、gauge、input、timing、BGA cue、result summary は共有 engine semantics を使います。

互換ルールセットとゲージは選択できます: `--ruleset <lr2|beatoraja|iidx>`（既定 `lr2`）と
`--gauge <GROOVE|EASY|HARD|DEATH>`（既定 `GROOVE`）。各ルールセットが何を支配するかは
[player-spec.ja.md](./player-spec.ja.md) を参照してください。

2P independent gauge variant と LR2 / beatoraja skin option panel は browser 側の関心事です。
