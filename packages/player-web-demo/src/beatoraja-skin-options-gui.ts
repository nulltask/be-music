// Bottom-centre lil-gui panel that lets the user pick `skin_config.option` / `skin_config.file` values
// for the active beatoraja skin.
//
// Why a separate panel: the existing top-right `gui` mixes player-wide concerns (compressor / record /
// browser selection / recording resolutions) with run-specific knobs. Skin options are a third axis —
// they're per-skin-entry and need to be rebuilt every time the user navigates between play / select /
// decide / result, since each scene's skin authors a different `property[]` schema. Putting them in a
// dedicated panel keeps the main GUI stable and makes the relationship to the on-screen skin obvious.
//
// Skin selection itself lives in the Debug Menu, not here — this panel is purely the skin's authored
// `property[]` / `filepath[]` / `offset[]` schema mirror. Mixing the picker in created two competing
// UIs for the same action (Debug Menu's switcher + this panel's dropdown), which left the player
// guessing which one was canonical.
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
   * `bottom: 0; left: 50% (translateX -50%);` — the host typically passes the demo's `.shell` so
   * the panel sits over the canvas (and not, say, over the page header).
   */
  container: HTMLElement;
}

export interface SetSkinOptions {
  /** Section title shown at the top of the panel. */
  title: string;
  /** Skin header carrying the `property[]` / `filepath[]` / `category[]` schema to expose. */
  header: Pick<BeatorajaSkinHeader, 'property' | 'filepath' | 'category' | 'offset'>;
  /** Currently-applied skin config. Dropdowns initialize to these picks. */
  config: BeatorajaSkinConfig;
  /**
   * Per-`filepath[].name` pre-resolved candidates. The dropdown surfaces the file paths verbatim for
   * the user to pick; the demo passes whatever `expandBeatorajaWildcard` returned for the entry's
   * pattern. Empty / missing → only the default ("(auto)") is offered.
   */
  fileCandidates?: ReadonlyMap<string, ReadonlyArray<string>>;
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
    /**
     * Per-name custom-offset axes. Mirrors `BeatorajaSkinConfig.customOffset` —
     * `state.customOffset[<offsetName>][<axis>]` holds the user's authored delta for one of
     * the `header.offset[]` slots. lil-gui binds one controller per (name × axis) flagged in
     * the header schema; the controller mutates this nested record live, and `onChange`
     * forwards a deep-cloned snapshot to the host.
     */
    customOffset: Record<string, { x: number; y: number; w: number; h: number; r: number; a: number }>;
  } = {
    offset: 0,
    option: {},
    file: {},
    customOffset: {},
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
    // Hydrate customOffset state from the incoming config — every header.offset[] slot gets
    // a zero-filled record by default; existing host-persisted picks pre-populate matching
    // axes. The deep clone ensures the GUI's controllers don't mutate the host's stored
    // config in place.
    const customOffsetSeed: Record<string, { x: number; y: number; w: number; h: number; r: number; a: number }> = {};
    for (const slot of options.header.offset ?? []) {
      const prior = options.config.customOffset?.[slot.name];
      customOffsetSeed[slot.name] = {
        x: prior?.x ?? 0,
        y: prior?.y ?? 0,
        w: prior?.w ?? 0,
        h: prior?.h ?? 0,
        r: prior?.r ?? 0,
        a: prior?.a ?? 0,
      };
    }
    this.state = {
      offset: typeof options.config.offset === 'number' ? options.config.offset : 0,
      option: { ...options.config.option },
      file: { ...options.config.file },
      customOffset: customOffsetSeed,
    };
    const properties: ReadonlyArray<BeatorajaSkinProperty> = options.header.property ?? [];
    const filepaths: ReadonlyArray<BeatorajaSkinFilepath> = options.header.filepath ?? [];
    if (properties.length === 0 && filepaths.length === 0) {
      // Nothing to configure — leave the panel empty so the user isn't confused by a useless box.
      // Skin selection itself lives in the Debug Menu, so a skin without authored
      // property[] / filepath[] schema simply has no controls to surface here.
      return;
    }

    const gui = new GUI({
      title: options.title,
      container: this.container,
      width: 320,
    });
    this.gui = gui;
    this.applyDomStyles(gui.domElement);
    // Bottom-centre skin-options panel + every folder inside opens by default. Surveyed
    // community skins (GdbG / ModernChic / default) ship 2-4 categories with a handful of
    // controls each — small enough that the player can scan all options at a glance, and
    // expanded layout makes the relationship to the on-screen skin obvious without an
    // extra click. The previous "start collapsed" behavior was inherited from the prior
    // bottom-right placement (which competed with the play scene's HUD readouts in the
    // same corner); centring the panel removes that conflict.

    const emit = (): void => {
      // Fresh copy so downstream code never aliases our mutator state.
      // Deep-clone customOffset so the host never aliases nested slot records.
      const customOffsetCopy: Record<string, { x: number; y: number; w: number; h: number; r: number; a: number }> = {};
      for (const [name, axes] of Object.entries(this.state.customOffset)) {
        customOffsetCopy[name] = { ...axes };
      }
      options.onChange({
        offset: this.state.offset,
        option: { ...this.state.option },
        file: { ...this.state.file },
        customOffset: customOffsetCopy,
      });
    };

    // Build the category-id → display-label map up front. Header `category[]` (community-skin
    // only — GdbG_Skin and ModernChic populate it) declares groups like `{name: "メイン", item:
    // ["main_1", "main_2", …]}`. Each property's / filepath's `category` field is one of those
    // ids; the GUI inverts the relationship to render category-named folders. Skins that don't
    // author the table fall through to the legacy flat "Options" / "Files" folders, so existing
    // single-folder skins (the reference theme) keep working unchanged.
    const categoryGroups = options.header.category ?? [];
    const labelByCategoryId = new Map<string, string>();
    if (categoryGroups.length > 0) {
      for (const group of categoryGroups) {
        if (typeof group?.name !== 'string' || !Array.isArray(group.item)) continue;
        for (const id of group.item) {
          if (typeof id === 'string' && id.length > 0) labelByCategoryId.set(id, group.name);
        }
      }
    }
    /** Resolve a `category` field on a property / filepath to a folder label, or `undefined` to fall back to the legacy flat folder. */
    const resolveCategoryFolderName = (categoryId: string | undefined): string | undefined => {
      if (typeof categoryId !== 'string' || categoryId.length === 0) return undefined;
      return labelByCategoryId.get(categoryId);
    };

    if (properties.length > 0) {
      // Cache one folder per category label, lazily created on first member encounter so empty
      // categories don't render as empty folders. The flat fallback (`'Options'`) covers
      // properties without a category and is also lazy. Folders are opened on creation —
      // `lil-gui`'s `addFolder` defaults to "open" but we re-assert here to make the intent
      // explicit (and to override any future default change in the library).
      const folderByLabel = new Map<string, GUI>();
      const folderFor = (label: string): GUI => {
        let folder = folderByLabel.get(label);
        if (folder === undefined) {
          folder = gui.addFolder(label);
          folder.open();
          folderByLabel.set(label, folder);
        }
        return folder;
      };
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
        const categoryLabel = resolveCategoryFolderName(property.category) ?? 'Options';
        const folder = folderFor(categoryLabel);
        folder.add(this.state.option, property.name, optionMap).name(property.name).onChange(emit);
      }
    }

    if (filepaths.length > 0) {
      // Filepaths get their own folder root labeled by category (or 'Files' fallback). Folders
      // are opened on creation — keeping the panel uniform with the property folders above so
      // the user sees the full file-pick surface without an extra click.
      const folderByLabel = new Map<string, GUI>();
      const folderFor = (label: string): GUI => {
        let folder = folderByLabel.get(label);
        if (folder === undefined) {
          folder = gui.addFolder(label);
          folder.open();
          folderByLabel.set(label, folder);
        }
        return folder;
      };
      for (const fp of filepaths) {
        const candidates = options.fileCandidates?.get(fp.name) ?? [];
        // Always offer the "auto" entry so the user can fall back to the wildcard's default match
        // even after picking a specific file.
        const optionMap: Record<string, string> = { [AUTO_FILE_LABEL]: '' };
        for (const candidate of candidates) optionMap[candidate] = candidate;
        if (this.state.file[fp.name] === undefined) this.state.file[fp.name] = '';
        // Filepath folders prefix with `'Files: '` to disambiguate from property folders that
        // happen to share a category label (e.g. GdbG's `'プレイ'` covers both options and
        // files). Without the prefix the two would collide and lil-gui would error on duplicate
        // folder names within the same parent.
        const rawLabel = resolveCategoryFolderName(fp.category) ?? 'Files';
        const folderLabel = rawLabel === 'Files' ? 'Files' : `Files: ${rawLabel}`;
        folderFor(folderLabel).add(this.state.file, fp.name, optionMap).name(fp.name).onChange(emit);
      }
    }

    // `Offset` slider — chart timing offset in ms. Beatoraja accepts negative / positive integers in
    // the ±200 ms range; tighter control isn't typically necessary.
    gui.add(this.state, 'offset', -200, 200, 1).name('Note offset (ms)').onChange(emit);

    // Custom offset sliders — one folder per `header.offset[]` slot, with axis controllers
    // gated by the slot's per-axis flags. ModernChic's `header.offset` declares dozens of
    // slots like `{name: "main_brightness", a: true}` (alpha-only) or
    // `{name: "playarea_w", w: true, h: true}` (width/height). Beatoraja's reference engine
    // surfaces the same per-axis-flagged sliders in its options dialog; without them the
    // user has no way to drive `skin_config.offset[name].a` from outside the skin Lua.
    //
    // Range: x/y/w/h in ±400 px (covers most authoring); rotation in ±360°; alpha in
    // ±255 (additive delta range, matching the spec). Step 1 keeps the values integer.
    const customOffsets = options.header.offset ?? [];
    if (customOffsets.length > 0) {
      const offsetFolder = gui.addFolder('Custom offsets');
      offsetFolder.open();
      // Per-slot folder controllers tracked here so the reset action can `setValue` on
      // every authored axis at once (lil-gui doesn't propagate state-object mutations
      // back into its DOM displays — we have to walk the controller list and call
      // `setValue` per controller for the reset to land visually).
      const offsetControllers: Array<{ setValue: (v: number) => void }> = [];
      for (const slot of customOffsets) {
        const slotState = this.state.customOffset[slot.name];
        if (slotState === undefined) continue;
        // Per-slot subfolder when more than one axis is exposed; flat slot otherwise to
        // keep the panel compact for single-axis controls (the most common case).
        const flagged = (['x', 'y', 'w', 'h', 'r', 'a'] as const).filter((axis) => slot[axis]);
        if (flagged.length === 0) continue;
        const slotFolder = flagged.length > 1 ? offsetFolder.addFolder(slot.name) : offsetFolder;
        if (flagged.length > 1) (slotFolder as GUI).open();
        for (const axis of flagged) {
          const range = axis === 'r' ? [-360, 360] : axis === 'a' ? [-255, 255] : [-400, 400];
          const label = flagged.length > 1 ? axis : `${slot.name}.${axis}`;
          const controller = slotFolder.add(slotState, axis, range[0], range[1], 1).name(label).onChange(emit);
          offsetControllers.push(controller as unknown as { setValue: (v: number) => void });
        }
      }
      // "Reset to authored defaults" button — zeros every authored axis at once. Useful
      // when the user has dialed in many slots and wants to start over without tearing
      // down the panel. Single emit() at the end batches the change into one onChange
      // notification rather than firing once per controller setValue.
      if (offsetControllers.length > 0) {
        const resetActions = {
          reset: (): void => {
            for (const controller of offsetControllers) {
              controller.setValue(0);
            }
            emit();
          },
        };
        offsetFolder.add(resetActions, 'reset').name('Reset all to 0');
      }
    }
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
   * Position lil-gui's root element at the bottom-centre of the demo shell, flush against the
   * bottom edge (no gap). Avoids lil-gui's default fixed top-right positioning (which would
   * overlap the existing main GUI) and the previous bottom-right placement (which collided
   * with the on-screen skin's BPM / TIME / SPEED readouts in the play scene's lower-right
   * corner). Centring + edge-flush keeps the panel out of every authored skin's HUD zone
   * regardless of which scene is mounted.
   */
  private applyDomStyles(root: HTMLElement): void {
    root.style.position = 'absolute';
    root.style.left = '50%';
    root.style.bottom = '0';
    root.style.top = 'auto';
    root.style.right = 'auto';
    root.style.transform = 'translateX(-50%)';
    root.style.zIndex = '40';
    root.style.maxHeight = 'calc(100vh - 12px)';
    root.style.overflowY = 'auto';
  }
}
