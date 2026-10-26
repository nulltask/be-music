// The replay slots' DOM card, for the skins without a replay-slot UI of their own (the built-in, Native and LR2 ones; a
// beatoraja skin draws its slots and buttons itself): on a result screen it saves the play into a slot, as keys 1-4 do,
// and on the select screen it replays, downloads or deletes the replays of the chart or course under the cursor.

import { downloadBlob } from '@be-music/player-browser/recording';
import { REPLAY_SLOT_COUNT, type LibraryEntry } from '@be-music/player-scene-model';
import type { ReplaySlotRecord, ReplaySlotTarget } from './services/replay-slots.ts';
import type { ReplaySlotService, ResultReplaySlots } from './services/replay-slot-service.ts';

/** What the card shows. */
type PanelMode =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'result'; readonly slots: ResultReplaySlots }
  | {
      readonly kind: 'select';
      readonly entry: Exclude<LibraryEntry, { kind: 'folder' }>;
      readonly target: ReplaySlotTarget;
    };

export interface ReplaySlotsPanelOptions {
  readonly service: ReplaySlotService;
  /** Replays slot `slot` of the bar under the cursor (`SelectScene.replay`). */
  readonly replay: (slot: number) => void;
  readonly setStatus: (text: string) => void;
}

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

/** What a slot's record says on the card: its EX score and rate, its lamp and when it was saved. */
export function describeReplaySlotRecord(record: ReplaySlotRecord): string {
  const rate = (record.exRate * 100).toFixed(2);
  const savedAt = new Date(record.savedAt);
  const date = Number.isNaN(savedAt.getTime()) ? record.savedAt : savedAt.toLocaleString();
  return `EX ${record.exScore} (${rate}%) · ${record.lamp.replaceAll('_', ' ')} · ${date}`;
}

/** The replay slots' card. See the module comment. */
export class ReplaySlotsPanel {
  private readonly card: HTMLElement;
  private readonly options: ReplaySlotsPanelOptions;
  private mode: PanelMode = { kind: 'hidden' };
  private readonly unsubscribe: () => void;
  private unsubscribeResult: (() => void) | undefined;

  public constructor(options: ReplaySlotsPanelOptions) {
    this.options = options;
    this.card = element('aside', { className: 'card replay-slots-card gap-3 px-4' });
    this.card.hidden = true;
    this.card.setAttribute('aria-label', 'Replay slots');
    document.body.append(this.card);
    this.unsubscribe = options.service.store.subscribe(() => this.render());
  }

  /** Shows a result screen's slots, to save the play into. */
  public showResult(slots: ResultReplaySlots): void {
    this.setMode({ kind: 'result', slots });
    this.unsubscribeResult = slots.subscribe(() => this.render());
  }

  /** Shows the replays of the bar under the cursor; nothing for a folder or a bar without a slot target. */
  public showSelect(entry: LibraryEntry | undefined): void {
    const target = entry !== undefined && entry.kind !== 'folder' ? this.options.service.targetOf(entry) : undefined;
    this.setMode(
      entry !== undefined && entry.kind !== 'folder' && target !== undefined
        ? { kind: 'select', entry, target }
        : { kind: 'hidden' },
    );
  }

  public hide(): void {
    this.setMode({ kind: 'hidden' });
  }

  public dispose(): void {
    this.unsubscribe();
    this.unsubscribeResult?.();
    this.card.remove();
  }

  private setMode(mode: PanelMode): void {
    this.unsubscribeResult?.();
    this.unsubscribeResult = undefined;
    this.mode = mode;
    this.render();
  }

  private render(): void {
    const mode = this.mode;
    if (mode.kind === 'result') {
      this.renderResult(mode.slots);
      return;
    }
    if (mode.kind === 'select') {
      this.renderSelect(mode.target);
      return;
    }
    this.card.hidden = true;
    this.card.replaceChildren();
  }

  private renderResult(slots: ResultReplaySlots): void {
    const states = slots.states();
    const records = slots.slots();
    const rows = Array.from({ length: REPLAY_SLOT_COUNT }, (_, slot) => {
      const state = states[slot];
      const record = records[slot];
      const save = button(state === 'saved' ? 'Saved' : 'Save', () => void slots.save(slot));
      save.disabled = !slots.saveable || state === 'saved';
      save.dataset.slot = String(slot + 1);
      return element('li', { className: 'replay-slots-row' }, [
        element('span', { className: 'replay-slots-name', text: `Slot ${slot + 1}` }),
        element('span', {
          className: 'replay-slots-detail',
          text: state === 'saved' ? 'Saved now' : record !== undefined ? describeReplaySlotRecord(record) : 'Empty',
        }),
        save,
      ]);
    });
    this.card.dataset.mode = 'result';
    this.card.replaceChildren(
      element('header', {}, [
        element('h2', { text: 'Replay slots' }),
        element('p', {
          text: slots.saveable
            ? 'Save this play to a slot (keys 1-4). A slot keeps one replay.'
            : 'This play cannot be saved to a slot.',
        }),
      ]),
      element('ol', { className: 'replay-slots-list' }, rows),
    );
    this.card.hidden = false;
  }

  private renderSelect(target: ReplaySlotTarget): void {
    const records = this.options.service.store.slots(target);
    if (records.every((record) => record === undefined)) {
      this.card.hidden = true;
      this.card.replaceChildren();
      return;
    }
    const rows: HTMLElement[] = [];
    records.forEach((record, slot) => {
      if (record === undefined) return;
      const replay = button('Replay', () => this.options.replay(slot));
      replay.dataset.slot = String(slot + 1);
      rows.push(
        element('li', { className: 'replay-slots-row' }, [
          element('span', { className: 'replay-slots-name', text: `Slot ${slot + 1}` }),
          element('span', { className: 'replay-slots-detail', text: describeReplaySlotRecord(record) }),
          element('span', { className: 'replay-slots-actions' }, [
            replay,
            button('Download', () => void this.download(target, record), 'outline'),
            button('Delete', () => void this.remove(target, record), 'outline'),
          ]),
        ]),
      );
    });
    this.card.dataset.mode = 'select';
    this.card.replaceChildren(
      element('header', {}, [element('h2', { text: 'Replay slots' })]),
      element('ol', { className: 'replay-slots-list' }, rows),
    );
    this.card.hidden = false;
  }

  /** Offers a slot's replay as the file it was saved as. */
  private async download(target: ReplaySlotTarget, record: ReplaySlotRecord): Promise<void> {
    const text = await this.options.service.store.readText(target, record.slot).catch(() => undefined);
    if (text === undefined) {
      this.options.setStatus(`Replay slot ${record.slot + 1} could not be read`);
      return;
    }
    const stem = record.title.normalize('NFKC').replace(/[\\/:*?"<>|\s]+/g, '_') || 'replay';
    const extension = target.kind === 'chart' ? 'bmplay.json' : 'bmcourse.json';
    downloadBlob(new Blob([text], { type: 'application/json' }), `${stem}-slot${record.slot + 1}.${extension}`);
  }

  /** Empties a slot, once the player confirms. */
  private async remove(target: ReplaySlotTarget, record: ReplaySlotRecord): Promise<void> {
    if (!window.confirm(`Delete the replay in slot ${record.slot + 1} of "${record.title}"?`)) return;
    try {
      await this.options.service.store.remove(target, record.slot);
      this.options.setStatus(`Deleted the replay in slot ${record.slot + 1}`);
    } catch {
      this.options.setStatus(`Replay slot ${record.slot + 1} could not be deleted`);
    }
  }
}
