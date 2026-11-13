import './ui/collapsible-panel.ts';
import { html, nothing, render, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { downloadBlob } from '@be-music/player-browser/recording';
import { onPlayerLangChange, playerLang, playerText } from './player-copy.ts';
import { skeletonGroupTemplate, skeletonTemplate } from '@be-music/service-web-theme/client';
import { REPLAY_SLOT_COUNT, type LibraryEntry } from '@be-music/player-scene-model';
import type { ReplayHistoryRecord, ReplaySlotRecord, ReplaySlotTarget } from './services/replay-slots.ts';
import type { ReplaySlotService, ResultReplaySlots } from './services/replay-slot-service.ts';

/** What the card shows. */
type PanelMode =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'result'; readonly slots: ResultReplaySlots }
  | { readonly kind: 'select'; readonly target?: ReplaySlotTarget; readonly showSlots: boolean };

export interface ReplaySlotsPanelOptions {
  readonly service: ReplaySlotService;
  /** Replays slot `slot` of the bar under the cursor (`SelectScene.replay`). */
  readonly replay: (slot: number) => void;
  readonly replayHistory: (record: ReplayHistoryRecord) => void;
  readonly setStatus: (text: string) => void;
}

/** What a slot's record says on the card: its EX score and rate, its lamp and when it was saved. */
export function describeReplaySlotRecord(
  record: Pick<ReplayHistoryRecord, 'exRate' | 'exScore' | 'lamp' | 'savedAt'>,
): string {
  const rate = (record.exRate * 100).toFixed(2);
  const savedAt = new Date(record.savedAt);
  const date = Number.isNaN(savedAt.getTime()) ? record.savedAt : savedAt.toLocaleString();
  return `EX ${record.exScore} (${rate}%) · ${record.lamp.replaceAll('_', ' ')} · ${date}`;
}

/** The replay slots' card. See the module comment. */
export class ReplaySlotsPanel {
  private readonly card: HTMLElement;
  private readonly options: ReplaySlotsPanelOptions;
  private expanded = true;
  private mode: PanelMode = { kind: 'hidden' };
  private readonly unsubscribe: () => void;
  private readonly unsubscribeLanguage: () => void;
  private historyOpen = false;
  private showAllHistory = false;
  private unsubscribeResult: (() => void) | undefined;

  public constructor(options: ReplaySlotsPanelOptions) {
    this.options = options;
    this.card = document.createElement('aside');
    this.card.className = 'replay-slots-card';
    this.card.hidden = true;

    document.querySelector('#auxiliary-panels')!.append(this.card);
    this.unsubscribe = options.service.store.subscribe(() => this.render());
    this.unsubscribeLanguage = onPlayerLangChange(() => this.render());
  }

  /** Shows a result screen's slots, to save the play into. */
  public showResult(slots: ResultReplaySlots): void {
    this.setMode({ kind: 'result', slots });
    this.unsubscribeResult = slots.subscribe(() => this.render());
  }

  /** Shows history on every select skin, with slot controls on skins that do not draw their own. */
  public showSelect(entry: LibraryEntry | undefined, showSlots = true): void {
    const target = entry !== undefined && entry.kind !== 'folder' ? this.options.service.targetOf(entry) : undefined;
    this.setMode({ kind: 'select', ...(target === undefined ? {} : { target }), showSlots });
  }

  public hide(): void {
    this.setMode({ kind: 'hidden' });
  }

  public dispose(): void {
    this.unsubscribe();
    this.unsubscribeLanguage();
    this.unsubscribeResult?.();
    render(nothing, this.card);
    this.card.remove();
  }

