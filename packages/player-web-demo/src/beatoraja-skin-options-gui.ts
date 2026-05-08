// Bottom-right lil-gui panel that lets the user pick `skin_config.option` / `skin_config.file` values
// for the active beatoraja skin.
//
// Why a separate panel: the existing top-right `gui` mixes player-wide concerns (compressor / record /
// browser selection / recording resolutions) with run-specific knobs. Skin options are a third axis —
// they're per-skin-entry and need to be rebuilt every time the user navigates between play / select /
// decide / result, since each scene's skin authors a different `property[]` schema. Putting them in a
// dedicated panel keeps the main GUI stable and makes the relationship to the on-screen skin obvious.
//
// Lifecycle:
//
//     const skinGui = new BeatorajaSkinOptionsGui(host);
//     // …user navigates into the select scene…
//     skinGui.setSkin({ header, config, onChange: (next) => updateSelectScene(next) });
//     // …user navigates into the gameplay scene…
//     skinGui.setSkin({ header: playSkin.header, config: playConfig, … });
//     // …user drops a new theme; old controls go stale…
//     skinGui.clear();
//
// `setSkin` tears down the previous GUI and rebuilds — lil-gui doesn't support partial rebuilds, and
// rebuilding is cheap (a few hundred μs even for a complex skin).

import GUI from 'lil-gui';
import { defaultOpForBeatorajaSkinProperty } from '@be-music/beatoraja-skin';
import type {
  BeatorajaSkinConfig,
  BeatorajaSkinFilepath,
  BeatorajaSkinHeader,
  BeatorajaSkinProperty,
} from '@be-music/beatoraja-skin';

export interface BeatorajaSkinOptionsGuiOptions {
  /**
   * Parent element the panel attaches to. The GUI is positioned `absolute` inside this element at
   * `bottom: 12px; right: 12px;` — the host typically passes the demo's `.shell` so the panel sits
   * over the canvas (and not, say, over the page header).
   */
  container: HTMLElement;
}

/**
 * One discovered skin entry the user can pick for the active scene. The demo emits these from the
 * theme bundle's `entries[]`, filtered to the scene's matching `header.type`.
 */
export interface SkinChoice {
  /** Path inside the theme bundle (the canonical id). Used for override storage and re-mount. */
  entryPath: string;
  /** Human-readable label — typically `header.name` + filename. */
  label: string;
}

export interface SetSkinOptions {
  /** Section title shown at the top of the panel. */
  title: string;
  /** Skin header carrying the `property[]` / `filepath[]` schema to expose. */
  header: Pick<BeatorajaSkinHeader, 'property' | 'filepath'>;
  /** Currently-applied skin config. Dropdowns initialize to these picks. */
  config: BeatorajaSkinConfig;
  /**
   * Per-`filepath[].name` pre-resolved candidates. The dropdown surfaces the file paths verbatim for
   * the user to pick; the demo passes whatever `expandBeatorajaWildcard` returned for the entry's
   * pattern. Empty / missing → only the default ("(auto)") is offered.
   */
  fileCandidates?: ReadonlyMap<string, ReadonlyArray<string>>;
  /**
   * Discovered skin entries the user can switch to for this scene. The currently-mounted skin
   * appears in the list (its `entryPath` matches `currentEntryPath`). The dropdown is hidden when
   * `availableSkins.length <= 1` — no point showing a one-item picker.
   */
  availableSkins?: ReadonlyArray<SkinChoice>;
  /** Currently-mounted entry path. The skin dropdown initializes to this value. */
  currentEntryPath?: string;
  /**
   * Fired when the user picks a different skin entry from the top dropdown. The receiver should
   * persist the override and re-mount the active scene against the new entry. After the new entry
   * mounts, `setSkin` will be called again (with the new entry's header / config) — this lifecycle
   * handles the cascade naturally.
   */
  onSkinChange?: (nextEntryPath: string) => void;
  /**
   * Fired whenever the user changes a property or file pick. The receiver is expected to write the new
   * config back to its per-entry cache and re-mount the active scene with the new values applied.
   */
  onChange: (next: BeatorajaSkinConfig) => void;
}

const AUTO_FILE_LABEL = '(auto)';

/**
 * Bottom-right panel managing skin-config picks for the currently-loaded beatoraja skin.
 */
export class BeatorajaSkinOptionsGui {
  private readonly container: HTMLElement;
  private gui: GUI | undefined;
  /**
   * Deep-cloned mutable copy of the active config. Lil-gui binds controllers to live object fields,
   * so we maintain a target object the controllers mutate; `onChange` callbacks fire with a fresh
   * copy so the consumer never accidentally shares structure with our internal mutator state.
   */
  private state: {
    offset: number;
    option: Record<string, number>;
    file: Record<string, string>;
    /** Currently-selected skin entry path (drives the top "Skin" dropdown). */
    entryPath: string;
  } = {
    offset: 0,
    option: {},
    file: {},
    entryPath: '',
  };

  constructor(options: BeatorajaSkinOptionsGuiOptions) {
    this.container = options.container;
  }

