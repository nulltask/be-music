/** Status text the Accounts page script shows, in the page language (`<html lang>`). */

const en = {
  requestFailed: 'Request failed',
  continueFailed: 'Sign-in could not be continued. Return to the app and start again.',
  tryAgain: 'Request failed. Please try again.',
  profileFailed: 'Profile update failed',
  cannotPrepare: 'Cannot prepare image',
  cannotEncode: 'Cannot encode image',
  errors: {
    'invalid-handle': 'Handles are 3 to 15 letters, digits or _.',
    'invalid-display-name': 'That display name cannot be used.',
    'handle-taken': 'That handle is taken.',
    'not-found': 'That profile was not found.',
    'sign-in-required': 'Sign in first.',
    'invalid-origin': 'That request was refused.',
    'invalid-json': 'That request could not be read.',
    'invalid-profile': 'That profile cannot be saved.',
    'avatar-too-large': 'The image is too large.',
    'unsupported-image': 'Use a PNG, JPEG or WebP image.',
    'empty-body': 'Choose an image.',
    'method-not-allowed': 'That request was refused.',
  },
};

export type ClientMessages = typeof en;

const ja: ClientMessages = {
  requestFailed: 'リクエストに失敗しました',
  continueFailed: 'ログインを続行できませんでした。アプリに戻って、もう一度始めてください。',
  tryAgain: 'リクエストに失敗しました。もう一度試してください。',
  profileFailed: 'プロフィールを更新できませんでした',
  cannotPrepare: '画像を準備できません',
  cannotEncode: '画像を書き出せません',
  errors: {
    'invalid-handle': 'ユーザー名は英数字と _ で 3〜15 文字です。',
    'invalid-display-name': 'その表示名は使えません。',
    'handle-taken': 'このユーザー名はすでに使われています。',
    'not-found': 'プロフィールが見つかりません。',
    'sign-in-required': '先にログインしてください。',
    'invalid-origin': 'このリクエストは拒否されました。',
    'invalid-json': 'リクエストを読めませんでした。',
    'invalid-profile': 'プロフィールを保存できません。',
    'avatar-too-large': '画像が大きすぎます。',
    'unsupported-image': 'PNG・JPEG・WebP の画像を使ってください。',
    'empty-body': '画像を選んでください。',
    'method-not-allowed': 'このリクエストは拒否されました。',
  },
};

/** English unless the page language is Japanese. */
export function clientMessages(lang: string | null | undefined): ClientMessages {
  return lang?.toLowerCase().split('-')[0] === 'ja' ? ja : en;
}

/** A sentence for an Accounts API error code, or the code itself when it is already a sentence from the auth library. */
export function describeClientError(code: string | undefined, fallback: string, messages: ClientMessages): string {
  if (code !== undefined && code in messages.errors) return messages.errors[code as keyof typeof messages.errors];
  return code ?? fallback;
}
