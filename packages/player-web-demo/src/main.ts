import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiSongSelectView,
  loadLr2SkinFromFiles,
  readDroppedFiles,
  resolveSongSource,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type Lr2Skin,
  type PixiSongSelectNavigation,
} from '@be-music/player-web-core';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = `
  <div class="shell">
    <div class="toolbar">
      <label>BMS folder / ZIP<input id="songs" type="file" webkitdirectory multiple /></label>
      <label class="autoplay"><input id="autoplay" type="checkbox" /> Auto play</label>
      <button id="back" type="button">Song select</button>
      <span class="status" id="status">Ready</span>
    </div>
    <div class="stage" id="stage"><div class="drop">Drop BMS folder + LR2 theme together (or either one)</div></div>
  </div>
`;

const stage = document.querySelector<HTMLDivElement>('#stage')!;
const shell = document.querySelector<HTMLDivElement>('.shell')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const songInput = document.querySelector<HTMLInputElement>('#songs')!;
const autoPlayInput = document.querySelector<HTMLInputElement>('#autoplay')!;
const backButton = document.querySelector<HTMLButtonElement>('#back')!;
const library = new BrowserSongLibrary();
let collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
let skin: Lr2Skin | undefined;
let selectSkin: Lr2Skin | undefined;
let selectView: PixiSongSelectView | undefined;
let gameplayView: PixiGameplayView | undefined;
/**
 * Last-known cursor / folder state of the select view, captured just
 * before we transition into gameplay so we can restore it when the
 * user comes back. Persists across the disposal-and-recreate cycle
 * `playSong` → `showSelect`.
 */
let lastSelectNavigation: PixiSongSelectNavigation | undefined;

void showSelect();

songInput.addEventListener('change', () => {
  if (!songInput.files) {
    return;
  }
  void (async () => {
    await loadSongs([...songInput.files!]);
    await showSelect();
  })();
});

backButton.addEventListener('click', () => {
  void showSelect();
});

window.addEventListener('dragover', (event) => {
  event.preventDefault();
  document.body.classList.add('dragging');
});

window.addEventListener('dragleave', () => {
  document.body.classList.remove('dragging');
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  if (event.dataTransfer) {
    void handleDrop(event.dataTransfer);
  }
});

async function handleDrop(dataTransfer: DataTransfer): Promise<void> {
  const files = await readDroppedFiles(dataTransfer);
  if (files.length === 0) {
    return;
  }
  // Split the drop into theme files and chart files so the user can drop
  // BOTH a BMS song folder AND the LR2 theme tree in a single gesture and
  // have each end up at the right loader.
  const { themeFiles, songFiles } = splitDrop(files);
  // eslint-disable-next-line no-console
  console.log(`[drop] received ${files.length} file(s) · theme=${themeFiles.length} · songs=${songFiles.length}`);
  const tasks: Array<Promise<unknown>> = [];
  if (themeFiles.length > 0) {
    tasks.push(loadTheme(themeFiles));
  }
  if (songFiles.length > 0) {
    tasks.push(loadSongs(songFiles));
  }
  if (tasks.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[drop] nothing to load — neither theme nor chart files matched');
    return;
  }
  await Promise.all(tasks);
  // eslint-disable-next-line no-console
  console.log(
    `[drop] loaded · songs=${collection.songs.length} · errors=${collection.errors.length} · play-skin=${skin?.name ?? 'none'} · select-skin=${selectSkin?.name ?? 'none'}`,
  );
  if (collection.errors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[drop] parse errors:', collection.errors);
  }
  // Both loaders set their own status; merge into a combined readout.
  const parts: string[] = [];
  if (skin) {
    parts.push(`Theme: ${skin.name}`);
  }
  if (collection.songs.length > 0) {
    parts.push(describeLoadResult(collection));
  }
  if (parts.length > 0) {
    status.textContent = parts.join('  •  ');
  }
  await showSelect();
}

/**
 * Classifies dropped files into "LR2 theme" and "BMS chart" buckets.
 *
 * Strategy:
 *   1. Find every directory containing a chart file (`.bms` / `.bme` /
 *      `.bml` / `.pms` / `.bmson`). Those are **chart directories**.
 *   2. A file is "song" if it lives in any chart directory or one of
 *      its descendants — the BMS spec keeps WAV / BMP assets next to
 *      the chart, so this captures all needed song assets.
 *   3. Every remaining file is "theme" (skin CSV / PNG / TGA / fonts /
 *      etc.).
 *
 * The previous "any `.lr2skin` in a top-level folder → whole folder is
 * theme" rule misclassified the common case of dropping a single root
 * (`LR2files/`) that contains both `Theme/` and `Sound/`, routing
 * 100 % of files to the theme bucket. Driving the split off chart
 * directories instead handles arbitrary nestings — including the
 * standard layout where songs and theme share a root — because BMS
 * files always sit in their own per-song folder.
 */
