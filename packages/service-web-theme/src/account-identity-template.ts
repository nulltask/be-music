import { html, nothing, type TemplateResult } from 'lit';
import { resolveAccountIdentity, type ServiceAccountIdentity } from './account-model.ts';
import type { Locale } from './locale.ts';

/** The shared avatar style: square, cropped to cover, round, with a hairline ring that follows the circle. */
const AVATAR_CLASS = 'bg-muted ring-foreground/10 inline-block aspect-square shrink-0 rounded-full object-cover ring-1';

/**
 * A user's avatar, always a circle: the one avatar style every service and the player share. A non-square image is
 * cropped to the square (`object-cover`), never stretched. Upload and image fallback URLs belong to the application.
 */
export function avatarTemplate(input: {
  src?: string;
  size: number;
  className?: string;
  alt?: string;
}): TemplateResult {
  return input.src === undefined
    ? html``
    : html`<img
        class=${`${AVATAR_CLASS}${input.className ? ` ${input.className}` : ''}`}
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
