[English version](./README.md)

# @be-music/app-play

folder / ZIP drop、LR2 / beatoraja theme、Options ダイアログ、browser 再生を、1 つのシーンルーターの下のサービスとして接続する private Vite プレイヤーです。土台のランタイムは [`@be-music/player-browser`](../player-browser/README.ja.md) で、プレイヤーの機能はそちらにまとめています。

[Browser player 実装メモ](../../docs/player-web.ja.md) を参照してください。

## 使い方

リポジトリのルートからプレイヤーを起動します。

```bash
pnpm run player:web
```

player は Vite dev server を起動します。BMS/bmson の楽曲 folder、LR2 theme folder、beatoraja theme folder、ZIP、または楽曲 folder と LR2 / beatoraja theme folder の組み合わせを browser に drop できます。

URL から archive を読み込むこともできます。`?music=<zip の URL>&skin=<zip の URL>`（どちらか一方だけでも可）を付けると、drop と同じ経路で archive を読み込みます。cross-origin の `https` URL は同一オリジンの proxy route `/__url-load-proxy` 経由で取得します。この route は Vite dev server と Cloudflare Worker の両方が提供します。

ブラウザ版の操作はスキンの種類とキー設定に従います。[ブラウザプレイヤーの操作](../../docs/player-web.ja.md#options-ダイアログ)を参照してください。

## デプロイ

このプレイヤーの build は Player の Worker [`@be-music/worker-play`](../worker-play/README.ja.md) が配信します。固定している `@ffmpeg/core` が変わったときは core を R2 へ upload します。

```bash
pnpm --filter @be-music/app-play run cf:r2:push
```

`build:cf` は Worker 向けに player を build し、ffmpeg core を Static Assets から外します。
