import { BEATORAJA_SKIN_TYPE } from '@be-music/skin-beatoraja';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import '../../styles.css';
import { OptionFolder } from '../options-controls.ts';
import { buildAudioFolder } from './audio.ts';
import { refreshCompressorStageVisibility } from './compressor.ts';
import { OptionsDialog } from './index.ts';
import { OptionLayout, parseOptionsLayout } from './layout.ts';
import { rebuildSkinSettingsFolder } from './skin.ts';
import { rebuildBeatorajaSkinPickers } from './skin-pickers.ts';
import { runtimeOptionDefaults } from './runtime-defaults.ts';

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
  expect(previous).toHaveLength(1);

  skin = { id: 'second', settings: [{ kind: 'toggle', id: 'flash', label: 'Flash', default: false }] };
  rebuildSkinSettingsFolder.call(menu);
  expect(layout.folder('skinSettings').children).toEqual([fixed]);
  expect(relocated.children.map(({ element }) => element.textContent?.trim())).toEqual(['Flash']);
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

test('section reset uses the JSON defaults, applies changes in order and preserves other sections and locked settings', () => {
  const { gui, layout, place } = mount([
    {
      title: 'Play',
      items: [
        {
          folder: 'play',
          title: 'Play options',
          items: [
            { option: 'speed', kind: 'slider', default: 0 },
            { option: 'enabled', kind: 'toggle', default: false },
            { option: 'locked', kind: 'toggle', default: false },
            { option: 'workers', kind: 'slider', default: { use: 'workers' } },
            { folder: 'nested', title: 'Nested', items: [{ group: 'custom', reset: true }] },
          ],
        },
        { folder: 'view', title: 'View', items: [{ option: 'other', kind: 'toggle', default: false }] },
      ],
    },
  ]);
  const values = { enabled: true, speed: 2, locked: true, workers: 2, other: true };
  const changes: string[] = [];
  const register = <K extends keyof typeof values>(id: K) =>
    place(id)
      .addBinding(values, id, { label: id })
      .on('change', () => changes.push(id));
  register('enabled');
  register('speed');
  register('locked').disabled = true;
  register('workers');
  register('other');
  const custom = vi.fn();
  layout.setGroupReset('custom', custom);
  layout.installSectionResets((policy) => (policy === 'workers' ? 4 : undefined));
  gui.expanded = true;
  layout
    .folder('play')
    .element.querySelector<HTMLButtonElement>(':scope > .options-folder-content > .options-section-reset button')!
    .click();
  expect(values).toEqual({ enabled: false, speed: 0, locked: true, workers: 4, other: true });
  expect(changes).toEqual(['enabled', 'speed', 'workers']);
  expect(custom).toHaveBeenCalledOnce();
  layout.folder('nested').element.querySelector<HTMLButtonElement>('.options-section-reset button')!.click();
  expect(custom).toHaveBeenCalledTimes(2);
});

test('runtime defaults use the supported browser and the currently available LR2 theme', () => {
  let theme: string | undefined;
  const resolve = runtimeOptionDefaults(() => theme);
  expect(resolve('lr2Theme')).toBeUndefined();
  theme = 'Fixture LR2';
  expect(resolve('lr2Theme')).toBe('Fixture LR2');
  expect(resolve('bgaUseWebCodecs')).toBe('VideoEncoder' in globalThis);
  expect(resolve('workers')).toBeGreaterThan(0);
});

test('resetting the loaded beatoraja skin section removes the override and selects the discovered default', () => {
  const mounted = mount([
    {
      title: 'Skin',
      items: [
        {
          folder: 'beatorajaSkins',
          title: 'Beatoraja skins',
          items: [{ group: 'beatorajaSkinPickers', reset: true }],
        },
      ],
    },
  ]);
  const { layout, gui } = mounted;
  const folder = layout.folder('beatorajaSkins');
  const type = BEATORAJA_SKIN_TYPE.MUSIC_SELECT;
  const base = { entryPath: 'default.lua', header: { type, name: 'Default' } };
  const other = { entryPath: 'custom.lua', header: { type, name: 'Custom' } };
  const overrides = new Map([[type, other.entryPath]]);
  const liveSwitch = vi.fn();
  const menu = {
    ...mounted,
    beatorajaSkinPickerFolder: folder,
    beatorajaSkinPickerControllers: new Map(),
    beatorajaSkinOverridesByType: overrides,
    playLock: { skinControlsLocked: false },
    applyBeatorajaSkinSwitchIfActive: liveSwitch,
    deps: { beatorajaTheme: () => ({ theme: { entries: [base, other], playSkins: {}, selectSkin: base } }) },
  } as unknown as OptionsDialog;
  rebuildBeatorajaSkinPickers.call(menu);
  layout.installSectionResets(() => undefined);
  gui.expanded = true;
  const picker = folder.element.querySelector('select')!;
  expect(picker.selectedOptions[0]?.textContent).toContain('Custom');
  folder.element.querySelector<HTMLButtonElement>('.options-section-reset button')!.click();
  expect(overrides.has(type)).toBe(false);
  expect(picker.selectedOptions[0]?.textContent).toContain('Default');
  expect(liveSwitch).toHaveBeenCalledExactlyOnceWith(type, base.entryPath, [base, other]);
});
