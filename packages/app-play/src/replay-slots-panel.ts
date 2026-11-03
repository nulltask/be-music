import { html, nothing, render, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
// The replay slots' DOM card, for the skins without a replay-slot UI of their own (the built-in, Native and LR2 ones; a
// beatoraja skin draws its slots and buttons itself): on a result screen it saves the play into a slot, as keys 1-4 do,
// and on the select screen it replays, downloads or deletes the replays of the chart or course under the cursor.

import { downloadBlob } from '@be-music/player-browser/recording';
import { playerText } from './player-copy.ts';
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
    this.card = document.createElement('aside');
    this.card.className = 'card replay-slots-card gap-3 px-4';
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
    render(nothing, this.card);
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
    render(nothing, this.card);
  }

  private renderResult(slots: ResultReplaySlots): void {
    const states = slots.states();
    const records = slots.slots();
    const copy = playerText().replay;
    this.card.dataset.mode = 'result';
    render(
      html`
        <header>
          <h2>${copy.slotsTitle}</h2>
          <p>${slots.saveable ? copy.saveHint : copy.cannotSave}</p>
        </header>
        <ol class="replay-slots-list">
          ${Array.from({ length: REPLAY_SLOT_COUNT }, (_, slot) => {
            const state = states[slot];
            const record = records[slot];
            return html`<li class="replay-slots-row">
              <span class="replay-slots-name">${copy.slot(slot + 1)}</span>
              <span class="replay-slots-detail"
                >${state === 'saved' ? copy.savedNow : record !== undefined ? describeReplaySlotRecord(record) : copy.empty}</span
              >
              <button
                class="btn"
                type="button"
                data-size="sm"
                data-slot=${slot + 1}
                ?disabled=${!slots.saveable || state === 'saved'}
                @click=${() => void slots.save(slot)}
              >
                ${state === 'saved' ? copy.saved : copy.save}
              </button>
            </li>`;
          })}
        </ol>
      `,
      this.card,
    );
    this.card.hidden = false;
  }

  private renderSelect(target: ReplaySlotTarget): void {
    const records = this.options.service.store.slots(target).filter((record) => record !== undefined);
    if (records.length === 0) {
      this.card.hidden = true;
      render(nothing, this.card);
      return;
    }
    this.card.dataset.mode = 'select';
    render(
      html`
        <header><h2>${playerText().replay.slotsTitle}</h2></header>
        <ol class="replay-slots-list">
          ${repeat(
            records,
            (record) => record.slot,
            (record) => this.selectRow(target, record),
          )}
        </ol>
      `,
      this.card,
    );
    this.card.hidden = false;
  }

  private selectRow(target: ReplaySlotTarget, record: ReplaySlotRecord): TemplateResult {
    const copy = playerText().replay;
    return html`<li class="replay-slots-row">
      <span class="replay-slots-name">${copy.slot(record.slot + 1)}</span>
      <span class="replay-slots-detail">${describeReplaySlotRecord(record)}</span>
      <span class="replay-slots-actions">
        <button
          class="btn"
          type="button"
          data-size="sm"
          data-slot=${record.slot + 1}
          @click=${() => this.options.replay(record.slot)}
        >
          ${copy.replay}
        </button>
        <button
          class="btn"
          type="button"
          data-size="sm"
          data-variant="outline"
          @click=${() => void this.download(target, record)}
        >
          ${copy.download}
        </button>
        <button
          class="btn"
          type="button"
          data-size="sm"
          data-variant="outline"
          @click=${() => void this.remove(target, record)}
        >
          ${copy.delete}
        </button>
      </span>
    </li>`;
  }

  /** Offers a slot's replay as the file it was saved as. */
  private async download(target: ReplaySlotTarget, record: ReplaySlotRecord): Promise<void> {
    const text = await this.options.service.store.readText(target, record.slot).catch(() => undefined);
    if (text === undefined) {
      this.options.setStatus(playerText().replay.slotUnreadable(record.slot + 1));
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
      this.options.setStatus(playerText().replay.slotDeleted(record.slot + 1));
    } catch {
      this.options.setStatus(playerText().replay.slotNotDeleted(record.slot + 1));
    }
  }
}
