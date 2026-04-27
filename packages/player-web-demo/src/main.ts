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
let selectView: PixiSongSelectView | undefined;
let gameplayView: PixiGameplayView | undefined;

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
  const tasks: Array<Promise<unknown>> = [];
  if (themeFiles.length > 0) {
    tasks.push(loadTheme(themeFiles));
  }
  if (songFiles.length > 0) {
    tasks.push(loadSongs(songFiles));
  }
  if (tasks.length === 0) {
    return;
  }
  await Promise.all(tasks);
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
 * Classifies dropped files into "LR2 theme" and "BMS chart" buckets by
 * top-level folder. A top-level folder that contains *any* `.lr2skin`
 * descendant is treated as theme; everything else is treated as chart
 * material. Single loose `.lr2skin` files (no parent folder) are also
 * routed to the theme bucket.
 */
function splitDrop(files: File[]): { themeFiles: File[]; songFiles: File[] } {
  const topLevels = new Map<string, File[]>();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const segments = path.split('/');
    const top = segments.length > 1 ? segments[0]! : '';
    const bucket = topLevels.get(top) ?? [];
    bucket.push(file);
    topLevels.set(top, bucket);
  }
  const themeFiles: File[] = [];
  const songFiles: File[] = [];
  for (const [, bucket] of topLevels) {
    if (bucket.some(isLr2SkinFile)) {
      themeFiles.push(...bucket);
    } else {
      songFiles.push(...bucket);
    }
  }
  return { themeFiles, songFiles };
}

function isLr2SkinFile(file: File): boolean {
  return /\.lr2skin$/iu.test(file.webkitRelativePath || file.name);
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
  skin = await loadLr2SkinFromFiles(files);
  status.textContent = skin ? `Theme: ${skin.name}` : 'No LR2 skin found';
}

async function showSelect(): Promise<void> {
  shell.classList.remove('playing');
  gameplayView?.dispose();
  gameplayView = undefined;
  selectView?.dispose();
  selectView = new PixiSongSelectView({
    onSongSelected: (song) => {
      void playSong(song);
    },
  });
  await selectView.mount(stage);
  selectView.setCollection(collection);
}

async function playSong(song: BrowserSongEntry): Promise<void> {
  shell.classList.add('playing');
  selectView?.dispose();
  selectView = undefined;
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
