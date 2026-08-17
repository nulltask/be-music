[English version](./playlog.md)

# プレイログ（プレイ履歴）仕様

このドキュメントは be-music のプレイログ（ゲームプレイ中に記録されるプレイ履歴ファイル）と、そこから
LR2 / beatoraja / IIDX のリザルトを再現するツールについて説明します。

## 設計原則: 「結果ログ」ではなく「入力リプレイ」

プレイログは意図的に**判定結果の列ではありません**。正本となるデータは次の 3 つです。

1. **`chart`** — 実際に画面を流れた解決済み譜面。`#RANDOM` 制御構文の解決後、レーンシャッフル
   （RANDOM / MIRROR / S-RANDOM）と DP FLIP の適用後の最終配置です。ロングノートは `timeUs` / `endTimeUs`
   を持つ 1 オブジェクトとして保存し、地雷は解決済みのゲージダメージを持ち、`#TOTAL` / `#RANK` /
   `#DEFEXRANK` は生の値のまま保持します（各ルールセットが自分のデフォルト式を適用できるように）。
2. **`inputs`** — プレイアブルレーンに届いた全ての生のキー押下・解放
   （`{ seq, timeUs, action: 'down' | 'up', channels }`）。入力は判定へ変換せず、ノート ID への割り当ても
   行わず、空 POOR の原因になる「ノートに対応しない入力」もすべて残します。ソートキーは常に
   `(timeUs, seq)` で、`seq` が同時刻イベントの順序を確定します。
3. **`play`** — スコアに影響する設定。モード（manual / auto）、オートスクラッチ、選択ゲージ、最終配置を
   生んだレーンオプションのラベル、デバッグ用判定幅オーバーライド、ESC 中断フラグです。

判定数・EX スコア・コンボ・ゲージ値は **`results`**（ルールセット ID をキーとする再生成可能なキャッシュ。
`native` は記録時のエンジン自身のサマリ）にのみ存在します。正本が入力列なので、後からルールセットを修正
しても、過去の全プレイを取り直しなしで再計算できます。

時刻は譜面ゼロ基準の整数マイクロ秒です（エンジンのノート時刻と同じ t = 0）。

TypeScript 型・シリアライザ・防御的パーサは
[`packages/player/src/playlog/format.ts`](../packages/player/src/playlog/format.ts)（`@be-music/player/playlog`）
にあります。推奨拡張子は `.bmplay.json` です。

## 記録

記録はエンジン側が担い、全ホスト（ブラウザの LR2 / beatoraja シーン、将来の TUI 採用）が 1 つの実装を共有
します。`PlayerOptions.onPlaylogRecorded` を設定すると記録が有効になり、エンジンは prepared chart を
スナップショットし、判定対象の押下（`lane-input`）と解放（`kitty-state` release）を `pressedAt` 補正済みの
譜面相対時刻で記録し、空 POOR を native キャッシュ用にカウントし、`autoPlay` / `manualPlay` の解決直前
（ESC 中断時を含む）に組み上がった `BeMusicPlaylog` をコールバックへ渡します。エンジンが知り得ない
ホスト側設定（選択ゲージ、レーンオプションのラベル、DP FLIP、自由形式の `native` 追加情報）は
`PlayerOptions.recordPlaylog` で渡します。

ブラウザプレイヤーでは:

- LR2 / default ゲームプレイシーンは `PixiGameplayResultData.playlog` として公開します。
- beatoraja ゲームプレイシーンは `PixiBeatorajaGameplayView.getPlaylog()` として公開します。
- デモはリザルトシーンのマウント時に `<タイトル>-<タイムスタンプ>.bmplay.json` を自動ダウンロードします。
  Debug Menu の **Auto-save play history** チェックボックス（デフォルト ON）で制御します。プレイログ関連
  オプションは曲の開始時にラッチされ、曲の途中では変更できません — プレイ中はチェックボックスが disabled
  になり、曲開始時点の値がそのプレイに適用されます。

## リプレイ再生

`*.bmplay.json` ファイルをブラウザプレイヤーへドロップすると、対応する楽曲がロード済みの場合にリプレイ再生が
始まります（曲フォルダとログを同時にドロップしても動作します — 曲のロード後にリプレイが始まります）。
楽曲のマッチングは `play.native.chartPath` に記録された chartPath の完全一致を優先し、それが無い古いログは
タイトル＋アーティストで照合します。

