// Bottom-centre Tweakpane panel that lets the user pick `skin_config.option` / `skin_config.file` values
// for the active beatoraja skin.
//
// Why a separate panel: the existing top-right `gui` mixes player-wide concerns (compressor / record /
// browser selection / recording resolutions) with run-specific knobs. Skin options are a third axis —
// they're per-skin-entry and need to be rebuilt every time the user navigates between play / select /
// decide / result, since each scene's skin authors a different `property[]` schema. Putting them in a
// dedicated panel keeps the main pane stable and makes the relationship to the on-screen skin obvious.
//
// Skin selection itself lives in the Debug Menu, not here — this panel is purely the skin's authored
// `property[]` / `filepath[]` / `offset[]` schema mirror. Mixing the picker in created two competing
// UIs for the same action (Debug Menu's switcher + this panel's dropdown), which left the player
// guessing which one was canonical.
//
// Lifecycle:
//
//     const skinGUI = new BeatorajaSkinOptionsGUI(host);
//     // …user navigates into the select scene…
//     skinGUI.setSkin({ header, config, onChange: (next) => updateSelectScene(next) });
//     // …user navigates into the gameplay scene…
//     skinGUI.setSkin({ header: playSkin.header, config: playConfig, … });
//     // …user drops a new theme; old controls go stale…
//     skinGUI.clear();
//
// A different skin entry rebuilds the schema; edits to the same entry preserve native tab and folder state.
import { Pane, type FolderApi } from 'tweakpane';
import { defaultOpForBeatorajaSkinProperty } from '@be-music/skin-beatoraja';
import type {
  BeatorajaSkinConfig,
  BeatorajaSkinFilepath,
  BeatorajaSkinHeader,
  BeatorajaSkinProperty,
} from '@be-music/skin-beatoraja';
export interface BeatorajaSkinOptionsGUIOptions {
  /**
   * Parent element the panel attaches to. The pane is positioned `absolute` inside this element at
   * `bottom: 0; left: 50% (translateX -50%);` — the host typically passes the player's `.shell` so
   * the panel sits over the canvas (and not, say, over the page header).
   */
  container: HTMLElement;
}
export interface SetSkinOptions {
  /**
   * Stable identity for the active skin entry. When a subsequent `setSkin` call carries the same
   * `entryPath` the pane is left intact (folder open/close state and scroll position survive); only
   * a different entry triggers a full rebuild against the new schema. Without this guard, every
   * config-change → `replaceSkin` → `refreshBeatorajaSkinOptionsGUI` round-trip would tear down
   * and recreate the Tweakpane instance, snapping the panel back to its initial collapsed state on
   * every controller tweak.
   */
  entryPath: string;
  /** Section title shown at the top of the panel. */
  title: string;
  /** Skin header carrying the `property[]` / `filepath[]` / `category[]` schema to expose. */
  header: Pick<BeatorajaSkinHeader, 'property' | 'filepath' | 'category' | 'offset'>;
  /** Currently-applied skin config. Dropdowns initialize to these picks. */
  config: BeatorajaSkinConfig;
  /**
   * Per-`filepath[].name` pre-resolved candidates. The dropdown surfaces the file paths verbatim for
   * the user to pick; the player passes whatever `expandBeatorajaWildcard` returned for the entry's
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
export class BeatorajaSkinOptionsGUI {
  private readonly container: HTMLElement;
  private gui: Pane | undefined;
  /**
   * Identity of the currently-rendered skin entry. Compared against the next `setSkin`'s
   * `entryPath` so re-applying the SAME entry's config (the common case after a controller
   * onChange triggers `replaceSkin` → `refreshBeatorajaSkinOptionsGUI`) doesn't tear down and
   * rebuild the Tweakpane instance. State is already mutated in place by the controllers — the
   * subsequent `setSkin` is purely informational and should NOT reset folder open/close state
   * or scroll position. Cleared on `clear()` / `dispose()`.
   */
  private activeEntryPath: string | undefined;
  /**
   * Deep-cloned mutable copy of the active config. Tweakpane binds controllers to live object fields,
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
     * the `header.offset[]` slots. Tweakpane binds one controller per (name × axis) flagged in
     * the header schema; the controller mutates this nested record live, and `onChange`
     * forwards a deep-cloned snapshot to the host.
     */
    customOffset: Record<
      string,
      {
        x: number;
        y: number;
        w: number;
        h: number;
        r: number;
        a: number;
      }
    >;
  } = {
    offset: 0,
    option: {},
    file: {},
    customOffset: {},
  };
  constructor(options: BeatorajaSkinOptionsGUIOptions) {
    this.container = options.container;
  }
  /**
   * Build (or rebuild) the panel for `header`. Tears down the previous Tweakpane instance and
   * constructs a fresh one bound to the new schema.
   *
   * Skipped entirely when `options.entryPath` matches {@link activeEntryPath} — the active pane
   * is already bound to the correct schema, the controllers' onChange handlers have already
   * mutated the state to match the new config, and rebuilding would only collapse the panel
   * back to its initial state. Mid-tweak `replaceSkin` round-trips (the common case) hit this
   * fast path and leave folder open/close state plus scroll position untouched.
   */
  setSkin(options: SetSkinOptions): void {
    if (this.activeEntryPath === options.entryPath && this.gui !== undefined) {
      // Same entry — the pane's controllers already reflect the new config (they fired the
      // onChange that produced it). No-op.
      return;
    }
    this.disposeGUI();
    this.activeEntryPath = options.entryPath;
    // Hydrate customOffset state from the incoming config — every header.offset[] slot gets
    // a zero-filled record by default; existing host-persisted picks pre-populate matching
    // axes. The deep clone ensures the pane's controllers don't mutate the host's stored
    // config in place.
    const customOffsetSeed: Record<
      string,
      {
        x: number;
        y: number;
        w: number;
        h: number;
        r: number;
        a: number;
      }
    > = {};
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
    if (properties.length === 0 && filepaths.length === 0 && !options.header.offset?.length) {
      // Nothing to configure — leave the panel empty so the user isn't confused by a useless box.
      // Skin selection itself lives in the Debug Menu, so a skin without authored
      // property[] / filepath[] schema simply has no controls to surface here.
      return;
    }
    const gui = new Pane({ title: options.title, container: this.container, expanded: false });
    this.gui = gui;
    gui.element.classList.add('skin-config-pane');
    gui.element.dataset.pane = 'skin-config';
    this.applyDOMStyles(gui.element);
    let refreshing = false;
    const emit = (): void => {
      if (refreshing) return;
      options.onChange({
        offset: this.state.offset,
        option: { ...this.state.option },
        file: { ...this.state.file },
        customOffset: Object.fromEntries(
          Object.entries(this.state.customOffset).map(([name, axes]) => [name, { ...axes }]),
        ),
      });
    };
    const pageNames = [
      ...(properties.length ? ['Options'] : []),
      ...(filepaths.length ? ['Files'] : []),
      'Timing & offsets',
    ];
    const tabs = gui.addTab({ pages: pageNames.map((title) => ({ title })) });
    const page = (name: string) => tabs.pages[pageNames.indexOf(name)]!;
    const labels = new Map<string, string>();
    for (const category of options.header.category ?? []) {
      for (const id of category.item ?? []) labels.set(id, category.name);
    }
    const propertyFolders = new Map<string, FolderApi>();
    for (const property of properties) {
      if (!property.item.length) continue;
      const label = labels.get(property.category ?? '') ?? 'Options';
      let folder = propertyFolders.get(label);
      if (!folder) {
        folder = page('Options').addFolder({ title: label, expanded: true });
        propertyFolders.set(label, folder);
      }
      const initial = this.state.option[property.name];
      if (!property.item.some((item) => item.op === initial)) {
        this.state.option[property.name] = defaultOpForBeatorajaSkinProperty(property) ?? 0;
      }
      folder
        .addBinding(this.state.option, property.name, {
          label: property.name,
          options: property.item.map((item) => ({ text: item.name, value: item.op })),
        })
        .on('change', emit);
    }
    const fileFolders = new Map<string, FolderApi>();
    for (const file of filepaths) {
      const label = labels.get(file.category ?? '') ?? 'Files';
      let folder = fileFolders.get(label);
      if (!folder) {
        folder = page('Files').addFolder({ title: label, expanded: true });
        fileFolders.set(label, folder);
      }
      this.state.file[file.name] ??= '';
      folder
        .addBinding(this.state.file, file.name, {
          label: file.name,
          options: [
            { text: AUTO_FILE_LABEL, value: '' },
            ...(options.fileCandidates?.get(file.name) ?? []).map((value) => ({ text: value, value })),
          ],
        })
        .on('change', emit);
    }
    const timing = page('Timing & offsets');
    timing
      .addBinding(this.state, 'offset', { label: 'Note offset (ms)', min: -200, max: 200, step: 1 })
      .on('change', emit);
    const customOffsets = options.header.offset ?? [];
    if (customOffsets.length) {
      const offsets = timing.addFolder({ title: 'Custom offsets', expanded: true });
      const syncPoints: (() => void)[] = [];
      for (const slot of customOffsets) {
        const axes = (['x', 'y', 'w', 'h', 'r', 'a'] as const).filter((axis) => slot[axis]);
        const state = this.state.customOffset[slot.name];
        if (!state || !axes.length) continue;
        const folder = axes.length > 1 ? offsets.addFolder({ title: slot.name, expanded: true }) : offsets;
        if (slot.x && slot.y) {
          const point = { position: { x: state.x, y: state.y } };
          syncPoints.push(() => {
            point.position.x = state.x;
            point.position.y = state.y;
          });
          folder
            .addBinding(point, 'position', {
              label: 'Position',
              view: 'point2d',
              picker: 'inline',
              expanded: true,
              x: { min: -400, max: 400, step: 1 },
              y: { min: -400, max: 400, step: 1, inverted: true },
            })
            .on('change', ({ value }) => {
              state.x = value.x;
              state.y = value.y;
              emit();
            });
        }
        for (const axis of axes) {
          if (slot.x && slot.y && (axis === 'x' || axis === 'y')) continue;
          const limit = axis === 'r' ? 360 : axis === 'a' ? 255 : 400;
          folder
            .addBinding(state, axis, {
              label: axes.length > 1 ? axis : `${slot.name}.${axis}`,
              min: -limit,
              max: limit,
              step: 1,
            })
            .on('change', emit);
        }
      }
      offsets.addButton({ title: 'Reset all to 0' }).on('click', () => {
        refreshing = true;
        try {
          for (const slot of customOffsets) {
            const state = this.state.customOffset[slot.name];
            if (!state) continue;
            for (const axis of ['x', 'y', 'w', 'h', 'r', 'a'] as const) if (slot[axis]) state[axis] = 0;
          }
          for (const sync of syncPoints) sync();
          gui.refresh();
        } finally {
          refreshing = false;
        }
        emit();
      });
    }
  }

  /**
   * Tear down the panel without disposing the holder. Used when the active scene changes to "no
   * skin" (e.g., empty drop) so the controls don't outlive the skin they describe.
   */
  clear(): void {
    this.disposeGUI();
  }
  /** Tear down the holder. Idempotent. */
  dispose(): void {
    this.disposeGUI();
  }
  private disposeGUI(): void {
    if (this.gui !== undefined) {
      this.gui.dispose();
      this.gui = undefined;
    }
    this.activeEntryPath = undefined;
  }
  /**
   * Position Tweakpane's root element at the bottom-centre of the player shell, flush against the
   * bottom edge (no gap). Avoids Tweakpane's default fixed top-right positioning (which would
   * overlap the existing main pane) and the previous bottom-right placement (which collided
   * with the on-screen skin's BPM / TIME / SPEED readouts in the play scene's lower-right
   * corner). Centring + edge-flush keeps the panel out of every authored skin's HUD zone
   * regardless of which scene is mounted.
   */
  private applyDOMStyles(root: HTMLElement): void {
    root.style.width = '320px';
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
