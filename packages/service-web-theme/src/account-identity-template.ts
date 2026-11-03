import { html, nothing, type TemplateResult } from 'lit';
import { resolveAccountIdentity, type ServiceAccountIdentity } from './account-model.ts';
import type { Locale } from './locale.ts';

/** A decorative avatar beside an identity; upload and image fallback URLs belong to the application. */
export function avatarTemplate(input: {
  src?: string;
  size: number;
  className?: string;
  alt?: string;
  shape?: 'circle' | 'rounded';
}): TemplateResult {
  return input.src === undefined
    ? html``
    : html`<img
        class=${`bg-muted ring-foreground/10 inline-block shrink-0 ${input.shape === 'rounded' ? 'rounded-lg' : 'rounded-full'} ring-1${input.className ? ` ${input.className}` : ''}`}
        src=${input.src}
        width=${input.size}
        height=${input.size}
        alt=${input.alt ?? ''}
        loading="lazy"
        decoding="async"
      />`;
}

/** Compact header identity or an expanded account summary, sharing naming and anonymous-state presentation. */
export function accountIdentityTemplate(input: {
  account: ServiceAccountIdentity;
  locale: Locale;
  variant?: 'compact' | 'detail';
  showAvatar?: boolean;
}): TemplateResult {
  const view = resolveAccountIdentity(input.account, input.locale);
  const compact = input.variant === 'compact';
  const avatar =
    input.showAvatar === false ? nothing : avatarTemplate({ src: input.account.avatarURL, size: compact ? 24 : 40 });
  return compact
    ? html`${avatar}<span class="hidden max-w-[12ch] truncate sm:inline">${view.label}</span>`
    : html`<div class="flex min-w-0 items-center gap-3" data-account-identity>
        ${avatar}
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="truncate font-medium">${input.account.displayName}</span>
            ${input.account.anonymous ? html`<span class="badge" data-variant="outline">${view.guest}</span>` : nothing}
          </div>
          ${input.account.handle === '' ? nothing : html`<div class="text-muted-foreground truncate text-xs">${view.label}</div>`}
        </div>
      </div>`;
}
