import { html, nothing, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { Locale } from './locale.ts';

const ICONS = {
  passkey:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  google:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>',
  discord:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg>',
} as const;
const TEXT = {
  en: {
    signIn: 'Sign in',
    signInLead: 'Sign in with a passkey, Google, or Discord.',
    signInPasskey: 'Sign in with a passkey',
    signInGoogle: 'Sign in with Google',
    signInDiscord: 'Sign in with Discord',
    noAccount: 'No account yet? Sign up',
    cancel: 'Cancel',
    or: 'or',
    signUpTitle: 'Create your account',
    signUpLead: 'Pick a handle and a name. Your browser then makes a passkey for it.',
    keepTitle: 'Keep this account',
    keepLead:
      'Give your anonymous account a handle and a name. Your browser then makes a passkey, so its plays join the rankings.',
    signUpGoogle: 'Sign up with Google',
    signUpDiscord: 'Sign up with Discord',
    orPasskey: 'or with a passkey',
    handle: 'Handle',
    handleHint: '3 to 15 letters, digits or _. It names your page.',
    displayName: 'Name',
    nameHint: 'Up to 32 characters, in any script. The rankings show it.',
    createPasskey: 'Create passkey',
  },
  ja: {
    signIn: 'ログイン',
    signInLead: 'パスキー、Google、または Discord でログインします。',
    signInPasskey: 'パスキーでログイン',
    signInGoogle: 'Google でログイン',
    signInDiscord: 'Discord でログイン',
    noAccount: 'アカウントがまだない場合は登録',
    cancel: 'キャンセル',
    or: 'または',
    signUpTitle: 'アカウントを作成',
    signUpLead: 'ユーザー名と表示名を決めます。そのあと、ブラウザがパスキーを作ります。',
    keepTitle: 'このアカウントを残す',
    keepLead:
      '匿名アカウントにユーザー名と表示名を付けます。ブラウザがパスキーを作ると、そのプレイがランキングに載ります。',
    signUpGoogle: 'Google で登録',
    signUpDiscord: 'Discord で登録',
    orPasskey: 'またはパスキーで',
    handle: 'ユーザー名',
    handleHint: '英数字と _ で 3〜15 文字。ページの名前になります。',
    displayName: '表示名',
    nameHint: 'どの文字でも 32 文字まで。ランキングに表示されます。',
    createPasskey: 'パスキーを作成',
  },
} as const;

export interface AuthButtonInput {
  label: string;
  action?: string;
  method?: keyof typeof ICONS;
  type?: 'button' | 'submit';
  variant?: 'outline' | 'ghost' | 'link';
  className?: string;
}

/** Shared intent only: the application's controller performs the request or navigation. */
export function authButtonTemplate(input: AuthButtonInput): TemplateResult {
  return html`<button
    class=${input.className ?? 'btn w-full whitespace-normal'}
    type=${input.type ?? 'button'}
    data-auth-action=${ifDefined(input.action)}
    data-variant=${ifDefined(input.variant)}
  >
    ${input.method === undefined ? nothing : html`<span class="inline-flex size-4 shrink-0 [&>svg]:size-4" aria-hidden="true">${unsafeHTML(ICONS[input.method])}</span>`}${input.label}
  </button>`;
}

/** One localized panel for sign-in, sign-up, or keeping the current anonymous account. */
export function authPanelTemplate(input: {
  id: string;
  locale: Locale;
  mode: 'sign-in' | 'sign-up' | 'keep';
}): TemplateResult {
  const t = TEXT[input.locale];
  const signingIn = input.mode === 'sign-in';
  const title = signingIn ? t.signIn : input.mode === 'keep' ? t.keepTitle : t.signUpTitle;
  const lead = signingIn ? t.signInLead : input.mode === 'keep' ? t.keepLead : t.signUpLead;
  const heading = html`<header class="space-y-1">
    <h2 class="text-lg font-semibold" id=${input.id + '-title'}>${title}</h2>
    <p class="text-muted-foreground text-sm">${lead}</p>
  </header>`;
  const providers = html`<div class="account-providers grid gap-3">
    ${(['google', 'discord'] as const).map((method) =>
      authButtonTemplate({
        method,
        variant: 'outline',
        action: `${signingIn ? 'sign-in' : 'sign-up'}-${method}`,
        label: signingIn
          ? method === 'google'
            ? t.signInGoogle
            : t.signInDiscord
          : method === 'google'
            ? t.signUpGoogle
            : t.signUpDiscord,
      }),
    )}
  </div>`;
  const divider = html`<div class="text-muted-foreground flex items-center gap-3 text-xs" role="separator">
    <span class="bg-border h-px flex-1"></span>${signingIn ? t.or : t.orPasskey}<span
      class="bg-border h-px flex-1"
    ></span>
  </div>`;
  const status = html`<be-music-status
    class="text-destructive text-sm"
    data-auth-status
    role="status"
    hidden
  ></be-music-status>`;
  const cancel = authButtonTemplate({ action: 'close', label: t.cancel, variant: 'outline', className: 'btn' });
  return signingIn
    ? html`<div class="account-dialog-body max-h-[calc(100dvh-4rem)] space-y-4 overflow-y-auto">
        ${heading}
        <section class="grid gap-3">
          ${authButtonTemplate({ action: 'sign-in', method: 'passkey', label: t.signInPasskey })}${divider}${providers}${status}
        </section>
        <footer class="flex items-center justify-between gap-2">
          ${authButtonTemplate({ action: 'open-sign-up', label: t.noAccount, variant: 'link', className: 'btn px-0' })}${cancel}
        </footer>
      </div>`
    : html`<form
        class="account-dialog-body max-h-[calc(100dvh-4rem)] space-y-4 overflow-y-auto"
        data-auth-sign-up-form
        method="dialog"
      >
        ${heading}${providers}${divider}
        <label class="field grid gap-2"
          ><span>${t.handle}</span
          ><input
            class="input"
            name="handle"
            required
            minlength="3"
            maxlength="15"
            pattern="[A-Za-z0-9_]{3,15}"
            autocomplete="username webauthn"
            spellcheck="false"
          /><small class="text-muted-foreground text-xs">${t.handleHint}</small></label
        >
        <label class="field grid gap-2"
          ><span>${t.displayName}</span
          ><input class="input" name="displayName" required maxlength="64" autocomplete="nickname" /><small
            class="text-muted-foreground text-xs"
            >${t.nameHint}</small
          ></label
        >
        ${status}
        <footer class="flex justify-end gap-2">
          ${cancel}${authButtonTemplate({ type: 'submit', label: t.createPasskey, method: 'passkey', className: 'btn' })}
        </footer>
      </form>`;
}
