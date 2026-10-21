[English version](./0012-native-skin-screens.md)

# DOM の画面でも scene session を共有する

BeMusicSkin は Canvas surface と組み合わせて DOM の画面を mount できる。任意の `dom` factory が select・decide・result の描画を置き換え、gameplay の factory が Canvas のプレイフィールドに DOM の HUD を追加する。factory は専用の mount 要素と意味に基づく操作を受け取り、update と dispose を返す。detach は mount を document から取り外し、再入場のために状態を保持する。dispose は永続的に解放する。Native スキンは shadow tree で CSS を分離し、譜面のメタデータを text node に設定する。

SceneController は既存の scene session を tick ごとに一度だけ進め、同じ frame を描画と購読へ渡す。選択した値の store は値が変わるまで snapshot を維持するため、フレームごとに UI 全体を更新せずにスコアなどを購読できる。controller は時計やグローバル入力を所有しない。描画に依存しない controller entry は既存の select session も公開し、独立したコレクションブラウザーから利用できる。購読の解除では session を停止せず、所有者が明示的に exit・dispose する。

既存のスキンファミリーには単一の Pixi host を維持し、空の Pixi root を使う adapter で DOM の画面を既存のライフサイクルに接続する。すべての画面を一度に新しい host に作り直すと、移行が LR2・beatoraja の互換性にも広がる。DOM mount と独立した select controller は Pixi への実行時依存を持たず、外部アプリケーションは既存 host なしでも利用できる。内部の gameplay preparation と PlayfieldRuntime には描画固有の処理が残り、controller entry の公開契約には含めない。Canvas のキャプチャと録画には Canvas 内の内容が含まれ、DOM HUD は録画 surface の外にある。
