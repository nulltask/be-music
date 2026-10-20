[English](./README.md)

# サービスのテーマ

Accounts と Dashboard 用の非公開 CSS 基盤です。`SERVICE_CSS` は Leaderboard の Basecoat の無彩色、システムフォント、幅 64rem のレイアウト、Vega の操作部品に合わせています。JavaScript なしでシステムの配色に追従し、キーボードのフォーカス表示、本文へのスキップリンク、レスポンシブなヘッダーを提供します。

配色は `packages/leaderboard-api/src/pages/app.css` と、その Basecoat 依存関係に合わせます。非公開の寄付サイトは `src/service-theme.ts` にコピーを持つため、このスタイルシートを変えるときは一緒に更新します。プレイヤーはスキンによる独自の UI を持ち、このテーマを使いません。
