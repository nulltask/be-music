import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiSceneHost,
  PixiSongSelectView,
  loadLr2SkinFromFiles,
  readDroppedFiles,
  resolveChartPlayVariant,
  resolveSongSource,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type Lr2PlayVariant,
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
      <label class="autoplay"><input id="compressor" type="checkbox" checked /> Compressor</label>
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
const compressorInput = document.querySelector<HTMLInputElement>('#compressor')!;
const backButton = document.querySelector<HTMLButtonElement>('#back')!;
const library = new BrowserSongLibrary();
let collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
/**
 * Per-variant play skins, keyed by `Lr2PlayVariant`. Loaded once at
 * theme-drop time so a DP chart can pick `playSkins['14']` while a
 * regular SP chart picks `playSkins['7']`. Falls back through
 * variants on a per-song basis (`pickPlaySkin`) when the requested
 * one isn't bundled — many themes ship only `play_7.lr2skin`.
 */
const playSkins: Partial<Record<Lr2PlayVariant, Lr2Skin>> = {};
let selectSkin: Lr2Skin | undefined;
let selectView: PixiSongSelectView | undefined;
let gameplayView: PixiGameplayView | undefined;
/**
 * Single PixiJS host shared by every scene (select / gameplay).
 * Owns the canvas, the WebGL context, the `Application` ticker —
 * scenes are added/removed from `host.app.stage` on transitions
 * (`PixiSceneHost.setScene`) instead of having each create its own
 * `Application`. This avoids Pixi v8's module-shared `batchPool`
 * race that two-Application setups hit on dispose, and matches the
 * official "use a single Application for the lifetime of your app"
 * guidance.
 */
const sceneHost = new PixiSceneHost();
let hostMounted = false;
async function ensureHostMounted(): Promise<void> {
  if (hostMounted) return;
  hostMounted = true;
  await sceneHost.mount(stage);
}
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

