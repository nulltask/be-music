[English](./dan-rank.md)

# プレイヤーの段位

#552（#373 の積み残し）のために 2026-11-02 調査。問いは、LR2 と beatoraja が GRADE（段位）コースのクリアをどうプレイヤーの段位に変えるか、そしてスキンがそれをどこに出すかです。答えで be-music が何を保持し何を表示するかが決まります。be-music の動作は[コースと段位認定](../course.ja.md#プレイヤーの段位)を参照してください。

読んだ資料: OpenLR2 の [`583a385`](https://github.com/GOMazk/OpenLR2/tree/583a38503555e59c4bafa49d60b9d0714c9007c2)（`LR2body.exe` の逆コンパイル）と beatoraja [0.8.9](https://github.com/exch-bms2/beatoraja/tree/0.8.9)。OpenLR2 は逆コンパイルなので、「OpenLR2 は X をしない」は変換済みのコードが X をしないという意味です。バイナリそのものは動かしていません。

## 要約

- **LR2** はプレイヤーテーブルにキーモードごとに 1 つの段位の値を持ちます（`grade_7`、`grade_5`、`grade_14`、`grade_10`、`grade_9`）。読み込みと保存はしますが、OpenLR2 にはコースの結果からこれを設定するコードがなく、スキンの数値・文字列・画像のどれもこれを読みません。古い組み込みの段位認定の名残で、`gradeversion` が 0 でないと消去されます。
- **beatoraja 0.8.9** は独自の段位を持ちません。`PlayerInformation.rank`（段位）は、インターネットランキングのサーバーがライバルについて送る自由な文字列です。これを表示するスキンのプロパティはなく、コースのクリアがこれを書くこともありません。`CourseData.isClassCourse()` はありますが、呼ぶ箇所がありません。
- どちらのプレイヤーもコースを段位に対応づけません。コースが段位コースかどうかは種類だけで決まります（LR2 の `type` 2、beatoraja の制約 `grade` / `grade_mirror` / `grade_random`）。コースが何段にあたるかはコース名（`七段`、`発狂皆伝` など）にしかありません。

したがって、コースから段位への対応と段位の順序は be-music 独自の設計です。どちらのプレイヤーにも合わせる対象がありません。

## LR2（OpenLR2）

### 段位の保存場所

スコアデータベースの `player` テーブルは、キーモードごとに整数の列を 1 つずつ持ちます（[LR2f.cpp L19212](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L19212)）。

```sql
CREATE TABLE player(..., grade_7 INTEGER, grade_5 INTEGER, grade_14 INTEGER, grade_10 INTEGER, grade_9 INTEGER,
  trial INTEGER, option INTEGER, systemversion INTEGER, gradeversion INTEGER, trialversion INTEGER, scorehash TEXT)
```

`PLAYERSTATISTIC` はこれを `grade7`、`grade5`、`grade14`、`grade10`、`grade9` として `gradeversion` と並べて持ちます（[structure.h L1348-L1374](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/structure.h#L1348-L1374)）。つまり LR2 は **キーモードごとに 1 つの段位** を持ちます。7 鍵、5 鍵、14 鍵（DP）、10 鍵（DP）、9 鍵（PMS）です。

### 読み書き

- `ReadPlayerScore` はログイン時に 5 列を読みます（[L18318-L18322](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18318-L18322)）。行の `scorehash` が合わなければ、段位を含むすべての統計を初期化します（[L18337-L18359](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18337-L18359)）。`gradeversion` が 0 でなければ 5 つの段位を初期化して `gradeversion` を 0 にし、「段位認定が更新されたのでデータを初期化しました」とログに書きます（[L18361-L18374](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L18361-L18374)）。
- `MakePlayerStatHash` はこれを `scorehash` に含め、`UpdatePlayerStat` はそのまま書き戻します（[L16969-L16984](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L16969-L16984)）。
- ほかに触る箇所はありません。代入は上の初期化だけです。コースの結果（`ProcS_CourseResult` → `CheckCourseClear` → `ProcS_subCourseResult`、[L9592-L9760](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L9592-L9760)）は、コース自身の自己ベスト、プレイ回数、クリア数と失敗数を更新して `UpdatePlayerStat` を呼びます。コースの種類にかかわらず段位は設定しません。

### スキン

`SetObjectValue_Num` はプレイヤーの統計を数値 30-41 として出します。プレイ回数、クリア数、失敗数、判定、コンボ、最大コンボ、トライアルの段階です（[L496-L519](https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L496-L519)）。どれも `grade` を読みません。コースの op はカーソル下のコースや遊んでいるコースのもので（種類の画像 291-293、数値 250-259、文字列 150-170。[LR2 スキン](../lr2-skin.ja.md)を参照）、プレイヤーの段位ではありません。「トライアル」（数値 40/41、文字列 82/83）は LR2 のミッションの段階（`CheckMission`）で、段位ではありません。

**未確認:** OpenLR2 が変換していないコードでバイナリが `grade_*` を書くかどうか。関数一覧は 451 関数を変換済み、11 関数をスキップと記録しています（ハッシュ・MD5・時刻の補助）。スキップしたものにプレイヤーの統計に触るものはありません。`gradeversion` による初期化は、古い LR2 がかつて自分で段位を認定していたことを示唆します。その版は調べていません。

## beatoraja 0.8.9

- `PlayerInformation` は `id`、`name`、`rank`（コメントは「段位」）を持ちます（[PlayerInformation.java L8-L25](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/PlayerInformation.java#L8-L25)）。スコアデータベースの `info` テーブルに保存します（`rank TEXT`、[ScoreDatabaseAccessor.java L31-L36](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/ScoreDatabaseAccessor.java#L31-L36)、[L108-L127](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/ScoreDatabaseAccessor.java#L108-L127)）。
- 書くのは IR サーバーから読んだライバルだけです。`RivalDataAccessor.createRival` が `IRPlayerData.rank` を写します（[RivalDataAccessor.java L143-L149](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/RivalDataAccessor.java#L143-L149)、[IRPlayerData.java](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/ir/IRPlayerData.java)）。文字列の中身は IR サーバーが決め、beatoraja が導くことはありません。
- これを読むスキンのプロパティはありません。文字列 1 はライバル名、2 はプレイヤー名です（[SkinProperty.java L214-L215](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/skin/SkinProperty.java#L214-L215)、[StringPropertyFactory.java L174-L183](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/skin/property/StringPropertyFactory.java#L174-L183)）。Lua の `main_state` API にもありません。
- コースの結果は、ほかのスコアと同じく、ステージのハッシュ・LN モード・制約の下にコースのスコアを書きます（[CourseResult.java L272](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/result/CourseResult.java#L272)）。段位は設定しません。
- `CourseData.isClassCourse()` はコースに `CLASS` / `MIRROR` / `RANDOM` の制約があるかを返します（[CourseData.java L84-L91](https://github.com/exch-bms2/beatoraja/blob/0.8.9/src/bms/player/beatoraja/CourseData.java#L84-L91)）。0.8.9 には呼ぶ箇所がありません。スキンは制約のオプション 1002-1004（`OPTION_GRADEBAR_CLASS` など）で段位コースを見分けます。

## be-music にとっての意味

| 問い                     | LR2                              | beatoraja 0.8.9                | be-music                                                                                                       |
| ------------------------ | -------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 段位を保持するか         | キーモードごとの列。設定されない | ライバルの IR 由来の文字列だけ | 判定ルールセットとキーモードごとの、クリアした最高の段位                                                       |
| どのコースが数えられるか | —                                | —                              | クリアした GRADE コースの実行のうち、自己ベストを残すもの                                                      |
| コースは何段を与えるか   | —                                | —                              | コース名から読む（`resolveCourseDanRank`）。どちらのプレイヤーとも照合していない                               |
| 段位の順序               | —                                | —                              | be-music の段位表: 十級 … 一級、初段 … 十段、中伝、皆伝、発狂初段 … 発狂十段、発狂皆伝、Overjoy（`DAN_RANKS`） |
| どのスキンが出すか       | op なし                          | プロパティなし                 | be-music スキンの `frame.danRanks`。組み込みの Plain スキンでは選曲画面のヘッダ                                |

キーモードごとに分けるのは LR2 の列に倣います。判定ルールセットごとに 1 つ持つのは、be-music の自己ベストの持ち方に倣います。どちらのプレイヤーも段位を表示しないので、LR2 の op や beatoraja のプロパティは足しません。テーマで出したい場合は拡張が必要で、未定のままです。