リプレイは共有エンジン内で記録済み入力列を決定論的に再駆動します（`PlayerOptions.replayInputs`）。各イベントは
記録された譜面相対マイクロ秒の時刻ちょうどで発火し、ライブのレーン入力は無視され（ESC / ポーズ / ハイスピは
有効）、リプレイ実行では新しいプレイログを記録しません。ログは解決済みの最終配置を保存しているため、譜面準備
では RANDOM / MIRROR を引き直す代わりに記録済みチャンネルを再適用します（`applyPlaylogArrangement`）— つまり
シャッフルされたプレイも正確にリプレイできます。`#RANDOM` 制御構文の分岐が記録時と異なる譜面は再整列できない
ため、ステータス表示でエラーになります。リプレイは記録時のスキンファミリーに関わらず常に LR2 / default の
ゲームプレイパスで実行されます。

## LR2 / beatoraja / IIDX リザルトの再現

`@be-music/player/playlog` の `simulatePlaylog(playlog, { ruleset })` が 1 ルールセットで入力列を再生し、
`simulatePlaylogRulesets(playlog)` が 3 つ全てを実行します。判定幅・ノート選択・ロングノート仕様・
空 POOR・ゲージ表がルールセットごとに異なります。定数の出典は
[`packages/player/src/playlog/rulesets.ts`](../packages/player/src/playlog/rulesets.ts) に記載しています。

| 項目 | LR2 (`lr2/1`) | beatoraja (`beatoraja/1`) | IIDX (`iidx/1`) |
| --- | --- | --- | --- |
| 出典 | lr2oraja / OpenLR2 | beatoraja master | コミュニティ実測 (iidx.org) |
| 判定幅（RANK NORMAL） | ±18/±40/±100/±200 ms | ±15/±45/±112.5/late 210 · early 165 ms（7K, judgerank 75 %） | ±16.67/±33.33/±116.67/±250 ms |
| ランクスケーリング | LR2 アンカー補間、BAD 固定 | judgerank 線形、空 POOR 窓固定 | なし |
| ノート選択 | Lowest + multi-BAD 連鎖 | Combo（デフォルト。duration / lowest / score 選択可） | Lowest |
| ロングノート | 全て LN（終端確定の 1 判定） | ノートごとの LN / CN / HCN | 全て CN（mode 3 は HCN ゲージ） |
| 空 POOR 窓 | 早側のみ 1000 ms | late 150 / early 500 ms（7K） | 未測定 — beatoraja の窓を代用 |
| マネースコア | `(4·PG + 2·GR + GD) × 50000 / notes` | — | —（BISTROVER で廃止） |
| ゲージ | lr2oraja LR2 表（2 % 未満即死、32 % 未満ダメージ ×0.6） | beatoraja ネイティブ表 | iidx.org 表（a 値回復、HARD は 30 % 以下でダメージ半減） |

EX スコアは全ルールセットで PGREAT × 2 + GREAT × 1、DJ LEVEL は IIDX の 9 分率です。チャージノート系の
ルールセットはロングノートの始点・終端を 2 判定ノートとして数えます（各ルールセットの分母は
`result.noteCount` が報告します）。

### 再現度に関する注意

- LR2 ルールセットは lr2oraja に従い、OpenLR2 の書き起こしと相互検証しています。両者が食い違う箇所
  （LN 頭の見逃し POOR 閾値、HAZARD 表）は lr2oraja の挙動を採用しています。
- IIDX の内部仕様は非公開です。判定幅・ゲージ表・DJ LEVEL 境界は現在のコミュニティ実測の合意値であり、
  空 POOR 窓と CN 終端窓は未測定のため beatoraja の値を代用、HCN のゲージ tick は実測されている
  16 分音符間隔の代わりに固定 200 ms を使用しています。「ほぼ一致」は期待できますが、ビット単位の
  完全一致は保証されません。
- beatoraja の未モデル化要素: PMS の「1 ノートにつき空 POOR 1 回」規則、PMS の 200 ms チャージ解放
  マージン、SEVENKEYS 以外のモード別ゲージ表（全モードで 7K のゲージ定数を使用）。
- プレイログは解決済み譜面を保存するため、プレイヤー間の `#RANDOM` やレーンシャッフルの実装差は
  再シミュレーションに影響しません。

## CLI

`@be-music/player-tui` は 2 つ目のバイナリ `bms-playlog` を提供します。

```bash
pnpm playlog -- results/Song-2026-08-17T10-00-00-000Z.bmplay.json
```

オプション: `--ruleset=lr2,beatoraja,iidx|all`、`--gauge=<id>`（ルールセット固有のゲージ上書き）、
`--algorithm=combo|duration|lowest|score`（beatoraja のノート選択）、`--json`。

## バージョニング

`format: "be-music-playlog"`、`version: 1`。未知の追加フィールドはパース時に無視されるため、後方互換の
追加は version を変えずに行えます。非互換変更は `version` を上げます。ルールセット結果 ID は独自の
リビジョン（`lr2/1` など）を持ち、ルールセットの修正はリビジョンを上げて既存ファイルを再計算するだけです。
