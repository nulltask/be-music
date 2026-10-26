// The local data viewer: a read-only dialog of what the player keeps in this browser (Debug Menu → Library & records →
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

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className !== undefined) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, variant?: 'outline'): HTMLButtonElement {
  const node = element('button', { className: 'btn', text: label });
  node.type = 'button';
  node.dataset.size = 'sm';
  if (variant !== undefined) node.dataset.variant = variant;
  node.addEventListener('click', onClick);
  return node;
}

/** The longest value text drawn; the rest is cut, with a note. */
const MAX_VALUE_CHARS = 200_000;

/** A value's text in a `<pre>`, cut at {@link MAX_VALUE_CHARS}. */
function valueBlock(text: string): HTMLElement {
  const cut = text.length > MAX_VALUE_CHARS;
  const pre = element('pre', { className: 'local-data-value', text: cut ? text.slice(0, MAX_VALUE_CHARS) : text });
  if (!cut) return pre;
  return element('div', {}, [
    pre,
    element('p', { className: 'local-data-note', text: `Cut at ${MAX_VALUE_CHARS.toLocaleString()} characters.` }),
  ]);
}

/** A `<details>` whose body is built the first time it opens. */
function lazyDetails(summary: Node[], body: () => Node | Promise<Node>): HTMLDetailsElement {
  const details = element('details', { className: 'local-data-entry' }, [element('summary', {}, summary)]);
  let built = false;
  details.addEventListener('toggle', () => {
    if (!details.open || built) return;
    built = true;
    void Promise.resolve(body()).then(
      (node) => details.append(node),
      (error: unknown) => details.append(element('p', { className: 'local-data-note', text: String(error) })),
    );
  });
  return details;
}

function summaryParts(name: string, size: string, description?: string): Node[] {
  return [
    element('code', { className: 'local-data-name', text: name }),
    element('span', { className: 'local-data-size', text: size }),
    ...(description ? [element('span', { className: 'local-data-description', text: description })] : []),
  ];
}

/** The local data viewer dialog. */
export class LocalDataPanel {
  private readonly dialog: HTMLDialogElement;

  constructor() {
    this.dialog = element('dialog', { className: 'dialog local-data-dialog' });
    this.dialog.setAttribute('aria-label', 'Local data');
    // The modal owns the keyboard: keys must not also drive the scene behind it (Escape still closes it).
    for (const type of ['keydown', 'keyup'] as const)
      this.dialog.addEventListener(type, (event) => event.stopPropagation());
    document.body.append(this.dialog);
  }

  /** Opens the viewer, reading everything afresh. */
  open(): void {
    void this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  dispose(): void {
    this.dialog.remove();
  }

  private async render(): Promise<void> {
    const usage = element('p', { className: 'local-data-usage', text: 'Reading…' });
    const local = element('section', { className: 'local-data-section' }, [element('h3', { text: 'localStorage' })]);
    const indexed = element('section', { className: 'local-data-section' }, [element('h3', { text: 'IndexedDB' })]);
    this.dialog.replaceChildren(
      element('div', {}, [
        element('header', {}, [
          element('h2', { text: 'Local data' }),
          element('p', {
            text: 'What the player keeps in this browser. This view only reads: clear data from its own controls (Reset settings, Clear best records, My courses, the replay-slot card).',
          }),
        ]),
        usage,
        local,
        indexed,
        element('div', { className: 'local-data-buttons' }, [
          button('Refresh', () => void this.render(), 'outline'),
          button('Close', () => this.dialog.close()),
        ]),
      ]),
    );
    local.append(...this.renderLocalStorage());
    const [estimate, databases] = await Promise.all([
      readStorageEstimate(),
      readIndexedDB(indexedDB).catch((error: unknown) => error),
    ]);
    usage.textContent =
      estimate.usage === undefined
        ? 'The browser gives no storage estimate.'
        : `Using about ${formatBytes(estimate.usage)}${estimate.quota !== undefined ? ` of ${formatBytes(estimate.quota)}` : ''}${estimate.persisted ? ', kept from eviction' : ''}.`;
    if (!Array.isArray(databases)) {
      indexed.append(
        element('p', { className: 'local-data-note', text: `Could not read IndexedDB: ${String(databases)}` }),
      );
      return;
    }
    indexed.append(
      ...(databases.length === 0
        ? [element('p', { className: 'local-data-note', text: 'No databases.' })]
        : databases.map((database) => this.renderDatabase(database))),
    );
  }

  private renderLocalStorage(): Node[] {
    let entries;
    try {
      entries = listLocalStorage(window.localStorage);
    } catch (error) {
      return [element('p', { className: 'local-data-note', text: `Could not read localStorage: ${String(error)}` })];
    }
    if (entries.length === 0) return [element('p', { className: 'local-data-note', text: 'No keys.' })];
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    return [
      element('p', { className: 'local-data-note', text: `${entries.length} keys, ${formatBytes(total)}.` }),
      ...entries.map((entry) =>
        lazyDetails(summaryParts(entry.key, formatBytes(entry.bytes), entry.description), () =>
          valueBlock(viewLocalStorageValue(entry.value).text),
        ),
      ),
    ];
  }

  private renderDatabase(database: StoredDatabase): HTMLElement {
    const records = database.stores.reduce((sum, store) => sum + store.count, 0);
    const details = element('details', { className: 'local-data-entry' }, [
      element(
        'summary',
        {},
        summaryParts(`${database.name} (v${database.version})`, `${records} records`, database.description),
      ),
      ...database.stores.map((store) => this.renderStore(database, store)),
    ]);
    details.dataset.database = database.name;
    return details;
  }

  private renderStore(database: StoredDatabase, store: StoredObjectStore): HTMLElement {
    const bytes = store.records.reduce((sum, record) => sum + viewStoredValue(record.value).bytes, 0);
    const size = `${store.count} records, ${store.records.length < store.count ? 'first ' : ''}${formatBytes(bytes)}`;
    return lazyDetails(summaryParts(store.name, size, store.description), () =>
      element('div', { className: 'local-data-records' }, [
        ...(store.records.length < store.count
          ? [element('p', { className: 'local-data-note', text: `Showing the first ${store.records.length}.` })]
          : []),
        ...store.records.map((record) => this.renderRecord(database, store, record)),
      ]),
    );
  }

  private renderRecord(database: StoredDatabase, store: StoredObjectStore, record: StoredRecord): HTMLElement {
    const view = viewStoredValue(record.value);
    return lazyDetails(summaryParts(record.key, formatBytes(view.bytes)), () => {
      // A replay slot's data is a gzip-compressed replay: offer to read it.
      if (view.kind === 'blob' && database.name === 'be-music-replays' && store.name === 'replaySlotData') {
        const body = element('div', {}, [valueBlock(view.text)]);
        const show = button(
          'Show the replay',
          () => {
            show.disabled = true;
            void decompressReplayText(record.value as Blob).then(
              (text) => body.replaceChildren(valueBlock(viewLocalStorageValue(text).text)),
              (error: unknown) => body.append(element('p', { className: 'local-data-note', text: String(error) })),
            );
          },
          'outline',
        );
        body.append(show);
        return body;
      }
      return valueBlock(view.text);
    });
  }
}
