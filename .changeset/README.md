# Changesets

`be-music` は package ごとに個別 release するため、変更が入った PR では `.changeset/*.md` を追加します。

## 普段の流れ

1. feature ブランチで package を変更する
2. `pnpm changeset` を実行して、変更した package と bump 種別を記録する
3. feature PR を `devel` に merge する

## release の流れ

1. `devel` で `pnpm release:version` を実行する
2. 生成された各 `package.json` と `CHANGELOG.md` をコミットする
3. `devel -> main` の release PR を作る
4. PR を merge すると、version が上がった package だけ GitHub Release が個別に作成される

`@be-music/player` と `@be-music/audio-renderer` は個別 release に SEA zip が添付され、それ以外の package は changelog ベースの GitHub Release のみが作成されます。
