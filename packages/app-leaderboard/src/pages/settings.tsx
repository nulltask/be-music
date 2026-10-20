/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { Avatar } from './components/basics.tsx';
import { Layout, PageHeader } from './layout.tsx';
import { meta, PAGE_CACHE, pageMessages, type PageContext } from './page.tsx';

function Card(props: { title: string; description?: string; children: Child }) {
  return (
    <section class="card gap-4" data-size="sm">
      <header>
        <h2>{props.title}</h2>
        {props.description !== undefined ? <p>{props.description}</p> : null}
      </header>
      <div class="space-y-4 px-4">{props.children}</div>
    </section>
  );
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
      <Layout meta={pageMeta}>
        <PageHeader title={t.title} kind="settings">
          {t.signedOutLead}
        </PageHeader>
        <Card title={t.signIn} description={t.signInLead}>
          <button type="button" class="btn" data-account-action="sign-in">
            {t.signInWithPasskey}
          </button>
          <p class="text-muted-foreground text-sm">{t.noPasskey}</p>
        </Card>
      </Layout>,
    );
  }
  if (c.env.AUTH_ISSUER) return c.redirect(new URL('/account', c.env.AUTH_ISSUER).href, 302);
  const hasUpload = !viewer.avatarUrl.endsWith('?v=g');
  return c.html(
    <Layout meta={pageMeta}>
      <PageHeader title={t.title} kind="settings">
        {t.signedInAs(viewer.handle)}
        {viewer.anonymous ? t.anonymousSuffix : ''}
      </PageHeader>
      <p class="text-destructive text-sm" data-settings-status role="status" hidden />
      <Card title={t.profile} description={t.profileLead}>
        <form class="grid gap-4 sm:max-w-md" data-profile-form>
          <div class="grid gap-2">
            <label class="label" for="settings-handle">
              {t.handle}
            </label>
            <input
              class="input"
              id="settings-handle"
              name="handle"
              value={viewer.handle}
              required
              minlength={3}
              maxlength={15}
              pattern="[A-Za-z0-9_]{3,15}"
              autocomplete="username"
              spellcheck={false}
            />
            <p class="text-muted-foreground text-xs">{t.handleHint}</p>
          </div>
          <div class="grid gap-2">
            <label class="label" for="settings-name">
              {t.name}
            </label>
            <input
              class="input"
              id="settings-name"
              name="displayName"
              value={viewer.displayName}
              required
              maxlength={64}
              autocomplete="nickname"
            />
            <p class="text-muted-foreground text-xs">{t.nameHint}</p>
          </div>
          <div>
            <button type="submit" class="btn">
              {t.save}
            </button>
          </div>
        </form>
      </Card>
      <Card title={t.avatar} description={t.avatarLead}>
        <div class="flex flex-wrap items-center gap-4">
          <Avatar src={viewer.avatarUrl} size={96} />
          <div class="flex flex-wrap items-center gap-2">
            <label class="btn" data-variant="outline">
              {t.upload}
              <input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp,image/*" data-avatar-input />
            </label>
            {hasUpload ? (
              <button type="button" class="btn" data-variant="ghost" data-account-action="remove-avatar">
                {t.useGenerated}
              </button>
            ) : null}
          </div>
        </div>
      </Card>
      <Card title={t.passkeys} description={viewer.anonymous ? t.passkeysAnonymous : t.passkeysCount(viewer.passkeys)}>
        <div>
          <button
            type="button"
            class="btn"
            data-variant={viewer.anonymous ? 'primary' : 'outline'}
            data-account-action="create-passkey"
          >
            {viewer.anonymous ? t.keepAccount : t.addPasskey}
          </button>
        </div>
      </Card>
    </Layout>,
  );
}
