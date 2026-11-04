[English](./README.md)

# サービスのテーマ

Be-Music のサービス用の非公開スタイルと共通の Lit ビューです。ルートエントリーは、コンパイル済みのスタイル、言語のヘルパー、サービスのオリジン、表示用の型を公開します。サーバーの描画関数とテンプレートは `@be-music/service-web-theme/server`、ブラウザーのコンポーネントとテンプレートは `@be-music/service-web-theme/client` から読み込みます。サーバーエントリーはブラウザーのバンドルに含めません。`defineServiceUI()` が共通のステータス要素を明示的に登録し、Shadow DOM が Lit のメッセージを htmx のモーフィングから隔離します。認証パネル、アカウントの表示とアバター、ヘッダーのポップオーバー、言語選択はサービス間でテンプレートを共有します。

`src/theme.css` は Tailwind CSS v4 と [Basecoat](https://basecoatui.com) を読みます。`pnpm --filter @be-music/service-web-theme run build:css` が `src/styles.generated.ts` を書き、`build:server` が Workers 用のサーバーエントリーをバンドルします。`prepare` はインストール時に両方を再生成します。Accounts と Dashboard はコンパイル済みのスタイルシートを使い、ページは Basecoat の class（`btn`、`card`、`input`）と Tailwind のユーティリティを使います。

暗い配色はシステムの配色に従います。Leaderboard はスクリプトで `.dark` を付けますが、これらのページはコンテンツセキュリティポリシーがインラインスクリプトを拒むため、ビルドが Basecoat の暗いトークンを `prefers-color-scheme` の下に繰り返します。

非公開の寄付サイトは `src/service-theme.ts` に独自のコピーを持つため、このスタイルシートを変えるときは別途更新します。プレイヤーはスキンでステージを描き、独自のスタイルシートを組むため、システムの配色に従うこのコンパイル済み CSS は使いません。共有ヘッダは使い、ページ自体は常にダークモードです。

`renderServiceHeader` は Dashboard、Accounts、Leaderboard、Play のヘッダです。ログイン中のユーザー、その次に Play へのリンクか（`settings` を渡したとき）その位置の設定ボタン、そして English / 日本語を出します。タイトルの横に Beta バッジを一つ出します。Play は `settings` を渡し、そのボタンで Options ダイアログを開閉します。Play は `fullscreen` も渡し、設定の隣にフルスクリーンのボタンを出します。切り替えはそのページが行います。他のサービスは `playHref` を渡し、`settings` と `fullscreen` は渡しません。言語は `resolveLocale` が `?lang=`、`be-music-lang` クッキー、`Accept-Language` の順で決めます。

`renderServiceFooter` は Dashboard、Accounts、Play、Leaderboard のフッタです。この 4 つのサービスへリンクし、今いるサービスだけはテキストにします。その後に、そのサイト独自の内容、著作権表示（`© 2026 nulltask · MIT License`）、`renderBuildInfo` が続きます。ページのホスト名を渡すと、プレビューのサイトはプレビューの姉妹サイトへリンクします。不明なホストは、プレイヤーと同じく本番を使います。

そのビルド行には `renderBuildInfo({ builtAt, revision })` を使います。ビルド時に固定した ISO 日時を UTC で、ソースの revision を 8 桁で表示し、完全な revision は title に残します。ビルド処理が実際のチェックアウトから取得し、リクエスト処理では日時を生成しません。
