import { afterEach, expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import '../../styles.css';
import { OptionFolder } from '../options-controls.ts';
import { buildAudioFolder } from './audio.ts';
import { refreshCompressorStageVisibility } from './compressor.ts';
import { OptionsDialog } from './index.ts';
import { OptionLayout, parseOptionsLayout } from './layout.ts';
import { rebuildSkinSettingsFolder } from './skin.ts';

afterEach(() => document.body.replaceChildren());

function mount(pages: unknown[]) {
  const dialog = document.createElement('dialog');
  const content = document.createElement('div');
  dialog.append(content);
  document.body.append(dialog);
  const gui = OptionFolder.dialog(dialog, content, 'Options');
  const layout = new OptionLayout(parseOptionsLayout({ version: 1, tabs: 'options', pages }), gui, vi.fn());
  return { dialog, gui, layout, tabs: layout.tabs('options'), place: layout.place.bind(layout) };
}

test('keyboard navigation and the LR2 shortcut respect a page omitted by the layout', async () => {
  const mounted = mount([
    { title: 'Play', items: [] },
    {
      title: 'Effects',
      hidden: true,
      items: [{ folder: 'lr2Mania', title: 'LR2 mania', items: [{ option: 'glow', kind: 'toggle' }] }],
    },
    { title: 'Audio', items: [] },
  ]);
  const { dialog, gui, tabs, place } = mounted;
  const setting = place('glow').addBinding({ glow: true }, 'glow', { label: 'Glow' });
  const menu = mounted as unknown as OptionsDialog;

  OptionsDialog.prototype.openLR2ManiaOptions.call(menu);
  expect(dialog.open).toBe(false);
  expect(tabs.pages[1]!.element.hidden).toBe(true);
  tabs.select(1);
  expect(tabs.pages[1]!.element.hidden).toBe(true);

  gui.expanded = true;
  tabs.element.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')!.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(tabs.pages[2]!.element.hidden).toBe(false);
  expect(document.activeElement?.textContent?.trim()).toBe('Audio');
  expect(setting.element.getClientRects().length).toBe(0);

  tabs.omitPage(1, false);
  OptionsDialog.prototype.openLR2ManiaOptions.call(menu);
  expect(tabs.pages[1]!.element.hidden).toBe(false);
  expect(setting.element.getClientRects().length).toBeGreaterThan(0);
});

test('no panel is selected when all pages are omitted, and selection returns when a page is restored', () => {
  const { gui, tabs } = mount([
    { title: 'One', hidden: true, items: [] },
    { title: 'Two', hidden: true, items: [] },
  ]);
  gui.expanded = true;
  tabs.select(1);
  expect(tabs.element.querySelector('[role=tab][aria-selected=true]')).toBeNull();
  expect(tabs.pages.map(({ element }) => element.hidden)).toEqual([true, true]);
  tabs.omitPage(1, false);
  expect(tabs.pages.map(({ element }) => element.hidden)).toEqual([true, false]);
  expect(tabs.element.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim()).toBe('Two');
});

test('real rows follow JSON order and runtime visibility cannot undo omission', () => {
  const { gui, place, tabs } = mount([
    {
      title: 'Play',
      items: [
        { option: 'first', kind: 'toggle', hidden: true },
        { option: 'second', kind: 'toggle' },
      ],
    },
  ]);
  gui.expanded = true;
  const value = { enabled: true };
  const second = place('second').addBinding(value, 'enabled', { label: 'Second' });
  const first = place('first').addBinding(value, 'enabled', { label: 'First' });
  expect(tabs.pages[0]!.children).toEqual([first, second]);
  first.hidden = true;
  first.hidden = false;
  expect(first.element.hidden).toBe(true);
  expect(first.element.hasAttribute('data-option-omitted')).toBe(true);
  expect(second.element.hidden).toBe(false);
});

test('rebuilding the skin controls replaces only the relocated group and preserves other options', () => {
  const mounted = mount([
    {
      title: 'Skin',
      items: [
        { folder: 'skinSettings', title: 'Skin settings', items: [{ option: 'fixed', kind: 'toggle' }] },
        { folder: 'relocated', title: 'Relocated', items: [{ group: 'skinSettingRows' }] },
      ],
    },
  ]);
  const { layout, place } = mounted;
  const fixed = place('fixed').addBinding({ enabled: true }, 'enabled', { label: 'Fixed' });
  let skin = { id: 'first', settings: [{ kind: 'toggle', id: 'glow', label: 'Glow', default: true }] };
  const menu = {
    ...mounted,
    skinSettingRows: [],
    skinSettings: new Map(),
    deps: { beMusicSkin: () => skin },
  } as unknown as OptionsDialog;
  rebuildSkinSettingsFolder.call(menu);
  const relocated = layout.folder('relocated');
  const previous = [...relocated.children];
  expect(previous).toHaveLength(2);

  skin = { id: 'second', settings: [{ kind: 'toggle', id: 'flash', label: 'Flash', default: false }] };
  rebuildSkinSettingsFolder.call(menu);
  expect(layout.folder('skinSettings').children).toEqual([fixed]);
  expect(relocated.children.map(({ element }) => element.textContent?.trim())).toEqual(['Flash', 'Reset to defaults']);
  expect(previous.every(({ element }) => !element.isConnected)).toBe(true);

  skin = { id: 'plain', settings: [] };
  rebuildSkinSettingsFolder.call(menu);
  expect(layout.folder('skinSettings').children).toEqual([fixed]);
  expect(relocated.children).toEqual([]);
});

test('relocated compressor stages follow the mode while unrelated settings stay visible', () => {
  const mounted = mount([
    {
      title: 'Audio',
      items: [
        { option: 'muted', kind: 'toggle' },
        { option: 'masterVolume', kind: 'slider' },
        { option: 'keyVolume', kind: 'slider' },
        { option: 'bgmVolume', kind: 'slider' },
        { option: 'peakGain', kind: 'toggle' },
        { option: 'compressorEnabled', kind: 'toggle' },
        {
          folder: 'compressorStages',
          title: 'Stages',
          items: [
            { option: 'compressorBGM', kind: 'toggle' },
            { option: 'compressorMaster', kind: 'toggle' },
            { option: 'other', kind: 'toggle' },
          ],
        },
        { group: 'compressorTuning' },
      ],
    },
    {
      title: 'Relocated',
      items: [
        { option: 'compressorKey', kind: 'toggle' },
        { option: 'fixed', kind: 'toggle' },
      ],
    },
  ]);
  const { gui, layout, place, tabs } = mounted;
  const fixed = place('fixed').addBinding({ enabled: true }, 'enabled', { label: 'Fixed' });
  const state = {
    muted: false,
    masterVolume: 100,
    keyVolume: 100,
    bgmVolume: 100,
    peakGain: false,
    compressor: false,
    compressorKey: true,
    compressorBGM: true,
    compressorMaster: true,
  };
  const menu = {
    ...mounted,
    guiState: state,
    compressorMode: 'split',
    compressorStageControllers: [],
    buildCompressorTuningGUI: vi.fn(),
  };
  const options = menu as unknown as OptionsDialog;
  buildAudioFolder.call(options);
  gui.expanded = true;
  const moved = tabs.pages[1]!.children[0]!;
  const stages = layout.folder('compressorStages').element;

  refreshCompressorStageVisibility.call(options);
  expect(getComputedStyle(stages).display).toBe('none');
  expect(moved.element.hidden).toBe(true);
  expect(fixed.element.hidden).toBe(false);
  state.compressor = true;
  refreshCompressorStageVisibility.call(options);
  expect(getComputedStyle(stages).display).not.toBe('none');
  expect(moved.element.hidden).toBe(false);
  menu.compressorMode = 'legacy';
  refreshCompressorStageVisibility.call(options);
  expect(getComputedStyle(stages).display).toBe('none');
  expect(moved.element.hidden).toBe(true);
  expect(fixed.element.hidden).toBe(false);

  const other = place('other').addBinding({ enabled: true }, 'enabled', { label: 'Other' });
  expect(getComputedStyle(stages).display).not.toBe('none');
  expect(other.element.getClientRects().length).toBeGreaterThan(0);
});
