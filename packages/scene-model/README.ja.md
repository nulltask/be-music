[English version](./README.md)

# @be-music/scene-model

be-music プレイヤーの各画面が何を表示し、どう振る舞うかを、どのスキンの種類が描くかに関係なく表すモデルです。
標準・LR2・beatoraja の各スキンの種類はこれらのモデルを共有し、描画だけを受け持ちます
（[ADR 0001](../../docs/adr/0001-skin-families-only-draw.ja.md)、[ADR 0002](../../docs/adr/0002-scene-model-package.ja.md)）。
ターミナルプレイヤーやスキンパッケージからも使えます。

このパッケージは実行環境に依存しません。レンダラー・DOM・Node を使わず、時刻と乱数は入力として受け取るため、どの
モデルもブラウザ・Node・テストで同じように動きます。依存するのは `@be-music/chart`・`@be-music/json`・
`@be-music/player` だけです。

モデルとその規則は [シーンモデル](../../docs/scene-model.ja.md) で説明しています。

## 内容

- **ライブラリ**: 選曲画面が並べる譜面・フォルダ・コース（`LibraryChart`・`LibraryFolder`・`LibraryCourse`・
  `LibraryEntry`）、ルートのフォルダ（`groupChartsByFolder`・`libraryRootFolders`）、譜面のプレイバリアントとキー
  モード、再構築をまたいでバーを指すキー（`libraryEntryKey`）。
- **一覧（ブラウズ）**: 選曲画面のフォルダスタック・カーソル・検索・ソート・フィルター・お気に入りを一つのイミュータブルな
  状態（`BrowseState`）にまとめたもの。コマンド（`reduceBrowse`）で変わり、画面の効果音やアニメーションのために何が
  起きたかを返します。そこから導かれる一覧（`browseEntries`）とスナップショット（`captureBrowse` /
  `restoreBrowse`）、現在の選曲シーンが保持するスナップショットからのアダプターも含みます。
- **プレイオプション**: プレイ前にプレイヤーが選ぶもの（`PlayOptions`）、既定値、各オプションの選択肢、型のない入力
  から設定された値の検証（`resolvePlayOptionValue`・`resolvePlayOptions`）、巡回（`cyclePlayOptionValue`）、
  ハイスピードの範囲（`snapHiSpeed`・`stepPlayerHiSpeed`・`HiSpeedTransition`）。

## 例

```ts
import { browseEntries, captureBrowse, createBrowseState, reduceBrowse, restoreBrowse } from '@be-music/scene-model';

let state = createBrowseState();
const step = reduceBrowse(library, state, { type: 'move', delta: 1 });
state = step.state; // step.event: { kind: 'cursor', from: 0, to: 1, delta: 1 }
state = reduceBrowse(library, state, { type: 'open' }).state;
const bars = browseEntries(library, state);

// プレイをまたぐとき: スナップショットを保持し、その時点のライブラリに対して戻します。
const snapshot = captureBrowse(library, state);
state = restoreBrowse(library, snapshot).state;
```