function splitDrop(files: File[]): { themeFiles: File[]; songFiles: File[] } {
  const songDirPrefixes = new Set<string>();
  for (const file of files) {
    if (isChartFile(file)) {
      const path = file.webkitRelativePath || file.name;
      songDirPrefixes.add(directoryOf(path));
    }
  }
  // No chart files found — treat the whole drop as theme material so a
  // user dropping just a theme bundle doesn't end up with both buckets
  // empty (and the chart bucket isn't useful anyway).
  if (songDirPrefixes.size === 0) {
    return { themeFiles: files, songFiles: [] };
  }
  const isSongPath = (path: string): boolean => {
    for (const dir of songDirPrefixes) {
      if (dir === '') return true; // chart at the drop root → everything is song
      if (path === dir || path.startsWith(`${dir}/`)) return true;
    }
    return false;
  };

  const themeFiles: File[] = [];
  const songFiles: File[] = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (isSongPath(path)) {
      songFiles.push(file);
    } else {
      themeFiles.push(file);
    }
  }
  return { themeFiles, songFiles };
}

function isChartFile(file: File): boolean {
  return /\.(bms|bme|bml|pms|bmson)$/iu.test(file.webkitRelativePath || file.name);
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

async function loadSongs(files: File[]): Promise<void> {
  status.textContent = 'Loading songs...';
  collection = await library.loadFromFiles(files);
  status.textContent = describeLoadResult(collection);
}

function describeLoadResult(result: BrowserSongCollection): string {
  return `${result.songs.length} charts loaded${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`;
}

async function loadTheme(files: File[]): Promise<void> {
  status.textContent = 'Loading LR2 theme...';
  // Load both the play skin (for gameplay) and the select skin (for the
  // song-select view) from the same dropped theme bundle. The loader
  // picks one .lr2skin per kind based on filename / directory hints —
  // see `scoreSkinPath` and `isSkinPathOfKind` in `lr2-skin.ts`.
  [skin, selectSkin] = await Promise.all([
    loadLr2SkinFromFiles(files, { kind: 'play' }),
    loadLr2SkinFromFiles(files, { kind: 'select' }),
  ]);
  const parts: string[] = [];
  if (skin) parts.push(`Play: ${skin.name}`);
  if (selectSkin) parts.push(`Select: ${selectSkin.name}`);
  status.textContent = parts.length > 0 ? `Theme — ${parts.join(', ')}` : 'No LR2 skin found';
}

async function showSelect(): Promise<void> {
  shell.classList.remove('playing');
  // Tear down gameplay (we always recreate it per play session — its
  // chart / audio state isn't reusable). Reuse the select view across
  // calls so the PixiJS `Application` only initialises once: a quick
  // destroy → re-init cycle trips the PixiJS Devtools browser
  // extension with a "Cannot read properties of null (reading
  // 'batch')" error during render-target setup. Reusing the view also
  // avoids the WebGL context churn.
  gameplayView?.dispose();
  gameplayView = undefined;
  if (selectView) {
    selectView.setVisible(true);
    selectView.setSkin(selectSkin);
    if (lastSelectNavigation) {
      selectView.setNavigation(lastSelectNavigation);
    }
    selectView.setCollection(collection);
    return;
  }
  selectView = new PixiSongSelectView({
    skin: selectSkin,
    initialNavigation: lastSelectNavigation,
    onSongSelected: (song) => {
      void playSong(song);
    },
  });
  await selectView.mount(stage);
  selectView.setCollection(collection);
}

async function playSong(song: BrowserSongEntry): Promise<void> {
  shell.classList.add('playing');
  // Capture the cursor / folder state so the next `showSelect` can
  // restore it. Hide the select canvas instead of disposing — same
  // rationale as `showSelect`: avoid the Pixi destroy → re-init cycle.
  lastSelectNavigation = selectView?.getNavigation();
  selectView?.setVisible(false);
  gameplayView?.dispose();
  gameplayView = new PixiGameplayView({
    skin,
    autoPlay: autoPlayInput.checked,
    onExit: () => {
      void showSelect();
    },
  });
  status.textContent = `Playing: ${song.title}`;
  await gameplayView.mount(stage, song, resolveSongSource(collection, song));
}
