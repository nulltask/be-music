[English version](./README.md)

# @be-music/leaderboard-api

be-music の Leaderboard API です。Cloudflare Workers 上の Hono アプリで、D1 と R2 を使います。設計は
[docs/leaderboard.ja.md](../../docs/leaderboard.ja.md) にあり、この README は動かし方とデプロイ方法を扱います。

## 実装済みのもの

- Better Auth によるログイン: 匿名セッション、passkey、secret が設定されていれば Discord / Google の OAuth。
- `POST /api/v0/scores`: プレイログ（gzip）を送信します。サーバーは対象かどうかの判定と、play / chart fingerprint の
  ドキュメントの確認（検証の層 L1〜L3、`#RANDOM` のない譜面では L4 も）を行い、`lr2`・`beatoraja`・`iidx` で再計算し、
  ログを R2 に保存して自己ベストを更新します。再送された同じプレイはそれと分かり、別のアカウントからの同じプレイは
  拒否します。
- `GET /api/v0/charts/:chartFingerprint/leaderboard` と `.../leaderboard/me`: ランキング。アシスト付きのプレイ、匿名の
  プレイヤー、「このルールセットでプレイしたもの」のフィルタ付き。
- `GET /api/v0/scores/:id` と `.../playlog`。
- コースのプレイ（docs/leaderboard.ja.md 6.1 節）: `POST /api/v0/course-scores`、最新のプレイ、1 プレイ、そのプレイログ、
  プレイの非表示、コース、そのランキングと自分の順位。コースとルールセットごとのベスト（トロフィーのベストを含む）を持ちます。
- `GET /api/v0/openapi.json`: OpenAPI 3.1 のドキュメント。ルートの valibot スキーマ（`src/api/schemas.ts`）から生成します。リファレンスページは `/api-reference` です。コピーを [`openapi.json`](./openapi.json) としてコミットしており、古くなるとテストが失敗します。API を変えたら `vp test run -u` で更新してください。

- `leaderboard.be-music.app` のルートのページ: 新着スコアとコースのプレイ（トップ）、スコア、譜面のランキング、作品、コース、
  コースのプレイ、プレイヤー。

未実装: 新しい `#RANDOM` の結果に対する L4 と L5、ライバル、OG カード。

