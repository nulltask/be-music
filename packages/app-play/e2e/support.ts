import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { test as base, type Page } from '@playwright/test';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import type { TestHookBar, TestHookState } from '../src/test-hook.ts';

/**
 * The page helpers the specs share: opening the demo with the test hook, dropping fixture folders the way a person
 * drops them (a synthetic `drop` of `File`s with `webkitRelativePath`, as `docs/course-checklist.md` describes), keys
 * with a `code`, the Debug Menu's controls, and waits on `window.__beMusicTest` state.
 */

/** Where the fixture files are served on the page's own origin (intercepted, never reaching the preview server). */
const FILE_ROUTE = '/__e2e/files/';

/** The `key` a `KeyboardEvent` carries for a `code` the specs send. */
const KEY_OF_CODE: Readonly<Record<string, string>> = {
  KeyR: 'r',
  KeyZ: 'z',
  KeyS: 's',
  KeyX: 'x',
  Space: ' ',
};

function fixturesDir(): string {
  const dir = process.env.E2E_FIXTURES;
  if (dir === undefined) throw new Error('E2E_FIXTURES is not set: run the specs through the Playwright config');
  return dir;
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, path)));
    else if (entry.isFile()) out.push(relative(root, path).split(sep).join('/'));
  }
  return out.sort();
}

/** The fields of a state worth printing when a wait times out. */
function describeState(state: TestHookState | undefined): string {
  if (state === undefined) return 'no state (the test hook is not installed)';
  const { results, ...rest } = state;
  return JSON.stringify({ ...rest, results: results.length, lastResult: results.at(-1) });
}

