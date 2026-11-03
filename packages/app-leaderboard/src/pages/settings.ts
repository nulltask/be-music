import type { PageContent } from './template.ts';
import { html, nothing, renderHTML } from '@be-music/service-web-theme/server';
import { Avatar } from './components/basics.ts';
import { Layout, PageHeader } from './layout.ts';
import { meta, PAGE_CACHE, pageMessages, type PageContext } from './page.ts';

function Card(props: { title: string; description?: string; children: PageContent }) {
  return html`<section class="card gap-4" data-size="sm">
    <header>
      <h2>${props.title}</h2>
      ${props.description !== undefined ? html`<p>${props.description}</p>` : null}
    </header>
    <div class="space-y-4 px-4">${props.children}</div>
  </section>`;
}

/**
 * The signed-in player's settings: handle, display name, avatar and passkeys. The forms and buttons are wired by the
 * client script (client/main.ts), which calls the account API; signed out, the page offers the passkey sign-in.
 */
export async function settingsPage(c: PageContext<'/settings'>) {
  const viewer = c.get('viewer');
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c).settings;
  const pageMeta = meta(c, t.title, t.description, [{ label: t.title, kind: 'settings' }]);
  if (viewer === null) {
    return c.html(
      renderHTML(
        Layout({
          meta: pageMeta,
          children: html`${PageHeader({ title: t.title, kind: 'settings', children: html`${t.signedOutLead}` })}${Card({
            title: t.signIn,
            description: t.signInLead,
            children: html`<button type="button" class="btn" data-account-action="sign-in">
                ${t.signInWithPasskey}
              </button>
              <p class="text-muted-foreground text-sm">${t.noPasskey}</p>`,
          })}`,
        }),
      ),
    );
  }
  if (c.env.AUTH_ISSUER) return c.redirect(new URL('/account', c.env.AUTH_ISSUER).href, 302);
  const hasUpload = !viewer.avatarUrl.endsWith('?v=g');
  return c.html(
    renderHTML(
      Layout({
        meta: pageMeta,
        children: html`${PageHeader({
            title: t.title,
            kind: 'settings',
            children: html`${t.signedInAs(viewer.handle)}${viewer.anonymous ? t.anonymousSuffix : ''}`,
          })}<be-music-status
            class="text-destructive text-sm"
            data-settings-status
            role="status"
            hidden
          ></be-music-status
          >${Card({
            title: t.profile,
            description: t.profileLead,
            children: html`<form class="grid gap-4 sm:max-w-md" data-profile-form>
              <div class="grid gap-2">
                <label class="label" for="settings-handle">${t.handle}</label
                ><input
                  class="input"
                  id="settings-handle"
                  name="handle"
                  value=${viewer.handle ?? nothing}
                  required
                  minlength=${3}
                  maxlength=${15}
                  pattern="[A-Za-z0-9_]{3,15}"
                  autocomplete="username"
                  spellcheck=${false}
                />
                <p class="text-muted-foreground text-xs">${t.handleHint}</p>
              </div>
              <div class="grid gap-2">
                <label class="label" for="settings-name">${t.name}</label
                ><input
                  class="input"
                  id="settings-name"
                  name="displayName"
                  value=${viewer.displayName ?? nothing}
                  required
                  maxlength=${64}
                  autocomplete="nickname"
                />
                <p class="text-muted-foreground text-xs">${t.nameHint}</p>
              </div>
              <div><button type="submit" class="btn">${t.save}</button></div>
            </form>`,
          })}${Card({
            title: t.avatar,
            description: t.avatarLead,
            children: html`<div class="flex flex-wrap items-center gap-4">
              ${Avatar({ src: viewer.avatarUrl, size: 96 })}
              <div class="flex flex-wrap items-center gap-2">
                <label class="btn" data-variant="outline"
                  >${t.upload}<input
                    type="file"
                    class="sr-only"
                    accept="image/png,image/jpeg,image/webp,image/*"
                    data-avatar-input /></label
                >${
                  hasUpload
                    ? html`<button type="button" class="btn" data-variant="ghost" data-account-action="remove-avatar">
                        ${t.useGenerated}
                      </button>`
                    : null
                }
              </div>
            </div>`,
          })}${Card({
            title: t.passkeys,
            description: viewer.anonymous ? t.passkeysAnonymous : t.passkeysCount(viewer.passkeys),
            children: html`<div>
              <button
                type="button"
                class="btn"
                data-variant=${viewer.anonymous ? 'primary' : 'outline'}
                data-account-action="create-passkey"
              >
                ${viewer.anonymous ? t.keepAccount : t.addPasskey}
              </button>
            </div>`,
          })}`,
      }),
    ),
  );
}