スコアの送信を、Worker が確かめる順に示します（`src/api/v0.ts`、`src/scores/submit.ts`）。クライアントを含む全体のシーケンスは [docs/leaderboard.ja.md 5.2 節](../../docs/leaderboard.ja.md#52-シーケンス) にあります。

```mermaid
flowchart TD
  post(["POST /api/v0/scores"]) --> gate{"ログイン済み、レート制限内、<br/>正しく対象のプレイログ?"}
  gate -->|いいえ| e4xx["401 / 429 / 400 / 422"]
  gate -->|はい| dup{"submission id が<br/>保存済み?"}
  dup -->|"はい、同じプレイヤー"| r200["200: 保存済みの結果"]
  dup -->|"はい、別のアカウント"| e409["409"]
  dup -->|いいえ| docs{"ドキュメントが fingerprint<br/>と一致（L1〜L4）?"}
  docs -->|いいえ| reject["409 / 422"]
  docs -->|はい| sim["lr2・beatoraja・iidx<br/>で再計算"]
  sim --> store["R2: プレイログ<br/>D1: スコア、結果、ベスト"]
  store --> r201["201: 結果と順位"]
```

## 準備

Worker は Vite+ で `dist/worker.js` にバンドルします（`build:worker`、設定は `vite.worker.config.ts`）。これが
`cloudflare.config.ts` がデプロイするエントリポイントです。ワークスペースのパッケージは `source` エクスポート条件で
ソースを直接読むので、個別のビルドは要りません。`cf` は自前の esbuild でエントリポイントをバンドルしますが、この条件を
知らないので、出来上がったバンドルを読み直すだけにしています。`dev` とデプロイは先に `build:worker` を実行します。
`cf dev` の実行中に `src/` を変えたら作り直すと、`cf dev` が読み込み直します。

```bash
pnpm --filter @be-music/leaderboard-api run build:worker
```

リソースは be-music のアカウントに作成済みです（D1 と R2 を APAC に、環境ごとに 1 つずつ）。D1 の id は
`cloudflare.config.ts` とマイグレーションのスクリプトに書いてあります。新しい環境では作成して id を記録します。

```bash
pnpm exec cf d1 create --name leaderboard-preview --primary-location-hint apac
```

```bash
pnpm exec cf r2 buckets create --name be-music-leaderboard-preview --location-hint apac
```

### Secrets

secrets は 1Password の `my.1password.com` アカウントの `be-music` Vault に、Worker ごとに 1 アイテム（`be-music-leaderboard-preview`、`be-music-leaderboard`。それぞれ `leaderboard-preview` と `leaderboard` の secret）で保存しています。リポジトリには参照だけを置きます。`secrets/<環境>.env.tpl` が各 secret と 1Password のフィールドを対応づけます（`KEY={{ op://… }}`）。[1Password CLI](https://developer.1password.com/docs/cli/) にサインインした状態で、Worker に設定します。

```bash
pnpm --filter @be-music/leaderboard-api run secrets:preview
```

`scripts/put-secrets.ts` は各値を `op read` で読み、`cf workers secrets update` に渡します。ディスクにも画面にも値は出ません。別の 1Password アカウントを使うときは `OP_ACCOUNT` を指定します。secret を入れ替えるときは 1Password で生成し直してスクリプトを再実行します（`BETTER_AUTH_SECRET` を入れ替えると全員のログインが切れます。パスキーは残ります）。

アカウントに触れる操作は Wrangler ではなく `cf` で行います。Wrangler は独自にログイン情報を持っていて、別の Cloudflare アカウントを指していることがあります。

`cloudflare.config.ts` で宣言した secret はデプロイのたびに必須です。新しい Worker の最初のデプロイではファイルで渡す必要があります（`cf deploy --secrets-file`）。名前付きパイプを使えば値をディスクに書かずに済みます。

```bash
d=$(mktemp -d) && mkfifo -m 600 "$d/secrets" && (op inject -i secrets/preview.env.tpl > "$d/secrets" &) && pnpm exec cf deploy --mode preview --secrets-file "$d/secrets"; rm -rf "$d"
```

以降のデプロイでは設定済みの secret が引き継がれます。

| Secret                                       | 用途                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                         | セッションの署名。長いランダムな文字列                         |
| `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` | Discord でのログイン（任意。未設定なら無効。追加時に宣言する） |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`   | Google でのログイン（任意。未設定なら無効。追加時に宣言する）  |

## データベース

スキーマは `src/db/schema.ts` にあります。変更したらマイグレーションを生成してコミットします。

```bash
pnpm --filter @be-music/leaderboard-api run db:generate
```

マイグレーションはデプロイより先に実行するので、動いている旧コードと両立させます（追加 → 切り替え → 削除）。

```bash
pnpm --filter @be-music/leaderboard-api run db:migrate:preview
```

## デプロイ

環境は、どのサービスとも同じく 2 つです（docs/services.ja.md 2 章）。`main` が本番、`devel` がプレビューです。

| 環境       | Worker                | ホスト                             | D1                    | R2                             |
| ---------- | --------------------- | ---------------------------------- | --------------------- | ------------------------------ |
| 本番       | `leaderboard`         | `leaderboard.be-music.app`         | `leaderboard`         | `be-music-leaderboard`         |
| プレビュー | `leaderboard-preview` | `leaderboard.preview.be-music.app` | `leaderboard-preview` | `be-music-leaderboard-preview` |

`main` か `devel` に push するたびに、Deploy ワークフロー（`.github/workflows/deploy.yml`）が動きます。その環境の D1 に
マイグレーションを適用してから、ほかの Worker より先にこの Worker をデプロイします。ほかの Worker がこの Worker を
バインドしているためです。

```mermaid
flowchart TD
  push([push]) --> branch{ブランチ}
  branch -->|main| prod
  branch -->|devel| prev
  subgraph prod[leaderboard]
    m1[db:migrate:production] --> d1[deploy]
  end
  subgraph prev[leaderboard-preview]
    m2[db:migrate:preview] --> d2[deploy:preview]
  end
```

`deploy` と `deploy:preview` は、ページのアセットを生成し、`build:worker` を実行してから `cf deploy` します。手で
デプロイするときは、このパッケージで同じコマンドを実行します。新しい Worker にはまだ secret がないので、最初の
デプロイでは `--secrets-file` で渡します（例: `cf deploy --secrets-file <(op inject -i secrets/production.env.tpl)`）。

この Worker は、自分のホストでページと API を配信し、Accounts を切り出すまでは全サービスの Better Auth も受け持ちます
（docs/services.ja.md 3 章）。Accounts、Player、Dashboard の Worker は Service Binding でこの Worker を呼び、セッション
Cookie は環境の親ドメインで共有します。

## ページ

ページは Hono JSX で、Tailwind CSS v4 と [Basecoat](https://basecoatui.com)（フレームワークの
ランタイムなしの shadcn/ui デザイン）でスタイルを付けています。`src/pages/app.css` は `src/pages/styles.generated.ts`
にコンパイルされ、`/assets/app.<hash>.css` から配信されます。

スタイルシート、アイコン、シェアカードのフォント、クライアントスクリプト（`src/pages/*.generated.ts`）は生成物で、git には入れません。
`pnpm install`、`dev`、デプロイ、テストの前に生成されます。`cf dev` の実行中にページのクラス、アイコン、`client/`
を変えたら作り直します。

```bash
pnpm --filter @be-music/leaderboard-api run generate
```

`build:css`、`build:icons`、`build:fonts`、`build:client` はそれぞれ 1 つだけ作ります。シェアカードの英数字は [Inter Tight](https://github.com/rsms/inter)（SIL Open Font License 1.1）で、`/assets/` から配信します。

### アイコン

ページのアイコンは `src/pages/icons/icon.svg` です。ブラウザのタブにはこれがそのまま表示されます。ホーム画面用（180 px）と Web アプリマニフェスト用（192 / 512 px）のアイコンはこの SVG から描画します。アイコンを変えるときは SVG を差し替えて、作り直します。

```bash
pnpm --filter @be-music/leaderboard-api run build:icons
```

アイコンは `src/pages/icons.generated.ts` にまとめられ、`/manifest.webmanifest` と並んで `/assets/<名前>.<hash>.<拡張子>` から配信されます。SVG の隣に手描きの PNG（`apple-touch-icon.png`、`icon-192.png`、`icon-512.png`）を置くと、描画したものの代わりにそちらを使います。

## テスト

`pnpm test` で、ワークスペースのほかのテストと一緒にこのパッケージのテストも実行されます。API のテストは Miniflare の
本物の D1 / R2 binding で Hono アプリを動かすので、マイグレーションも確かめます。
