// The Options dialog's list of Bemuse music servers, in the Library folder: the registered servers, each with a remove
// button, and a field that adds one. A server added here loads at once; every registered server loads again each time
// the player opens (`LibraryService.autoLoad`).
import { html, render } from 'lit';
import {
  DEFAULT_BEMUSE_SERVER_URLS,
  bemuseServerIndexURL,
  bemuseServerLabel,
  readStoredBemuseServerURLs,
  storeBemuseServerURLs,
} from '../../bemuse-server.ts';
import { playerText } from '../../player-copy.ts';
import type { LibraryService } from '../../services/library.ts';
import { localized } from '../localized.ts';

/** Bemuse's own server, offered as the field's example. */
const OFFICIAL_BEMUSE_SERVER = 'https://music4.bemuse.ninja/server';

/** Mounts the server list into `root`, which it owns. */
export function mountBemuseServerManager(
  root: HTMLElement,
  {
    library,
    setStatus,
    saveSettings,
  }: {
    library: Pick<LibraryService, 'loadBemuseServers'>;
    setStatus: (text: string) => void;
    /** Publishes the settings, which carry the server list to the player's other browsers. */
    saveSettings: () => void;
  },
): void {
  let servers = readStoredBemuseServerURLs();
  let draft = '';

  const add = (event: Event) => {
    event.preventDefault();
    const indexURL = bemuseServerIndexURL(draft);
    if (indexURL === undefined) {
      setStatus(playerText().shell.invalidBemuseServerURL);
      return;
    }
    draft = '';
    if (servers.includes(indexURL)) {
      // Listed already: loading it again would list its songs twice.
      update();
      return;
    }
    servers = storeBemuseServerURLs([...servers, indexURL]);
    saveSettings();
    update();
    void library.loadBemuseServers([indexURL]);
  };
  /** Registers the default servers the list lacks (removed, or added to the defaults later) and loads them. */
  const restoreDefaults = () => {
    const missing = DEFAULT_BEMUSE_SERVER_URLS.filter((url) => !servers.includes(url));
    if (missing.length === 0) return;
    servers = storeBemuseServerURLs([...servers, ...missing]);
    saveSettings();
    update();
    void library.loadBemuseServers(missing);
  };
  const remove = (indexURL: string) => {
    servers = storeBemuseServerURLs(servers.filter((url) => url !== indexURL));
    saveSettings();
    update();
  };

  function update(): void {
    render(
      html`
        <section aria-labelledby="bemuse-servers-heading">
          <h3 id="bemuse-servers-heading">${localized('bemuseServers')}</h3>
          <p>${localized('bemuseServersHint')}</p>
          <ul class="remembered-folder-list">
            ${servers.map(
              (indexURL) => html`
                <li>
                  <span title=${indexURL}>${bemuseServerLabel(indexURL)}</span>
                  <button
                    type="button"
                    class="btn"
                    aria-label=${localized(() => playerText().shell.removeBemuseServer(bemuseServerLabel(indexURL)))}
                    @click=${() => remove(indexURL)}
                  >
                    ${localized('removeFolder')}
                  </button>
                </li>
              `,
            )}
          </ul>
          <form class="bemuse-server-form" @submit=${add}>
            <input
              class="input"
              type="url"
              required
              aria-label=${localized('bemuseServerURL')}
              placeholder=${OFFICIAL_BEMUSE_SERVER}
              .value=${draft}
              @input=${(event: Event) => {
                draft = (event.target as HTMLInputElement).value;
              }}
            />
            <button type="submit" class="btn">${localized('addBemuseServer')}</button>
          </form>
          ${
            DEFAULT_BEMUSE_SERVER_URLS.some((url) => !servers.includes(url))
              ? html`<button type="button" class="btn" @click=${restoreDefaults}>
                  ${localized('restoreBemuseServers')}
                </button>`
              : null
          }
        </section>
      `,
      root,
    );
  }

  update();
}
