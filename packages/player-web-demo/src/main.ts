import {
  BrowserSongLibrary,
  PixiGameplayView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  describeSongCollection,
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  summarizeLr2PlaySkins,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type Lr2PlayVariant,
  type Lr2PlaySkinMap,
  type Lr2Skin,
  type PixiGameplayResultData,
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
 * variants on a per-song basis (`pickLr2PlaySkin`) when the requested
 * one isn't bundled — many themes ship only `play_7.lr2skin`.
 */
const playSkins: Lr2PlaySkinMap = {};
let selectSkin: Lr2Skin | undefined;
/**
 * Result-screen LR2 skin, loaded once per theme drop. Mounted into
 * `PixiResultView` when the chart finishes; falls back to the
 * built-in summary panel when no result skin is present in the
 * theme bundle.
 */
let resultSkin: Lr2Skin | undefined;
let selectView: PixiSongSelectView | undefined;
let gameplayView: PixiGameplayView | undefined;
/** Active result scene, if any. Disposed on transition away. */
let resultView: PixiResultView | undefined;
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
  const { themeFiles, songFiles } = splitDroppedSongAndThemeFiles(files);
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
  const playSkinSummary = summarizeLr2PlaySkins(playSkins);
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
    parts.push(describeSongCollection(collection));
  }
  if (parts.length > 0) {
    status.textContent = parts.join('  •  ');
  }
  await showSelect();
}

async function loadSongs(files: File[]): Promise<void> {
  status.textContent = 'Loading songs...';
  collection = await library.loadFromFiles(files);
  status.textContent = describeSongCollection(collection);
}

async function loadTheme(files: File[]): Promise<void> {
  status.textContent = 'Loading LR2 theme...';
  const loadedTheme = await loadLr2ThemeSkinsFromFiles(files);
  for (const variant of Object.keys(playSkins) as Lr2PlayVariant[]) {
    delete playSkins[variant];
  }
  Object.assign(playSkins, loadedTheme.playSkins);
  selectSkin = loadedTheme.selectSkin;
  resultSkin = loadedTheme.resultSkin;
  const parts: string[] = [];
  const playSummary = summarizeLr2PlaySkins(playSkins, ' / ');
  if (playSummary) {
    parts.push(`Play: ${playSummary}`);
  }
  if (selectSkin) parts.push(`Select: ${selectSkin.name}`);
  if (resultSkin) parts.push(`Result: ${resultSkin.name}`);
  status.textContent = parts.length > 0 ? `Theme — ${parts.join(', ')}` : 'No LR2 skin found';
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
  // Tear down any active result scene too — both gameplay-end
  // transitions and ESC-from-result land here, and we don't want
  // an old result panel lingering on top of the select view's
  // canvas attachments.
  resultView?.dispose();
  resultView = undefined;
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
  // DP-14K / etc.). With no DP skin in the bundle, `pickLr2PlaySkin`
  // falls back to whatever is available — typically the SP 7K
  // skin, which still renders the chart but with the "wrong" lane
  // layout for DP charts (no 2P-side rects).
  const playSkin = pickLr2PlaySkin(playSkins, song);
  gameplayView = new PixiGameplayView({
    skin: playSkin,
    autoPlay: autoPlayInput.checked,
    // The compressor decision is captured at gameplay-mount time —
    // toggling the checkbox mid-play has no effect because the
    // master bus is wired up once during `prepareAudio`. Restart
    // (F5) picks up the latest checkbox state on the next mount.
    audioCompressor: compressorInput.checked,
    onExit: () => {
      // ESC from gameplay — skip the result screen and head
      // straight back to select, mirroring LR2's behaviour where
      // a mid-chart escape doesn't post a score.
      void showSelect();
    },
    onChartFinished: (result) => {
      // Natural end of the chart: show the result scene before
      // returning to select. The gameplay view detached itself
      // already (chartEnded latch); we just need to mount the
      // next scene with the captured snapshot.
      void showResult(result);
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

/**
 * Mounts the result scene with the gameplay view's score snapshot,
 * then defers the gameplay teardown until after the result is on
 * stage so the canvas doesn't blank-flash through the transition.
 *
 * The `Esc` key (and the result scene's "advance past timer 152"
 * input) both route into `showSelect` via the `onContinue` hook,
 * so this function is the only place the gameplay → result hand-
 * off lives.
 */
async function showResult(data: PixiGameplayResultData): Promise<void> {
  await ensureHostMounted();
  resultView?.dispose();
  resultView = new PixiResultView({
    skin: resultSkin,
    collection,
    onContinue: () => {
      // User dismissed the result — back to select. `showSelect`
      // tears down the result view as part of its teardown
      // routine, so we don't dispose it here.
      void showSelect();
    },
  });
  await resultView.mount(sceneHost, data);
  // Tear down gameplay AFTER the result scene is on stage. Doing
  // it before would briefly leave the canvas with no scene
  // attached, producing a single-frame BG flash between gameplay
  // and result on some GPUs.
  gameplayView?.dispose();
  gameplayView = undefined;
  status.textContent = `Result: ${data.song.title}`;
}
