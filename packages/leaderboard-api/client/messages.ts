/** The client script's messages, in the page's language (`<html lang>`), English by default. */

const en = {
  somethingWentWrong: 'Something went wrong.',
  signInFailed: (reason: string) => `Sign-in failed: ${reason}`,
  passkeyFailed: (reason: string) => `Creating the passkey failed: ${reason}`,
  accountStartFailed: (reason: string) => `Could not start the account: ${reason}`,
  passkeyNotMade: (reason: string) =>
    `Your account is ready, but the passkey was not made (${reason}). Add one in Settings to keep it.`,
  cannotDrawImage: 'This browser cannot draw the image.',
  cannotEncodeImage: 'This browser cannot encode the image.',
  cannotDrawCard: 'This browser cannot draw the card.',
  cannotEncodeCard: 'This browser cannot encode the card.',
  cardReady: 'Your share card is ready.',
  linkCopied: 'Link copied.',
  copyNotAllowed: 'Copying is not allowed here; copy the address bar instead.',
  cardFailed: (reason: string) => `The share card could not be made: ${reason}`,
  errors: {
    handleReserved: 'That handle is reserved. Pick another.',
    handleFormat: 'Handles are 3 to 15 letters, digits or _.',
    nameEmpty: 'The name cannot be empty.',
    nameLength: 'Names are at most 32 characters.',
    nameCharacters: 'Names cannot contain line breaks or control characters.',
    handleTaken: 'That handle is taken.',
    avatarTooLarge: 'The image is too large.',
    unsupportedImage: 'Use a PNG, JPEG or WebP image.',
    signInRequired: 'Sign in first.',
    notYourScore: 'Only the player of this play can change it.',
    notFound: 'This play no longer exists.',
    unknown: (error: string) => `Something went wrong (${error}).`,
  },
};

export type ClientMessages = typeof en;

const ja: ClientMessages = {
  somethingWentWrong: '問題が発生しました。',
  signInFailed: (reason) => `ログインできませんでした: ${reason}`,
  passkeyFailed: (reason) => `パスキーを作成できませんでした: ${reason}`,
  accountStartFailed: (reason) => `アカウントを作成できませんでした: ${reason}`,
  passkeyNotMade: (reason) =>
    `アカウントを作成しましたが、パスキーを作成できませんでした（${reason}）。設定からパスキーを追加すると、ほかの端末からもログインできます。`,
  cannotDrawImage: 'このブラウザでは画像を描画できません。',
  cannotEncodeImage: 'このブラウザでは画像を書き出せません。',
  cannotDrawCard: 'このブラウザではカードを描画できません。',
  cannotEncodeCard: 'このブラウザではカードを書き出せません。',
  cardReady: '共有カードができました。',
  linkCopied: 'リンクをコピーしました。',
  copyNotAllowed: 'ここではコピーできません。アドレスバーからコピーしてください。',
  cardFailed: (reason) => `共有カードを作成できませんでした: ${reason}`,
  errors: {
    handleReserved: 'このユーザー名は使えません。別のユーザー名を選んでください。',
    handleFormat: 'ユーザー名は英数字と _ で 3〜15 文字です。',
    nameEmpty: '表示名を入力してください。',
    nameLength: '表示名は 32 文字までです。',
    nameCharacters: '表示名に改行や特殊な制御文字は使えません。',
    handleTaken: 'このユーザー名はすでに使われています。',
    avatarTooLarge: '画像が大きすぎます。',
    unsupportedImage: 'PNG・JPEG・WebP の画像を使ってください。',
    signInRequired: '先にログインしてください。',
    notYourScore: 'このプレイを変更できるのは、プレイしたプレイヤーだけです。',
    notFound: 'このプレイはもう存在しません。',
    unknown: (error) => `問題が発生しました（${error}）。`,
  },
};

/** The messages for a page language such as `ja` or `en-US`; English for anything else. */
export function clientMessages(lang: string | null | undefined): ClientMessages {
  return lang?.toLowerCase().split('-')[0] === 'ja' ? ja : en;
}
