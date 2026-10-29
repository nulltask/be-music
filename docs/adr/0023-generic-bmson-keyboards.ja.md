[English](./0023-generic-bmson-keyboards.md)

# 0023: generic bmson キーボードは宣言した配置を保持する

## 背景

[bmson 仕様](https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst)は、同じチャンネル数でも generic キーボードと beat の配置を区別する。位置順の解析後に beat のモードを推定すると、通常キーが scratch や FREE ZONE になり、疎な譜面では宣言した横幅も失われる。内部の可視チャンネルには、35 列ずつの 2 バンクがある。

## 決定

対応する generic キーボードを `ChartPlayVariant` の `generic-N`、表示名を `N KEY GENERIC` とする。整数の N は 1〜70 に対応し、ゼロや上限超過は丸めず明示的に拒否する。予約した `generic-` 接頭辞の不正な hint は `TypeError` にする。既存の単数形 `generic-Nkey` も保持する。各キー数の共通レイアウトと bmson 表を生成する。位置 1〜35 は `11..1Z`、36〜70 は `21..2Z` を使うが、すべての列を連続した 1P のキーボードに置く。全列を通常の白キーとし、slot は全体で 1〜N とする。格納バンクの接頭辞や使用ノート数からゲームのモードを決めない。

engine は空の列も含め、宣言されたキーボード全体を入力へ結び付ける。scratch の補助と FREE ZONE の別名は適用しない。beatoraja ruleset はすべての generic のキー数に keyboard の判定と既定 TOTAL の区分を使う。上流のモード列挙には generic がないため、これは Be-Music の規則である。beat 固有の battle／変換操作は利用できない。NONSTOP は宣言した generic のキー数を保ち、異なる配置との混在を拒否する。

Native・Canvas・LR2 は等幅のフォールバック列を使う。beatoraja テーマからはノート領域の外周を借りて等分し、モード固有のノート画像を通常キーのフォールバック図形で置き換える。Terminal は白キーの配色を使う。既存テーマの装飾には固定配置の絵が残る場合があるが、ノートの位置と入力配置は generic を保つ。物理キーボードの割り当ては実在する印字キー、続いて F1〜F24 を使う。割り当てた F5 は再開よりレーン入力を優先する。Terminal は [kitty の機能キーの符号化](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions)と [Win32 仮想キーコード](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)を使い、キーの状態を保持する。入力機器・端末の横幅・同時押し数はホスト側の制約となる。

正規 bmson 出力は未使用の列とバンク越えを含め、明示された generic の位置を保つ。未分類の BMS 譜面を変換する際に生成する generic の hint では、使用しているレーンへ連続した番号を振る。明示的な generic 配置はゲームの同一性を BMS に保持できないため、BMS 出力では拒否する。Be-Music JSON と bmson は保持する。

プレイの fingerprint は `generic-N` を含み、因子化した譜面の fingerprint はレーンモードの入力に正規化した generic の hint を保持する。以前は誤分類されていた generic 譜面の fingerprint は修正される。replay はレーンモードの表示名と既存の元 variant のフィールドで同一性を保持し、スキーマのフィールドは増やさない。replay の読み込みでは範囲内の variant を検証する。

## 結果

generic キーボードを parser／model／engine の境界、描画、replay を通して区別する。70 キーの上限は任意の parser の丸めではなく、現在のチャンネル表現に由来する。増やすには新しい内部レーン表現が必要であり、不可視やロングノートのチャンネル系統を借りてはならない。generic 以外の未知の hint は、別の互換方針を維持する。この変更は LR2 や beatoraja 自体の generic 配置対応を意味しない。