  private setMode(mode: PanelMode): void {
    this.unsubscribeResult?.();
    this.unsubscribeResult = undefined;
    if (mode.kind !== this.mode.kind) this.expanded = mode.kind === 'result';
    if (
      mode.kind === 'select' &&
      this.mode.kind === 'select' &&
      !this.showAllHistory &&
      (mode.target?.kind !== this.mode.target?.kind || mode.target?.id !== this.mode.target?.id)
    ) {
      this.card.querySelector('.replay-history-list')?.scrollTo(0, 0);
    }
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
      this.renderSelect(mode.target, mode.showSlots);
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
    this.card.setAttribute('aria-label', copy.slotsTitle);
    render(
      html`
        <be-music-collapsible-panel
          position="inline"
          .heading=${copy.slotsTitle}
          .open=${this.expanded}
          @panel-toggle=${(event: CustomEvent<{ open: boolean }>) => {
            this.expanded = event.detail.open;
          }}
        >
          <div class="replay-slots-content">
            <header>
              <p>${slots.saveable ? copy.saveHint : copy.cannotSave}</p>
            </header>
            ${
              slots.saveable
                ? html`<ol class="replay-slots-list">
                    ${Array.from({ length: REPLAY_SLOT_COUNT }, (_, slot) => {
                      const state = states[slot];
                      const record = records[slot];
                      return html`<li class="replay-slots-row">
                        <span class="replay-slots-name">${copy.slot(slot + 1)}</span>
                        <span class="replay-slots-detail"
                          >${
                            state === 'saved'
                              ? copy.savedNow
                              : record !== undefined
                                ? describeReplaySlotRecord(record)
                                : slots.loaded
                                  ? copy.empty
                                  : skeletonGroupTemplate({
                                      locale: playerLang(),
                                      content: skeletonTemplate({ shape: 'line', width: '24ch' }),
                                    })
                          }</span
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
                  </ol>`
                : nothing
            }
          </div>
        </be-music-collapsible-panel>
      `,
      this.card,
    );
    this.card.hidden = false;
  }

  private renderSelect(target: ReplaySlotTarget | undefined, showSlots: boolean): void {
    const store = this.options.service.store;
    const records = showSlots ? store.slots(target).filter((record) => record !== undefined) : [];
    const copy = playerText().replay;
    const all = this.showAllHistory || target === undefined;
    const history = this.expanded && this.historyOpen ? store.history(all ? undefined : target) : [];
    this.card.dataset.mode = 'select';
    this.card.setAttribute('aria-label', copy.historyTitle);
    render(
      html`
        <be-music-collapsible-panel
          position="inline"
          .heading=${showSlots ? copy.slotsAndHistory : copy.historyTitle}
          .open=${this.expanded}
          @panel-toggle=${(event: CustomEvent<{ open: boolean }>) => {
            this.expanded = event.detail.open;
            this.render();
          }}
        >
          <div class="replay-slots-content">
            ${
              records.length > 0 && target !== undefined
                ? html`<ol class="replay-slots-list">
                    ${repeat(
                      records,
                      (record) => record.slot,
                      (record) => this.selectRow(target, record),
                    )}
                  </ol>`
                : nothing
            }
            <details
              .open=${this.historyOpen}
              @toggle=${(event: Event) => {
                const open = (event.currentTarget as HTMLDetailsElement).open;
                if (open === this.historyOpen) return;
                this.historyOpen = open;
                this.render();
              }}
            >
              <summary>${copy.historyTitle}</summary>
              ${
                this.expanded && this.historyOpen
                  ? html`<label class="replay-history-scope">
                        <input
                          type="checkbox"
                          .checked=${all}
                          ?disabled=${target === undefined}
                          @change=${(event: Event) => {
                            this.showAllHistory = (event.currentTarget as HTMLInputElement).checked;
                            this.card.querySelector('.replay-history-list')?.scrollTo(0, 0);
                            this.render();
                          }}
                        />
                        ${copy.allHistory}
                      </label>
                      ${
                        history.length > 0
                          ? html`<ol
                              class="replay-slots-list replay-history-list"
                              tabindex="0"
                              aria-label=${copy.historyTitle}
                            >
                              ${repeat(
                                history,
                                (record) => record.key,
                                (record) => this.historyRow(record),
                              )}
                            </ol>`
                          : html`<p>${store.loaded ? copy.emptyHistory : copy.loadingHistory}</p>`
                      }`
                  : nothing
              }
            </details>
          </div>
        </be-music-collapsible-panel>
      `,
      this.card,
    );
    this.card.hidden = false;
  }

  private historyRow(record: ReplayHistoryRecord): TemplateResult {
    const copy = playerText().replay;
    return html`<li class="replay-slots-row">
      <span class="replay-slots-name">${record.title}</span>
      <span class="replay-slots-detail">${describeReplaySlotRecord(record)}</span>
      <span class="replay-slots-actions">
        <button class="btn" type="button" data-size="sm" @click=${() => this.options.replayHistory(record)}>
          ${copy.replay}
        </button>
        <button
          class="btn"
          type="button"
          data-size="sm"
          data-variant="outline"
          @click=${() => void this.download(record)}
        >
          ${copy.download}
        </button>
        <button
          class="btn"
          type="button"
          data-size="sm"
          data-variant="outline"
          @click=${() => void this.removeHistory(record)}
        >
          ${copy.delete}
        </button>
      </span>
    </li>`;
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
          @click=${() => void this.download(record, record.slot)}
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
          ${copy.clearSlot}
        </button>
      </span>
    </li>`;
  }

  private async download(record: ReplayHistoryRecord | ReplaySlotRecord, slot?: number): Promise<void> {
    const text = await this.options.service.store.readHistoryText(record.key).catch(() => undefined);
    if (text === undefined) {
      this.options.setStatus(playerText().replay.historyUnreadable);
      return;
    }
    const stem = record.title.normalize('NFKC').replace(/[\\/:*?"<>|\s]+/g, '_') || 'replay';
    const extension = record.target.kind === 'chart' ? 'bmplay.json' : 'bmcourse.json';
    const suffix = slot === undefined ? record.savedAt.replace(/[^0-9]/g, '') : `slot${slot + 1}`;
    downloadBlob(new Blob([text], { type: 'application/json' }), `${stem}-${suffix}.${extension}`);
  }

  private async removeHistory(record: ReplayHistoryRecord): Promise<void> {
    const copy = playerText().replay;
    if (!window.confirm(copy.confirmDeleteHistory(record.title))) return;
    try {
      await this.options.service.store.removeHistory(record.key);
      this.options.setStatus(copy.historyDeleted);
    } catch {
      this.options.setStatus(copy.historyNotDeleted);
    }
  }

  /** Empties a slot, once the player confirms. */
  private async remove(target: ReplaySlotTarget, record: ReplaySlotRecord): Promise<void> {
    if (!window.confirm(playerText().replay.confirmClearSlot(record.slot + 1, record.title))) return;
    try {
      await this.options.service.store.remove(target, record.slot);
      this.options.setStatus(playerText().replay.slotDeleted(record.slot + 1));
    } catch {
      this.options.setStatus(playerText().replay.slotNotDeleted(record.slot + 1));
    }
  }
}
