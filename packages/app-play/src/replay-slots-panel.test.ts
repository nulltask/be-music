// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { URL as NodeURL } from 'node:url';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { makeChartWith } from '../../player-scene-model/src/test-support/library.ts';
import { setPlayerLang } from './player-copy.ts';
import { ReplaySlotsPanel } from './replay-slots-panel.ts';
import { ReplaySlotService, ResultReplaySlots } from './services/replay-slot-service.ts';
import { createMemoryReplaySlotBackend, ReplaySlotStore } from './services/replay-slots.ts';

let panel: ReplaySlotsPanel | undefined;

beforeEach(() => {
  setPlayerLang('en');
  vi.stubGlobal('Blob', NodeBlob);
  const auxiliary = document.createElement('div');
  auxiliary.id = 'auxiliary-panels';
  document.body.append(auxiliary);
});

afterEach(() => {
  panel?.dispose();
  panel = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const store = new ReplaySlotStore({
    backend: createMemoryReplaySlotBackend(),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
  });
  const service = new ReplaySlotService({ store, nonstopPlacement: () => 'intended' });
  const entry = { kind: 'chart' as const, chart: makeChartWith('Fixture A', 'Folder', { channels: ['11'] }) };
  const target = service.targetOf(entry)!;
  const replay: BeMusicReplay = {
    format: 'be-music-replay',
    version: 0,
    chart: {
      title: 'A: Take 1',
      chartFingerprint: target.id,
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 1,
      notes: [{ id: 0, channel: '11', type: 'normal', timeUs: 500_000 }],
    },
    clock: { unit: 'us', origin: 'chart-zero' },
    play: { inputSources: [], mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
    inputs: [],
  };
  const payload = { kind: 'chart' as const, replay };
  const score = { lamp: 'HARD' as const, exScore: 2, maxCombo: 1, missCount: 0, noteCount: 1 };
  const status = vi.fn();
  const playSlot = vi.fn();
  const playHistory = vi.fn();
  panel = new ReplaySlotsPanel({ service, replay: playSlot, replayHistory: playHistory, setStatus: status });
  const card = document.querySelector('aside')!;
  return { panel, card, entry, store, target, payload, score, status, playSlot, playHistory };
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll('button')].find((node) => node.textContent?.trim() === label);
  if (match === undefined) throw new Error(`Missing button ${label}`);
  return match;
}

async function openHistory(card: HTMLElement): Promise<HTMLOListElement> {
  const disclosure = card.querySelector('be-music-collapsible-panel')!;
  await disclosure.updateComplete;
  disclosure.shadowRoot!.querySelector('summary')!.click();
  await vi.waitFor(() => expect(disclosure.open).toBe(true));
  card.querySelector<HTMLDetailsElement>('details.replay-history')!.open = true;
  return vi.waitFor(() => {
    const list = card.querySelector<HTMLOListElement>('ol.replay-history-list');
    expect(list).not.toBeNull();
    return list!;
  });
}

test('saving from the result updates the slot button and plays that slot from select', async () => {
  const { panel, card, store, target, entry, payload, score, status, playSlot } = setup();
  const result = new ResultReplaySlots({
    store,
    target,
    report: status,
    save: { payload, score, title: 'A: Take 1', previous: undefined },
  });
  panel.showResult(result);
  const slot2 = card.querySelector<HTMLButtonElement>('button[data-slot="2"]')!;
  expect(slot2.textContent?.trim()).toBe('Save');
  slot2.click();
  await vi.waitFor(() => expect(slot2.textContent?.trim()).toBe('Saved'));
  expect(slot2.disabled).toBe(true);
  expect(status).toHaveBeenCalledWith('Saved the replay to replay slot 2');

  panel.showSelect(entry);
  const play = card.querySelector<HTMLButtonElement>('button[data-slot="2"]')!;
  expect(play.textContent?.trim()).toBe('Replay');
  play.click();
  expect(playSlot).toHaveBeenCalledExactlyOnceWith(1);
  await expect(store.read(target, 1)).resolves.toMatchObject({
    kind: 'chart',
    replay: { chart: { title: 'A: Take 1', noteCount: 1 } },
  });
});

test('clearing a slot leaves its replay playable in history, until the user deletes it there', async () => {
  const { panel, card, store, target, entry, payload, score, status, playHistory } = setup();
  expect(await store.save(target, [0], payload, score, 'A: Take 1')).toMatchObject({ saved: true });
  panel.showSelect(entry);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  button(card, 'Clear slot').click();
  expect(confirm).toHaveBeenCalledWith('Clear slot 1 for “A: Take 1”? The replay stays in history.');
  expect(store.exists(target)).toEqual([true, false, false, false]);

  confirm.mockReturnValue(true);
  button(card, 'Clear slot').click();
  await vi.waitFor(() => expect(status).toHaveBeenCalledWith('Cleared replay slot 1'));
  expect(card.querySelector('button[data-slot="1"]')).toBeNull();
  const history = await openHistory(card);
  expect(history.textContent).toContain('A: Take 1');
  button(history, 'Replay').click();
  expect(playHistory).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'A: Take 1', slots: [] }));

  button(history, 'Delete').click();
  await vi.waitFor(() => expect(status).toHaveBeenCalledWith('Deleted the replay from history.'));
  expect(card.textContent).toContain('No replays in history.');
  expect(store.history(target)).toEqual([]);
});

test('downloads the saved replay using a safe chart title and the visible slot number', async () => {
  const { panel, card, store, target, entry, payload, score } = setup();
  expect(await store.save(target, [2], payload, score, 'A: Take 1')).toMatchObject({ saved: true });
  panel.showSelect(entry);
  vi.stubGlobal('URL', NodeURL);
  const objectURL = vi.spyOn(NodeURL, 'createObjectURL');
  const downloaded: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloaded.push(this.download);
  });
  button(card, 'Download').click();
  await vi.waitFor(() => expect(downloaded).toEqual(['A_Take_1-slot3.bmplay.json']));
  const data = objectURL.mock.calls[0]![0];
  expect(data.type).toBe('application/json');
  expect(JSON.parse(await data.text())).toMatchObject({
    format: 'be-music-replay',
    chart: { title: 'A: Take 1', notes: [{ channel: '11', timeUs: 500_000 }] },
  });
  await vi.waitFor(() => expect(document.querySelector('a[download]')).toBeNull());
});
