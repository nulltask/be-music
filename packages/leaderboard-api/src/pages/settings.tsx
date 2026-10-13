/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { Avatar } from './components/basics.tsx';
import { Layout, PageHeader } from './layout.tsx';
import { meta, PAGE_CACHE, type PageContext } from './page.tsx';

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
 * The signed-in player's settings: handle, display name, icon and passkeys. The forms and buttons are wired by the
 * client script (client/main.ts), which calls the account API; signed out, the page offers the passkey sign-in.
 */
export async function settingsPage(c: PageContext<'/leaderboard/settings'>) {
  const viewer = c.get('viewer');
  c.header('cache-control', PAGE_CACHE);
  const pageMeta = meta(c, 'Settings', 'Your be-music Leaderboard profile.', [{ label: 'Settings', kind: 'settings' }]);
  if (viewer === null) {
    return c.html(
      <Layout meta={pageMeta}>
        <PageHeader title="Settings" kind="settings">
          Sign in to change your handle, name and icon.
        </PageHeader>
        <Card title="Sign in" description="Use the passkey of your Leaderboard account.">
          <button type="button" class="btn" data-account-action="sign-in">
            Sign in with a passkey
          </button>
          <p class="text-muted-foreground text-sm">
            No passkey yet? Submitting a play from the player signs you in anonymously; create a passkey there, or here
            once signed in, to keep the account.
          </p>
        </Card>
      </Layout>,
    );
  }
  const hasUpload = !viewer.avatarUrl.endsWith('?v=g');
  return c.html(
    <Layout meta={pageMeta}>
      <PageHeader title="Settings" kind="settings">
        Signed in as @{viewer.handle}
        {viewer.anonymous ? ' (anonymous)' : ''}
      </PageHeader>
      <p class="text-destructive text-sm" data-settings-status role="status" hidden />
      <Card title="Profile" description="Your handle names your page; your name is what the rankings show.">
        <form class="grid gap-4 sm:max-w-md" data-profile-form>
          <div class="grid gap-2">
            <label class="label" for="settings-handle">
              Handle
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
            <p class="text-muted-foreground text-xs">
              3 to 15 letters, digits or _. Your old handle stays yours, and links to it keep working.
            </p>
          </div>
          <div class="grid gap-2">
            <label class="label" for="settings-name">
              Name
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
            <p class="text-muted-foreground text-xs">Up to 32 characters, in any script.</p>
          </div>
          <div>
            <button type="submit" class="btn">
              Save
            </button>
          </div>
        </form>
      </Card>
      <Card title="Icon" description="Shown next to your name. Pictures are cropped to a square and shrunk to 256 px.">
        <div class="flex flex-wrap items-center gap-4">
          <Avatar src={viewer.avatarUrl} size={96} />
          <div class="flex flex-wrap items-center gap-2">
            <label class="btn" data-variant="outline">
              Upload a picture
              <input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp,image/*" data-avatar-input />
            </label>
            {hasUpload ? (
              <button type="button" class="btn" data-variant="ghost" data-account-action="remove-avatar">
                Use the generated icon
              </button>
            ) : null}
          </div>
        </div>
      </Card>
      <Card
        title="Passkeys"
        description={
          viewer.anonymous
            ? 'This account is anonymous: without a passkey, it is lost with this browser’s data.'
            : `${viewer.passkeys} passkey${viewer.passkeys === 1 ? '' : 's'}. A passkey signs you in on any device.`
        }
      >
        <div>
          <button
            type="button"
            class="btn"
            data-variant={viewer.anonymous ? 'primary' : 'outline'}
            data-account-action="create-passkey"
          >
            {viewer.anonymous ? 'Create a passkey to keep this account' : 'Add a passkey'}
          </button>
        </div>
      </Card>
    </Layout>,
  );
}
