[English version](./player-web-spec.md)

# Player Web 実装仕様

この文書は、`@be-music/player-web-core` を中心としたブラウザ版 player の現状実装と今後のロードマップを定義します。

ブラウザ版 player は現在、ローカルのフォルダまたは ZIP ファイルをドロップして譜面を読み込み、楽曲一覧を表示し、PixiJS ベースの gameplay をブラウザ上で開始できる段階にあります。

## 目的

- ブラウザ版 player の現在の実装範囲を明確にする。
- CLI 版 player と揃っている chart 関連挙動と、未実装の差分を記録する。
- 追従実装の優先順位を毎回監査し直さなくてよいよう、段階的なロードマップを残す。

## 対象範囲

この文書が対象にするのは、ブラウザ側 player package と、その直接の runtime 責務です。

- `@be-music/player-web-core`
- `@be-music/player-react`
- `@be-music/player-vue`
- `@be-music/player-web-demo`

CLI / Node 側 player の正規 runtime 仕様は [`player-spec.ja.md`](./player-spec.ja.md) を優先します。
この文書と CLI runtime の挙動に差がある場合、ここで browser 専用差分として明示していない限り、それは browser 実装の未追従として扱います。

## 改訂追跡情報

- 監査起点: `0106ea4` (`feat(player-web): add browser song library and gameplay`)
- 監査時点: `4526a08` (`feat(player-web): add manual browser gameplay`)
- 監査対象: `packages/player-web-core` / `packages/player-react` / `packages/player-vue` / `packages/player-web-demo` / 関連する `packages/player` の chart runtime 参照 / `docs`
- この文書は上記時点の browser player 実装範囲を反映します。

## 現在のアーキテクチャ

ブラウザ版 player は、framework 非依存の描画 core と、薄い framework adapter に分けて実装します。

- `@be-music/player-web-core`
  - ドロップしたフォルダ / ZIP / loose chart files の読み込み
  - ブラウザ内での譜面 parse
  - timing 解決
  - PixiJS による楽曲一覧と gameplay 描画
  - Web Audio によるリアルタイム再生
- `@be-music/player-react`
  - browser core の薄い React adapter
- `@be-music/player-vue`
  - browser core の薄い Vue adapter
- `@be-music/player-web-demo`
  - ローカル確認用の Vite demo

## 現在の実装状況

### 実装済み

- ローカルフォルダ、ZIP、loose chart files のドロップ読み込み
- BMS / BME / BML / BMSON / be-music JSON のブラウザ parse
- title、subtitle、artist、genre、difficulty、level、base BPM を含む楽曲一覧表示
- BPM change と STOP のリアルタイム時間解決
- PixiJS ベースの gameplay scene
- キーボード入力による manual gameplay
- groove gauge、score summary、combo、fast/slow の集計
- `#WAV00` を含む landmine hit 処理
- LNOBJ と BMS legacy LN の抽出
- 全譜面 prerender を行わない Web Audio ベースのリアルタイム再生
- browser High Speed の変更
- gameplay 開始前の BMS control flow 解決
- gameplay 描画における `#SCROLLxx` と `#SPEEDxx` の反映
- `subartist`, `bannerPath`, `totalNotes`, `player`, `rank`, `rankLabel`, `bpmInitial`, `bpmMin`, `bpmMax` を含む song summary 拡張
- browser song summary 向けの決定的な `previewContinueKey` 導出
- `#PREVIEW` 優先と fallback preview scheduler を備えた song-list preview playback

### 実装済みだが CLI より簡略化されているもの

- Long note 判定はあるが、CLI player の long-note mode 挙動とはまだ完全一致していない
- 楽曲一覧 metadata はあるが、CLI music select summary ほど多くない
- gameplay のレーン表示は browser 向け実装であり、terminal player の表示意味論とは部分一致に留まる

## CLI 版に対する chart 関連の未追従項目

以下は CLI player には実装されているが、browser player ではまだ未実装または未追従の chart 関連挙動です。

### 1. BGA / layer / POOR / video / loading assets

CLI player は次を扱います。

- base BGA
- layer BGA
- layer2 BGA
- POOR BGA
- `#POORBGA`
- POOR BGA 用 `#BMP00` fallback
- video BGA
- `#STAGEFILE`
- `#BANNER`

browser player には、gameplay 中や楽曲一覧における同等の BGA パイプラインがまだありません。

### 2. 不可視ノートと lane-fallback keysound

CLI player は不可視ノートを別抽出し、manual input 補助と lane-fallback keysound に使います。
browser player は現在、可視ノートと地雷だけを判定対象にしており、不可視ノート抽出と lane-fallback sample trigger を実装していません。

### 3. 動的判定幅変更

CLI player は `#xxxA0` と `#EXRANKxx` による runtime 中の judge window 変更に対応しています。
browser player は gameplay 開始時に 1 回 judge window を解決するだけで、再生中の変更を反映しません。

### 4. UI/BGA 由来の再生終了延長

CLI player は、UI/BGA runtime の都合で playback end を延長できます。
browser player は現在、主に chart event と note tail から duration を決めています。

## ロードマップ

browser player は次の順序で拡張するのが望ましいです。

### Phase 1: chart 解釈の正しさを揃える

状態:

- 完了

完了済み:

- BMS control flow を song summary と gameplay の前に解決する
- browser 側 song metadata を CLI 選曲 summary に近づける
- 決定的な preview identity と song-list preview playback を追加する

### Phase 2: gameplay 意味論の追従

状態:

- 進行中

完了済み:

- browser gameplay 描画に `#SCROLLxx` と `#SPEEDxx` timeline を追加

目標:

- CLI player のノート描画意味論へ近づける
- manual input の意味論を CLI に近づける

作業項目:

1. browser gameplay 描画に `#SCROLLxx` と `#SPEEDxx` timeline を追加する
2. 不可視ノート抽出と lane-fallback keysound を追加する
3. runtime 中の `#EXRANKxx` / `A0` judge window 変更を追加する
4. long note 挙動を CLI parity に近づける

この順にする理由:

- gameplay の正しさに直結するが、basic chart load/play 自体は現状でも可能
- control flow が未解決のままだと誤った event 列に対して実装することになる

### Phase 3: media parity と仕上げ

目標:

- CLI player の media / presentation 挙動へ実用上追従する

作業項目:

1. browser song list に `#BANNER` を表示する
2. pre-game loading state に `#STAGEFILE` を表示する
3. gameplay BGA を段階的に追加する
   - static base BGA
   - layer / layer2 / POOR BGA
   - video BGA
4. media 再生要件に応じて playback end を延長する

この順にする理由:

- media 系は価値が高い一方で、chart 解釈差分より規模が大きい
- static image を先に入れてから video へ進む方がリスクと調査コストを抑えやすい

## Browser 専用方針

browser player は現在 local-first です。
近い将来のロード方法は、ユーザーがドロップしたフォルダと ZIP archive を前提にしています。

将来的な方向性は次のとおりです。

1. chart discovery 用 registry server
2. ZIP ベースの chart package 配布
3. ダウンロードした chart bundle を browser 側で load / play

この remote loading 経路を導入した時点で、この文書には次も追記する必要があります。

- package integrity 要件
- archive layout の前提
- asset resolution policy
- caching policy
- browser security constraints
