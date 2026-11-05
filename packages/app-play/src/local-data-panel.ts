import { html, nothing, render, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { keyed } from 'lit/directives/keyed.js';
import { until } from 'lit/directives/until.js';
// The local data viewer: a read-only dialog of what the player keeps in this browser (Options dialog → Library & records →
// Local data…). Each entry opens to show its value; values are drawn only when opened, so large stores stay cheap.

import { decompressReplayText } from './services/replay-slots.ts';
import {
  formatBytes,
  listLocalStorage,
  readIndexedDB,
  readStorageEstimate,
  viewLocalStorageValue,
  viewStoredValue,
  type StoredDatabase,
  type StoredObjectStore,
  type StoredRecord,
} from './services/local-data.ts';

/** The longest value text drawn; the rest is cut, with a note. */
const MAX_VALUE_CHARS = 200_000;

function valueBlock(text: string): TemplateResult {
  const cut = text.length > MAX_VALUE_CHARS;
  const pre = html`<pre class="local-data-value">${cut ? text.slice(0, MAX_VALUE_CHARS) : text}</pre>`;
  return cut
    ? html`<div>
        ${pre}
        <p class="local-data-note">Cut at ${MAX_VALUE_CHARS.toLocaleString()} characters.</p>
      </div>`
    : pre;
}

/** Values are prepared once, when their entry first opens. */
function lazyDetails(summary: TemplateResult, body: () => TemplateResult | Promise<TemplateResult>): TemplateResult {
  let built = false;
  return html`<details
    class="local-data-entry"
    @toggle=${(event: Event) => {
      const details = event.currentTarget as HTMLDetailsElement;
      if (!details.open || built) return;
      built = true;
      const content = details.querySelector<HTMLElement>(':scope > div')!;
      render(
        until(
          Promise.resolve()
            .then(body)
            .catch((error: unknown) => html`<p class="local-data-note">${String(error)}</p>`),
          nothing,
        ),
        content,
      );
    }}
  >
    <summary>${summary}</summary>
    <div></div>
  </details>`;
}

function summaryParts(name: string, size: string, description?: string): TemplateResult {
  return html`<code class="local-data-name">${name}</code>
    <span class="local-data-size">${size}</span>
    ${description ? html`<span class="local-data-description">${description}</span>` : nothing}`;
}

/** The local data viewer dialog. */
export class LocalDataPanel {
  private readonly dialog: HTMLDialogElement;
  private generation = 0;
  private usage = 'Reading…';
  private local: TemplateResult | TemplateResult[] = [];
  private databases: TemplateResult | TemplateResult[] = [];

  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'dialog local-data-dialog';
    this.dialog.setAttribute('aria-label', 'Local data');
    // The modal owns the keyboard; Escape still closes it.
    for (const type of ['keydown', 'keyup'] as const)
      this.dialog.addEventListener(type, (event) => event.stopPropagation());
    document.body.append(this.dialog);
  }

  open(): void {
    void this.refresh();
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose(): void {
    this.generation++;
    render(nothing, this.dialog);
    this.dialog.remove();
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.usage = 'Reading…';
    this.local = this.renderLocalStorage();
    this.databases = [];
    this.paint();
    const [estimate, databases] = await Promise.all([
      readStorageEstimate(),
      readIndexedDB(indexedDB).catch((error: unknown) => error),
    ]);
    // A later refresh or disposal owns the surface once this read is obsolete.
    if (generation !== this.generation) return;
    this.usage =
      estimate.usage === undefined
        ? 'The browser gives no storage estimate.'
        : `Using about ${formatBytes(estimate.usage)}${estimate.quota !== undefined ? ` of ${formatBytes(estimate.quota)}` : ''}${estimate.persisted ? ', kept from eviction' : ''}.`;
    this.databases = !Array.isArray(databases)
      ? html`<p class="local-data-note">Could not read IndexedDB: ${String(databases)}</p>`
      : databases.length === 0
        ? html`<p class="local-data-note">No databases.</p>`
        : databases.map((database) => this.renderDatabase(database));
    this.paint();
  }

  private paint(): void {
    render(
      html`<div>
        <header>
          <h2>Local data</h2>
          <p>
            What the player keeps in this browser. This view only reads: clear data from its own controls (Reset
            settings, Clear best records, My courses, the replay-slot card).
          </p>
        </header>
        <p class="local-data-usage">${this.usage}</p>
        <section class="local-data-section">
          <h3>localStorage</h3>
          ${keyed(this.generation, this.local)}
        </section>
        <section class="local-data-section">
          <h3>IndexedDB</h3>
          ${keyed(this.generation, this.databases)}
        </section>
        <div class="local-data-buttons">
          <button class="btn" type="button" data-size="sm" data-variant="outline" @click=${() => void this.refresh()}>
            Refresh
          </button>
          <button class="btn" type="button" data-size="sm" @click=${() => this.dialog.close()}>Close</button>
        </div>
      </div>`,
      this.dialog,
    );
  }

  private renderLocalStorage(): TemplateResult | TemplateResult[] {
    let entries;
    try {
      entries = listLocalStorage(window.localStorage);
    } catch (error) {
      return html`<p class="local-data-note">Could not read localStorage: ${String(error)}</p>`;
    }
    if (entries.length === 0) return html`<p class="local-data-note">No keys.</p>`;
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    return [
      html`<p class="local-data-note">${entries.length} keys, ${formatBytes(total)}.</p>`,
      ...entries.map((entry) =>
        lazyDetails(summaryParts(entry.key, formatBytes(entry.bytes), entry.description), () =>
          valueBlock(viewLocalStorageValue(entry.value).text),
        ),
      ),
    ];
  }

  private renderDatabase(database: StoredDatabase): TemplateResult {
    const records = database.stores.reduce((sum, store) => sum + store.count, 0);
    return html`<details class="local-data-entry" data-database=${database.name}>
      <summary>
        ${summaryParts(`${database.name} (v${database.version})`, `${records} records`, database.description)}
      </summary>
      ${database.stores.map((store) => this.renderStore(database, store))}
    </details>`;
  }

  private renderStore(database: StoredDatabase, store: StoredObjectStore): TemplateResult {
    const bytes = store.records.reduce((sum, record) => sum + viewStoredValue(record.value).bytes, 0);
    const size = `${store.count} records, ${store.records.length < store.count ? 'first ' : ''}${formatBytes(bytes)}`;
    return lazyDetails(
      summaryParts(store.name, size, store.description),
      () =>
        html`<div class="local-data-records">
          ${store.records.length < store.count ? html`<p class="local-data-note">Showing the first ${store.records.length}.</p>` : nothing}
          ${store.records.map((record) => this.renderRecord(database, store, record))}
        </div>`,
    );
  }

  private renderRecord(database: StoredDatabase, store: StoredObjectStore, record: StoredRecord): TemplateResult {
    const view = viewStoredValue(record.value);
    return lazyDetails(summaryParts(record.key, formatBytes(view.bytes)), () => {
      if (view.kind === 'blob' && database.name === 'be-music-replays' && store.name === 'replaySlotData') {
        return html`<div
          ${ref((body) => {
            if (!(body instanceof HTMLElement)) return;
            const initial = html`${valueBlock(view.text)}
              <button
                class="btn"
                type="button"
                data-size="sm"
                data-variant="outline"
                @click=${(event: Event) => {
                  (event.currentTarget as HTMLButtonElement).disabled = true;
                  render(
                    until(
                      decompressReplayText(record.value as Blob).then(
                        (text) => valueBlock(viewLocalStorageValue(text).text),
                        (error: unknown) =>
                          html`${initial}
                            <p class="local-data-note">${String(error)}</p>`,
                      ),
                      initial,
                    ),
                    body,
                  );
                }}
              >
                Show the replay
              </button>`;
            render(initial, body);
          })}
        ></div>`;
      }
      return valueBlock(view.text);
    });
  }
}
