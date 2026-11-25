/**
 * The auxiliary dock (`#auxiliary-panels`): the one place panels added over the stage go, so that several of them read
 * as one row. See "Auxiliary panels" in `docs/player-web.md` for the rules this module enforces.
 *
 * - Each panel is registered here with its place in the row and the screens it belongs to; the dock orders the panels
 *   by that place, whatever order they were made in.
 * - The scene router tells the dock which screen is showing ({@link setAuxiliaryDockScreen}); a panel is shown only on
 *   its screens, so no route has to remember to take another route's panel down.
 * - Each panel is a tab in the row (`<be-music-collapsible-panel position="dock">`) whose content opens above the row,
 *   and one panel is open at a time: opening one closes the one open, so open panels never cover each other.
 * - The dock, not a panel, decides where the row sits on each screen and whether a skin reserves the strip below the
 *   stage for it.
 */

import type { CollapsiblePanelElement } from './collapsible-panel.ts';

/** The screens the scene router shows, plus the start screen before any of them. */
export type AuxiliaryDockScreen = 'start' | 'select' | 'decide' | 'play' | 'result';

/** The panels the dock holds. */
export type AuxiliaryPanelName = 'chart-diagnostics' | 'replay-slots' | 'course-maker' | 'skin-config';

interface AuxiliaryPanelRule {
  /** Its place in the row, from the start. */
  readonly order: number;
  /** The screens it may show on. */
  readonly screens: readonly AuxiliaryDockScreen[];
}

/**
 * Every panel's place and screens. Warnings about the chart come first, then the panel that acts on the play (replay
 * slots), then the player's own work in progress (the course being made), then settings (the skin's options).
 */
export const AUXILIARY_PANELS: Readonly<Record<AuxiliaryPanelName, AuxiliaryPanelRule>> = {
  'chart-diagnostics': { order: 1, screens: ['select', 'decide'] },
  'replay-slots': { order: 2, screens: ['select', 'result'] },
  'course-maker': { order: 3, screens: ['select'] },
  'skin-config': { order: 4, screens: ['select', 'decide', 'play'] },
};

/** Whether a panel may show on a screen. */
export function auxiliaryPanelShowsOn(name: AuxiliaryPanelName, screen: AuxiliaryDockScreen): boolean {
  return AUXILIARY_PANELS[name].screens.includes(screen);
}

/** The names of the panels in row order. */
export function auxiliaryPanelOrder(): AuxiliaryPanelName[] {
  return (Object.keys(AUXILIARY_PANELS) as AuxiliaryPanelName[]).sort(
    (a, b) => AUXILIARY_PANELS[a].order - AUXILIARY_PANELS[b].order,
  );
}

/** The page's dock; none outside a page (the routes' Node tests). */
function dock(root: ParentNode | undefined = globalThis.document): HTMLElement | null {
  return root?.querySelector<HTMLElement>('#auxiliary-panels') ?? null;
}

/**
 * The panel the dock opened last stays open; any other open panel closes. Pure, for the dock's observer: `opened` is the
 * panel that just opened, `open` every panel open now.
 */
export function auxiliaryPanelsToClose<T>(opened: T, open: readonly T[]): T[] {
  return open.filter((panel) => panel !== opened);
}

const COLLAPSIBLE = 'be-music-collapsible-panel';
const watchedDocks = new WeakSet<HTMLElement>();

/** Keeps one panel of `element` open at a time, whether the player or the panel's owner opened it. */
function watchOnePanelOpen(element: HTMLElement): void {
  if (watchedDocks.has(element) || typeof MutationObserver === 'undefined') return;
  watchedDocks.add(element);
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      if (target.localName !== COLLAPSIBLE || !target.hasAttribute('open')) continue;
      const open = [...element.querySelectorAll<CollapsiblePanelElement>(`${COLLAPSIBLE}[open]`)];
      for (const panel of auxiliaryPanelsToClose(target, open)) (panel as CollapsiblePanelElement).close();
    }
  }).observe(element, { subtree: true, attributes: true, attributeFilter: ['open'] });
}

/**
 * Puts `element` in the dock as the panel `name`: it takes the panel’s place in the row and shows only on its
 * screens. `element` is the panel's `<be-music-collapsible-panel>` or a card that renders one with
 * `position="dock"`. Falls back to `fallback` (and then `document.body`) when the page has no dock, as in unit tests.
 */
export function mountAuxiliaryPanel(element: HTMLElement, name: AuxiliaryPanelName, fallback?: HTMLElement): void {
  const rule = AUXILIARY_PANELS[name];
  element.dataset.auxiliaryPanel = name;
  element.dataset.auxiliaryScreens = rule.screens.join(' ');
  element.style.order = String(rule.order);
  if (element.localName === COLLAPSIBLE) (element as CollapsiblePanelElement).position = 'dock';
  const target = dock() ?? fallback ?? document.body;
  target.append(element);
  if (target.id === 'auxiliary-panels') watchOnePanelOpen(target);
}

/** Tells the dock which screen is showing; the panels that do not belong to it hide. */
export function setAuxiliaryDockScreen(screen: AuxiliaryDockScreen, root?: ParentNode): void {
  const element = dock(root);
  if (element) element.dataset.screen = screen;
}

/**
 * Lets the select skin reserve the strip below the stage for the dock (Synesthesia, whose own controls run along the
 * bottom of its stage). The reservation belongs to the screen, so opening or closing a panel never moves the stage.
 */
export function setAuxiliaryDockBelowStage(below: boolean, root?: ParentNode): void {
  dock(root)?.toggleAttribute('data-below-stage', below);
}