compressorInput.addEventListener('change', () => {
  // Live toggle — applies to the currently-playing gameplay view
  // (no restart needed). On the next mount the new `playSong` call
  // also picks up this state via the constructor option.
  gameplayView?.setAudioCompressor(compressorInput.checked);
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
  const playSkinSummary = (Object.entries(playSkins) as Array<[Lr2PlayVariant, Lr2Skin]>)
    .map(([variant, value]) => `${variant}K=${value.name}`)
    .join(',');
  // eslint-disable-next-line no-console
  console.log(
    `[drop] loaded · songs=${collection.songs.length} · errors=${collection.errors.length} · play-skins=${
      playSkinSummary || 'none'
    } · select-skin=${selectSkin?.name ?? 'none'}`,
  );
  if (collection.errors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[drop] parse errors:', collection.errors);
  }
  // Both loaders set their own status; merge into a combined readout.
  const parts: string[] = [];
  if (playSkinSummary) {
    parts.push(`Theme: ${playSkinSummary}`);
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
  // Load every play-skin variant the bundle ships in parallel so a
  // DP chart can pick `playSkins['14']` and a SP-7K chart picks
  // `playSkins['7']` without re-parsing files mid-session. The
  // loader returns `undefined` for variants that don't exist —
  // we just skip those slots, and `pickPlaySkin` falls through to
  // whatever IS available at play time.
  const variants: Lr2PlayVariant[] = ['7', '14', '10', '5', '9'];
  const [variantSkins, loadedSelectSkin] = await Promise.all([
    Promise.all(variants.map((v) => loadLr2SkinFromFiles(files, { kind: 'play', playVariant: v }))),
    loadLr2SkinFromFiles(files, { kind: 'select' }),
  ]);
  // Reset previous slots so an old DP skin doesn't leak into a new
  // SP-only theme drop.
  for (const v of variants) {
    delete playSkins[v];
  }
  variants.forEach((v, i) => {
    const result = variantSkins[i];
    if (result) {
      playSkins[v] = result;
    }
  });
  selectSkin = loadedSelectSkin;
  const parts: string[] = [];
  const playEntries = Object.entries(playSkins) as Array<[Lr2PlayVariant, Lr2Skin]>;
  if (playEntries.length > 0) {
    parts.push(
      `Play: ${playEntries.map(([variant, value]) => `${variant}K=${value.name}`).join(' / ')}`,
    );
  }
  if (selectSkin) parts.push(`Select: ${selectSkin.name}`);
  status.textContent = parts.length > 0 ? `Theme — ${parts.join(', ')}` : 'No LR2 skin found';
}

/**
 * Picks the best-matching `play_<variant>.lr2skin` for the given
 * song. Tries the exact variant first, then steps through sensible
 * fallbacks (DP→SP if no DP skin, 5K→7K, etc.). Returns
 * `undefined` only when no play skin was bundled at all.
 */
function pickPlaySkin(song: BrowserSongEntry): Lr2Skin | undefined {
  const target = resolveChartPlayVariant(song);
  // Per-target fallback chain: most-specific first, then the
  // closest-fitting alternates.
  const fallbacks: Record<Lr2PlayVariant, Lr2PlayVariant[]> = {
    '14': ['14', '10', '7', '5', '9'],
    '10': ['10', '14', '7', '5', '9'],
    '7': ['7', '14', '5', '10', '9'],
    '5': ['5', '7', '14', '10', '9'],
    '9': ['9', '7', '14', '5', '10'],
  };
  for (const variant of fallbacks[target]) {
    const candidate = playSkins[variant];
    if (candidate) return candidate;
  }
  return undefined;
}

async function showSelect(): Promise<void> {
  shell.classList.remove('playing');
  await ensureHostMounted();
  // Tear down gameplay (we always recreate it per play session — its
  // chart / audio state isn't reusable). The select view stays alive
  // across plays so we only mount it once; subsequent visits flip
  // `setVisible(true)` and refresh state.
  gameplayView?.dispose();
  gameplayView = undefined;
  if (selectView) {
    selectView.setVisible(true);
    selectView.setSkin(selectSkin);
    // Order matters: `setCollection` first (no-op when the
    // collection reference is unchanged, full state reset when it
    // isn't), then `setNavigation` so the live snapshot wins over
    // any constructor-time `initialNavigation` and over the
    // single-folder auto-enter behaviour the reset triggers. With
    // the reverse order the live snapshot would be discarded by
    // the subsequent `setCollection`.
    selectView.setCollection(collection);
    if (lastSelectNavigation) {
      selectView.setNavigation(lastSelectNavigation);
    }
    return;
  }
  selectView = new PixiSongSelectView({
    skin: selectSkin,
    initialNavigation: lastSelectNavigation,
    onSongSelected: (song) => {
      void playSong(song);
    },
  });
  await selectView.mount(sceneHost);
  selectView.setCollection(collection);
}

async function playSong(song: BrowserSongEntry): Promise<void> {
  shell.classList.add('playing');
  await ensureHostMounted();
  // Capture the cursor / folder state so the next `showSelect` can
  // restore it. Hide the select view's subtree (now via
  // `sceneRoot.visible = false`) instead of disposing — the host's
  // `Application` keeps it alive and we save the re-init cost.
  lastSelectNavigation = selectView?.getNavigation();
  selectView?.setVisible(false);
  gameplayView?.dispose();
  // Pick the play skin variant matching the song's mode (SP-7K /
  // DP-14K / etc.). With no DP skin in the bundle, `pickPlaySkin`
  // falls back to whatever is available — typically the SP 7K
  // skin, which still renders the chart but with the "wrong" lane
  // layout for DP charts (no 2P-side rects).
  const playSkin = pickPlaySkin(song);
  gameplayView = new PixiGameplayView({
    skin: playSkin,
    autoPlay: autoPlayInput.checked,
    // The compressor decision is captured at gameplay-mount time —
    // toggling the checkbox mid-play has no effect because the
    // master bus is wired up once during `prepareAudio`. Restart
    // (F5) picks up the latest checkbox state on the next mount.
    audioCompressor: compressorInput.checked,
    onExit: () => {
      void showSelect();
    },
    onRestart: () => {
      // Re-mount with the same song. The chart / audio / video
      // state is bound to the song so a clean dispose+create is
      // simpler than threading reset hooks through every loader.
      // The shared `PixiSceneHost` keeps the canvas + WebGL context
      // alive across the cycle, so this is now a much lighter
      // operation than it used to be (no app destroy / re-init).
      void playSong(song);
    },
  });
  status.textContent = `Playing: ${song.title}`;
  await gameplayView.mount(sceneHost, song, resolveSongSource(collection, song));
}
