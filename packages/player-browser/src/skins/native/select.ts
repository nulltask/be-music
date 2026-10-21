import {
  browseEntryBadge,
  browseEntryCount,
  browseEntryTitle,
  type BeMusicDOMSelectFrame,
  type BeMusicDOMSelectActions,
  type BeMusicDOMScreen,
} from '@be-music/player-skin-sdk';
import { createScreen, query, setText } from './screen.ts';

/** Native controls retain focus, browser scrolling, text selection and touch behavior across updates. */
export function mountSelect(
  container: HTMLElement,
  actions: BeMusicDOMSelectActions,
): BeMusicDOMScreen<BeMusicDOMSelectFrame> {
  const root = createScreen(
    container,
    'select',
    `
    <header><div><p class="eyebrow">Be-Music / Native</p><h1>Collection</h1></div><input type="search" aria-label="Search charts" placeholder="Search title, artist…"></header>
    <div class="columns"><section><div class="actions"><button data-back>Back</button><p class="muted" data-folder></p></div>
    <div class="options" data-options></div><ul class="rows" aria-label="Charts and folders"></ul><p class="muted" data-empty hidden>No matching charts.</p></section>
    <aside class="panel details"><div><p class="eyebrow" data-kind>Chart</p><h2 data-title>Select a chart</h2><p class="muted" data-artist></p></div>
    <p class="muted" data-facts></p><div class="actions"><button class="primary" data-play>Play</button><button data-auto>Auto play</button><button data-read>Readme</button></div>
    <pre data-readme hidden></pre><p class="muted">Arrow keys to browse · Enter to open · Escape to go back.<br>Choose Native or a Canvas skin in the Debug Menu.</p></aside></div>`,
  );
  const search = query<HTMLInputElement>(root, 'input');
  search.addEventListener('input', (event) => {
    if (!(event as InputEvent).isComposing) actions.search(search.value);
  });
  search.addEventListener('compositionend', () => actions.search(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      search.value = '';
      actions.search('');
      search.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      search.blur();
    }
  });
  root.addEventListener('pointerdown', () => actions.gesture());
  query(root, '[data-back]').addEventListener('click', () => actions.back());
  query(root, '[data-play]').addEventListener('click', () => actions.play());
  query(root, '[data-auto]').addEventListener('click', () => actions.play(true));
  query(root, '[data-read]').addEventListener('click', () => actions.readText());
  const list = query(root, '.rows');
  const rows: HTMLButtonElement[] = [];
  let listKey = '';
  let previousIndex = -1;
  let latest: BeMusicDOMSelectFrame | undefined;
  const controls = new Map<string, HTMLSelectElement>();
  const options = query(root, '[data-options]');
  for (const [key, label] of [
    ['gauge1P', 'Gauge'],
    ['random1P', 'Lanes'],
    ['sort', 'Sort'],
    ['keysFilter', 'Key mode'],
    ['difficultyFilter', 'Difficulty'],
  ] as const) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const select = document.createElement('select');
    select.dataset.option = key;
    select.setAttribute('aria-label', label);
    select.addEventListener('change', () => {
      const value = latest?.playOptionChoices[key]?.find((choice) => String(choice) === select.value);
      if (value !== undefined) actions.setPlayOption(key, value);
    });
    wrapper.append(select);
    options.append(wrapper);
    controls.set(key, select);
  }
  return {
    update(frame) {
      const active = (root.getRootNode() as ShadowRoot).activeElement;
      const listHadFocus = rows.some((row) => row === active);
      latest = frame;
      search.disabled = frame.launching;
      query<HTMLButtonElement>(root, '[data-back]').disabled = frame.launching;
      if (search.value !== frame.searchQuery) search.value = frame.searchQuery;
      setText(query(root, '[data-folder]'), frame.folderLabel ?? 'All folders');
      const nextKey = JSON.stringify(
        frame.entries.map((entry) => [
          entry.kind,
          entry.kind === 'chart' ? entry.chart.id : entry.kind === 'folder' ? entry.folder.label : entry.course.id,
          browseEntryTitle(entry),
          browseEntryCount(entry),
        ]),
      );
      if (listKey !== nextKey) {
        listKey = nextKey;
        previousIndex = -1;
        rows.length = 0;
        list.replaceChildren();
        for (const [index, entry] of frame.entries.entries()) {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.className = 'row';
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = browseEntryBadge(entry);
          const title = document.createElement('strong');
          title.textContent = browseEntryTitle(entry);
          const subtitle = document.createElement('span');
          subtitle.className = 'muted';
          subtitle.textContent = entry.kind === 'chart' ? (entry.chart.artist ?? '') : (browseEntryCount(entry) ?? '');
          const words = document.createElement('span');
          words.append(title, subtitle);
          button.append(badge, words);
          button.addEventListener('click', () => {
            actions.focus(index);
            if (entry.kind === 'folder') actions.activate();
          });
          if (entry.kind !== 'folder') button.addEventListener('dblclick', () => actions.activate());
          button.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
            event.preventDefault();
            event.stopPropagation();
            actions.focus(index);
            actions.activate();
          });
          button.addEventListener('focus', () => actions.focus(index));
          item.append(button);
          list.append(item);
          rows.push(button);
        }
      }
      for (const [index, row] of rows.entries()) {
        row.setAttribute('aria-current', String(index === frame.selectedIndex));
        row.tabIndex = index === frame.selectedIndex ? 0 : -1;
        row.disabled = frame.launching;
      }
      if (previousIndex !== frame.selectedIndex) {
        rows[frame.selectedIndex]?.scrollIntoView({ block: 'nearest' });
        if (listHadFocus) rows[frame.selectedIndex]?.focus({ preventScroll: true });
        previousIndex = frame.selectedIndex;
      }
      query<HTMLElement>(root, '[data-empty]').hidden = frame.entries.length !== 0;
      const entry = frame.entries[frame.selectedIndex];
      setText(query(root, '[data-kind]'), entry?.kind ?? 'Collection');
      setText(query(root, '[data-title]'), entry ? browseEntryTitle(entry) : 'No chart selected');
      setText(query(root, '[data-artist]'), entry?.kind === 'chart' ? (entry.chart.artist ?? '') : '');
      setText(
        query(root, '[data-facts]'),
        entry?.kind === 'chart'
          ? `Level ${entry.chart.playLevel ?? '—'} · ${entry.chart.bpm ?? '—'} BPM`
          : entry
            ? (browseEntryCount(entry) ?? '')
            : '',
      );
      for (const selector of ['[data-play]', '[data-auto]'])
        query<HTMLButtonElement>(root, selector).disabled = frame.launching || !entry || entry.kind === 'folder';
      query<HTMLButtonElement>(root, '[data-read]').disabled = entry?.kind !== 'chart';
      const readme = query<HTMLElement>(root, '[data-readme]');
      readme.hidden = frame.readText === undefined;
      setText(readme, frame.readText ?? '');
      for (const [key, select] of controls) {
        const choices = frame.playOptionChoices[key as keyof typeof frame.playOptionChoices] ?? [];
        if (select.options.length !== choices.length)
          select.replaceChildren(...choices.map((choice) => new Option(String(choice), String(choice))));
        select.value = String(frame.playOptions[key as keyof typeof frame.playOptions]);
        select.disabled = frame.launching;
      }
    },
    focusSearch() {
      search.focus();
      search.select();
    },
    dispose() {
      root.remove();
    },
  };
}
