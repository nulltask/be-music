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
  private state: { offset: number; option: Record<string, number>; file: Record<string, string> } = {
    offset: 0,
    option: {},
    file: {},
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
      option: { ...(options.config.option ?? {}) },
      file: { ...(options.config.file ?? {}) },
    };
    const properties: ReadonlyArray<BeatorajaSkinProperty> = options.header.property ?? [];
    const filepaths: ReadonlyArray<BeatorajaSkinFilepath> = options.header.filepath ?? [];
    if (properties.length === 0 && filepaths.length === 0) {
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

    const emit = (): void => {
      // Fresh copy so downstream code never aliases our mutator state.
      options.onChange({
        offset: this.state.offset,
        option: { ...this.state.option },
        file: { ...this.state.file },
      });
    };

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
        const initialOp =
          typeof initial === 'number' && labelByOp.has(initial)
            ? initial
            : (property.item[0]?.op ?? 0);
        // Seed the live state in case `config.option` was missing this property entirely (the skin's
        // first-pass evaluator does this with `buildDefaultSkinConfigOptions`, but a user-supplied
        // partial config might omit some).
        this.state.option[property.name] = initialOp;
        propsFolder
          .add(this.state.option, property.name, optionMap)
          .name(property.name)
          .onChange(emit);
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
    gui
      .add(this.state, 'offset', -200, 200, 1)
      .name('Note offset (ms)')
      .onChange(emit);
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