  /**
   * Build (or rebuild) the panel for `header`. Tears down the previous lil-gui instance and
   * constructs a fresh one bound to the new schema.
   */
  setSkin(options: SetSkinOptions): void {
    this.disposeGui();
    this.state = {
      offset: typeof options.config.offset === 'number' ? options.config.offset : 0,
      option: { ...options.config.option },
      file: { ...options.config.file },
      entryPath: options.currentEntryPath ?? '',
    };
    const properties: ReadonlyArray<BeatorajaSkinProperty> = options.header.property ?? [];
    const filepaths: ReadonlyArray<BeatorajaSkinFilepath> = options.header.filepath ?? [];
    const skinChoices = options.availableSkins ?? [];
    const showSkinPicker = skinChoices.length > 1 && options.onSkinChange !== undefined;
    if (properties.length === 0 && filepaths.length === 0 && !showSkinPicker) {
      // Nothing to configure — leave the panel empty so the user isn't confused by a useless box.
      return;
    }

    const gui = new GUI({
      title: options.title,
      container: this.container,
      width: 320,
    });
    this.gui = gui;
    this.applyDomStyles(gui.domElement);
    // Bottom-right skin-options panel starts COLLAPSED. The skin's authored options panel
    // (the in-scene popup activated by the skin's button_type 33 / 32 chrome) is the
    // primary surface for runtime tweaks; this lil-gui mirror is a power-user / debug
    // overlay that the user opens explicitly when they need it. Keeping it expanded by
    // default crowded the lower-right corner over the rest of the UI.
    gui.close();

    const emit = (): void => {
      // Fresh copy so downstream code never aliases our mutator state.
      options.onChange({
        offset: this.state.offset,
        option: { ...this.state.option },
        file: { ...this.state.file },
      });
    };

    if (showSkinPicker) {
      // Top-level "Skin" dropdown — lets the user pick which discovered skin entry the scene mounts
      // when several were detected for this scene type. lil-gui's dropdown takes a Record<label,
      // value>; we map each candidate's display label to its `entryPath`. Picking a different entry
      // fires `onSkinChange` which the demo treats as "re-mount the scene against this entry".
      // Property / file controls below stay attached to the CURRENT mount until the new mount
      // calls `setSkin` again; that's the moment the panel rebuilds with the new schema.
      const skinOptionMap: Record<string, string> = {};
      for (const choice of skinChoices) skinOptionMap[choice.label] = choice.entryPath;
      gui
        .add(this.state, 'entryPath', skinOptionMap)
        .name('Skin')
        .onChange((value: string) => {
          options.onSkinChange?.(value);
        });
    }

    if (properties.length > 0) {
      const propsFolder = gui.addFolder('Options').open();
      for (const property of properties) {
        if (property.item.length === 0) continue;
        // lil-gui's dropdown supports a `Record<label, value>` map for the option list. Build one
        // mapping each `item.name` → its `op` integer; the live state holds the picked op so
        // controller.updateDisplay() can resolve back to the matching label on redraw.
        const labelByOp = new Map<number, string>();
        const optionMap: Record<string, number> = {};
        for (const item of property.item) {
          optionMap[item.name] = item.op;
          labelByOp.set(item.op, item.name);
        }
        const initial = this.state.option[property.name];
        const fallbackOp = defaultOpForBeatorajaSkinProperty(property) ?? 0;
        const initialOp = typeof initial === 'number' && labelByOp.has(initial) ? initial : fallbackOp;
        // Seed the live state in case `config.option` was missing this property entirely (the skin's
        // first-pass evaluator does this with `buildDefaultSkinConfigOptions`, but a user-supplied
        // partial config might omit some).
        this.state.option[property.name] = initialOp;
        propsFolder.add(this.state.option, property.name, optionMap).name(property.name).onChange(emit);
      }
    }

    if (filepaths.length > 0) {
      const filesFolder = gui.addFolder('Files').close();
      for (const fp of filepaths) {
        const candidates = options.fileCandidates?.get(fp.name) ?? [];
        // Always offer the "auto" entry so the user can fall back to the wildcard's default match
        // even after picking a specific file.
        const optionMap: Record<string, string> = { [AUTO_FILE_LABEL]: '' };
        for (const candidate of candidates) optionMap[candidate] = candidate;
        if (this.state.file[fp.name] === undefined) this.state.file[fp.name] = '';
        filesFolder.add(this.state.file, fp.name, optionMap).name(fp.name).onChange(emit);
      }
    }

    // `Offset` slider — chart timing offset in ms. Beatoraja accepts negative / positive integers in
    // the ±200 ms range; tighter control isn't typically necessary.
    gui.add(this.state, 'offset', -200, 200, 1).name('Note offset (ms)').onChange(emit);
  }

  /**
   * Tear down the panel without disposing the holder. Used when the active scene changes to "no
   * skin" (e.g., empty drop) so the controls don't outlive the skin they describe.
   */
  clear(): void {
    this.disposeGui();
  }

  /** Tear down the holder. Idempotent. */
  dispose(): void {
    this.disposeGui();
  }

  private disposeGui(): void {
    if (this.gui !== undefined) {
      this.gui.destroy();
      this.gui = undefined;
    }
  }

  /**
   * Position lil-gui's root element at the bottom-right of the demo shell. We avoid lil-gui's
   * default fixed positioning (top-right) because that overlaps the existing main GUI; the
   * absolute-inside-shell positioning keeps both panels visible without modal interaction.
   */
  private applyDomStyles(root: HTMLElement): void {
    root.style.position = 'absolute';
    root.style.right = '12px';
    root.style.bottom = '12px';
    root.style.top = 'auto';
    root.style.left = 'auto';
    root.style.zIndex = '40';
    root.style.maxHeight = 'calc(100vh - 24px)';
    root.style.overflowY = 'auto';
  }
}
