# 仕様書

このディレクトリは、`be-music` リポジトリで使う仕様を Markdown でまとめたものです。

- [BMS 実装仕様](./bms-spec.md)
- [BMSON 実装仕様](./bmson-spec.md)
- [Bemuse 実装仕様](./bemuse-spec.md)
- [Player 実装仕様](./player-spec.md)
- [BMS/BMSON 中間表現 (`@be-music/json`) 実装仕様](./json-spec.md)

補足:

- 公式仕様そのものではなく、**このリポジトリの実装がどう解釈するか**を優先して記述しています。
- 公式仕様と齟齬が出る場合は、まず実装方針を決めてからこのドキュメントを更新してください。
- 大規模な追従更新時は、各仕様書に「監査起点コミット / 監査時点コミット / 監査対象範囲」を明記してください。
- `@be-music/json` は pure IR、`@be-music/chart` は beat 解決やイベント順序などの譜面意味論を担当します。