export class Demo {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Opens the demo with the test hook on the empty select screen. `storage` seeds `localStorage` (the settings the
   * demo remembers) before it starts; the built-in skin's effects are off unless a spec asks for them.
   */
  async open(storage: Readonly<Record<string, string>> = {}): Promise<TestHookState> {
    await this.page.route(`**${FILE_ROUTE}**`, async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(FILE_ROUTE.length));
      await route.fulfill({ body: await readFile(join(fixturesDir(), path)), contentType: 'application/octet-stream' });
    });
    await this.page.addInitScript(
      (entries) => {
        for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
      },
      { 'be-music-demo.skin-effects': 'off', ...storage },
    );
    await this.page.goto('/?e2e=1');
    return this.waitFor((state) => state.scene.kind === 'select', 'the select screen');
  }

  /** What the test hook reports now. */
  async state(): Promise<TestHookState> {
    return this.page.evaluate(() => {
      const hook = window.__beMusicTest;
      if (hook === undefined) throw new Error('window.__beMusicTest is missing');
      return hook.state();
    });
  }

  /** The replay the last finished play recorded. */
  async lastReplay(): Promise<BeMusicReplay | undefined> {
    return this.page.evaluate(() => window.__beMusicTest?.lastReplay());
  }

  /** Polls the test hook until `predicate` holds, and returns that state. */
  async waitFor(
    predicate: (state: TestHookState) => boolean,
    what: string,
    timeoutMs = 90_000,
  ): Promise<TestHookState> {
    const deadline = Date.now() + timeoutMs;
    let last: TestHookState | undefined;
    for (;;) {
      last = await this.page.evaluate(() => window.__beMusicTest?.state()).catch((): undefined => undefined);
      if (last !== undefined && predicate(last)) return last;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last state: ${describeState(last)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Drops the fixture folder `root` (a path under the fixtures dir) as a person drops it: every file, its path under
   * `prefix` (the dropped folder's name), filtered by `only`. Resolves once the demo has loaded it.
   */
  async drop(
    root: string,
    options: { prefix?: string; only?: (path: string) => boolean } = {},
  ): Promise<TestHookState> {
    const files = (await listFiles(join(fixturesDir(), root))).filter(options.only ?? (() => true));
    if (files.length === 0) throw new Error(`nothing to drop under ${root}`);
    const before = (await this.state()).loads;
    await this.page.evaluate(
      async ({ route, root, files, prefix }) => {
        const dropped = await Promise.all(
          files.map(async (path) => {
            const url = `${route}${[...root.split('/'), ...path.split('/')].map(encodeURIComponent).join('/')}`;
            const bytes = await (await fetch(url)).arrayBuffer();
            const relativePath = prefix.length > 0 ? `${prefix}/${path}` : path;
            const file = new File([bytes], relativePath.split('/').pop()!);
            Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
            return file;
          }),
        );
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files: dropped, types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { route: FILE_ROUTE, root, files, prefix: options.prefix ?? '' },
    );
    // Theme imports now wait for an explicit choice before loading assets.
    await this.page.waitForFunction(
      (before) => {
        const state = window.__beMusicTest?.state();
        return (
          (state !== undefined && state.loads > before && !state.loading) ||
          document.querySelector<HTMLDialogElement>('#skin-switch')?.open
        );
      },
      before,
      { timeout: 90_000 },
    );
    const confirmation = this.page.locator('#skin-switch[open]');
    if (await confirmation.count()) {
      const beatoraja = confirmation.locator('[data-skin-family="beatoraja"]');
      await ((await beatoraja.isVisible()) ? beatoraja : confirmation.locator('[data-skin-family="lr2"]')).click();
    }
    return this.waitFor((state) => state.loads > before && !state.loading, `the drop of ${root} to load`);
  }

  /** Drops a file made here (a replay, an exported course file) under `name`. */
  async dropText(name: string, text: string): Promise<TestHookState> {
    const before = (await this.state()).loads;
    await this.page.evaluate(
      ({ name, text }) => {
        const file = new File([text], name);
        Object.defineProperty(file, 'webkitRelativePath', { value: name });
        const event = new Event('drop', { cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { items: [], files: [file], types: ['Files'] } });
        window.dispatchEvent(event);
      },
      { name, text },
    );
    return this.waitFor((state) => state.loads > before && !state.loading, `the drop of ${name} to load`);
  }

  /** Presses and releases a key on the window, with its `code` (the lanes and the scenes read it). */
  async key(code: string): Promise<void> {
    await this.page.evaluate(
      ({ code, key }) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, cancelable: true }));
      },
      { code, key: KEY_OF_CODE[code] ?? code },
    );
  }

  /**
   * Sets a Debug Menu control: `folder` is the folder titles from the top (`['Play options']`), `name` the control's
   * label. Checkboxes take a boolean, sliders a number, drop-downs the option's label.
   */
  async setOption(folder: readonly string[], name: string, value: boolean | number | string): Promise<void> {
    await this.control(folder, name, { set: value });
  }

  /** A Debug Menu control's value: a checkbox's state, a slider's number, a drop-down's option label. */
  async readOption(folder: readonly string[], name: string): Promise<boolean | number | string> {
    return (await this.control(folder, name, {})).value;
  }

  /** Whether a Debug Menu control can be changed now. */
  async optionEnabled(folder: readonly string[], name: string): Promise<boolean> {
    return (await this.control(folder, name, {})).enabled;
  }

  /** Clicks a Debug Menu button. */
  async pressOption(folder: readonly string[], name: string): Promise<void> {
    await this.control(folder, name, { press: true });
  }

  /** Finds a Debug Menu control by its folder titles and label, optionally sets or presses it, and reads it back. */
  private async control(
    folder: readonly string[],
    name: string,
    action: { set?: boolean | number | string; press?: true },
  ): Promise<{ value: boolean | number | string; enabled: boolean }> {
    return this.page.evaluate(
      ({ folder, name, action }) => {
        let gui = document.querySelector<HTMLElement>('[data-pane="debug"]');
        if (gui === null) throw new Error('no Debug Menu');
        // Tab pages are transparent to the existing folder paths.
        const children = (content: Element | null): Element[] =>
          [...(content?.children ?? [])].flatMap((child) =>
            child.classList.contains('tp-tabv')
              ? [...child.querySelectorAll(':scope > .tp-tabv_c > .tp-tbpv > .tp-tbpv_c')].flatMap(children)
              : [child],
          );
        const revealTab = (element: Element): void => {
          const page = element.closest('.tp-tbpv');
          const tab = page?.parentElement?.closest('.tp-tabv');
          if (!page || !tab) return;
          const pages = [...tab.querySelectorAll(':scope > .tp-tabv_c > .tp-tbpv')];
          tab
            .querySelectorAll<HTMLButtonElement>(':scope > .tp-tabv_t > .tp-tbiv > button')
            [pages.indexOf(page)]?.click();
        };
        for (const title of folder) {
          const content: Element | null = gui.querySelector(':scope > .tp-rotv_c, :scope > .tp-fldv_c');
          gui =
            children(content)
              .filter(
                (candidate): candidate is HTMLElement =>
                  candidate instanceof HTMLElement && candidate.classList.contains('tp-fldv'),
              )
              .find(
                (candidate) => candidate.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent?.trim() === title,
              ) ?? null;
          if (gui === null) throw new Error(`no Debug Menu folder ${title}`);
          revealTab(gui);
        }
        const content = gui.querySelector(':scope > .tp-rotv_c, :scope > .tp-fldv_c');
        const controller = children(content).find((candidate) => {
          const label = candidate.querySelector('.tp-lblv_l')?.textContent?.trim();
          return (label || candidate.querySelector('button')?.textContent?.trim()) === name;
        });
        if (controller === undefined) throw new Error(`no Debug Menu control ${[...folder, name].join(' / ')}`);
        revealTab(controller);
        const select = controller.querySelector('select');
        const input = controller.querySelector('input');
        const button = controller.querySelector('button');
        const value = action.set;
        if (action.press === true) {
          if (button === null) throw new Error(`${name} is not a button`);
          button.click();
        } else if (value !== undefined && select !== null) {
          const index = [...select.options].findIndex((option) => option.textContent?.trim() === value);
          if (index < 0) throw new Error(`${name} has no option ${String(value)}`);
          select.selectedIndex = index;
          select.dispatchEvent(new Event('change'));
        } else if (value !== undefined && input?.type === 'checkbox') {
          input.checked = value === true;
          input.dispatchEvent(new Event('change'));
        } else if (value !== undefined && input !== null) {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur'));
        }
        const read =
          select !== null
            ? (select.options[select.selectedIndex]?.textContent?.trim() ?? '')
            : input?.type === 'checkbox'
              ? input.checked
              : input !== null
                ? Number(input.value)
                : '';
        return { value: read, enabled: !(select?.disabled || input?.disabled || button?.disabled) };
      },
      { folder: [...folder], name, action },
    );
  }

  /** Moves the select screen's cursor down the list (wrapping) until `match` holds for the bar under it. */
  async cursorTo(match: (bar: TestHookBar) => boolean, what: string): Promise<TestHookState> {
    let state = await this.waitFor((current) => current.scene.kind === 'select', 'the select screen');
    for (let step = 0; step < 64; step += 1) {
      const bar = state.cursor?.bar;
      if (bar !== undefined && match(bar)) return state;
      const before = JSON.stringify(state.cursor);
      await this.key('ArrowDown');
      state = await this.waitFor(
        (current) => current.scene.kind === 'select' && JSON.stringify(current.cursor) !== before,
        `the cursor to move towards ${what}`,
        10_000,
      );
    }
    throw new Error(`no bar ${what} on the select screen; cursor: ${JSON.stringify(state.cursor)}`);
  }

  /** Goes up to the root of the select screen, then into the folder `label`. */
  async openFolder(label: string): Promise<TestHookState> {
    let state = await this.waitFor((current) => current.scene.kind === 'select', 'the select screen');
    if (state.cursor?.folderPath.at(-1) === label) return state;
    for (let depth = state.cursor?.folderPath.length ?? 0; depth > 0; depth -= 1) {
      await this.key('Escape');
      state = await this.waitFor(
        (current) => current.scene.kind === 'select' && (current.cursor?.folderPath.length ?? 0) < depth,
        'the select screen to leave a folder',
        10_000,
      );
    }
    await this.cursorTo((bar) => bar.kind === 'folder' && bar.title === label, `the folder ${label}`);
    await this.key('Enter');
    return this.waitFor(
      (current) => current.scene.kind === 'select' && current.cursor?.folderPath.at(-1) === label,
      `the folder ${label} to open`,
    );
  }

  /** Opens `folder` and puts the cursor on the bar titled `title`. */
  async browseTo(folder: string, title: string): Promise<TestHookState> {
    await this.openFolder(folder);
    return this.cursorTo((bar) => bar.title === title, `"${title}" in ${folder}`);
  }

  /** The number of results shown so far, to wait for the next one. */
  async resultCount(): Promise<number> {
    return (await this.state()).results.length;
  }

  /** Waits for the result screen showing result number `index` (0-based, in order shown) and returns that state. */
  async waitForResult(index: number, timeoutMs = 120_000): Promise<TestHookState> {
    return this.waitFor(
      (state) => state.scene.kind === 'result' && state.results.length > index,
      `result #${index + 1}`,
      timeoutMs,
    );
  }

  /**
   * Presses `code` on the result screen until the demo leaves it (a result skin ignores keys for its input delay), and
   * returns the state once it has.
   */
  async leaveResult(code = 'Escape'): Promise<TestHookState> {
    const shown = (await this.state()).results.length;
    const left = (state: TestHookState) => state.scene.kind !== 'result' || state.results.length > shown;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await this.key(code);
      const state = await this.waitFor(left, 'the result screen to go', 1_000).catch((): undefined => undefined);
      if (state !== undefined) return state;
    }
    throw new Error(`the result screen stayed after ${code}`);
  }

  /** Clicks the middle of the game canvas. */
  async clickCanvas(): Promise<void> {
    const box = await this.page.locator('#stage canvas').boundingBox();
    if (box === null) throw new Error('no canvas');
    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  /**
   * Clicks a point of a skin drawn at `width` × `height`, scaled to fit the canvas and centred as the scenes draw it
   * (`resolveScaledViewport`).
   */
  async clickSkin(x: number, y: number, width: number, height: number): Promise<void> {
    const box = await this.page.locator('#stage canvas').boundingBox();
    if (box === null) throw new Error('no canvas');
    const scale = Math.min(box.width / width, box.height / height);
    const left = box.x + (box.width - width * scale) / 2;
    const top = box.y + (box.height - height * scale) / 2;
    await this.page.mouse.click(left + x * scale, top + y * scale);
  }
}

/** Playwright's `test` with a `demo` fixture that has the demo open, the fixture library not yet dropped. */
export const test = base.extend<{ demo: Demo }>({
  demo: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
    page.on('console', (message) => {
      // A Leaderboard API that is not running answers the session check with 502; the browser logs that itself.
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        errors.push(`console: ${message.text()}`);
      }
    });
    const demo = new Demo(page);
    await use(demo);
    // Checklist item 11: nothing in the flow throws or logs an error.
    if (errors.length > 0) throw new Error(`errors in the page:\n${errors.join('\n')}`);
  },
});

export { expect } from '@playwright/test';

/** The checklist library's song folder and course folder, as the demo lists them after a drop of `songs`. */
export const SONGS = 'fixtures';
export const COURSES = 'fixture-courses';

/** Opens the demo and drops the checklist library (charts and course file) as the folder `fixtures`. */
export async function openWithLibrary(demo: Demo, storage: Readonly<Record<string, string>> = {}): Promise<void> {
  await demo.open(storage);
  await demo.drop('songs', { prefix: SONGS });
}
