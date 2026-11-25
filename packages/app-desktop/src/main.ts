// The desktop app's main process (README.md): one window that shows the web player from its server, so the player
// behaves as it does in Chrome, with the server's cross-origin isolation, sign-in, settings sync and URL load proxy.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, Menu, app, dialog, screen, session, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { allowsRedirect, isSameOrigin, navigationTarget } from './navigation.ts';
import { resolvePlayURL } from './play-url.ts';
import { chromeUserAgent } from './user-agent.ts';
import { DEFAULT_WINDOW_SIZE, MINIMUM_WINDOW_SIZE, parseWindowState, restorableBounds } from './window-state.ts';
import type { WindowState } from './window-state.ts';

const PRODUCT_NAME = 'Be-Music Play';
/** The player's background, shown before its first paint. */
const BACKGROUND_COLOR = '#101b31';
/** Chromium's code for a navigation another one replaced; not a failure. */
const ERROR_ABORTED = -3;

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState | null {
  try {
    return parseWindowState(readFileSync(windowStatePath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState(window: BrowserWindow): void {
  const state: WindowState = {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
    fullScreen: window.isFullScreen(),
  };
  try {
    writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch (error) {
    console.error('cannot save the window state:', error);
  }
}

function openInBrowser(url: string): void {
  shell.openExternal(url).catch((error: unknown) => console.error(`cannot open ${url}:`, error));
}

/** A page for a failed first load (offline before the player's service worker is installed). */
function loadFailurePage(playURL: URL, description: string): string {
  const escape = (text: string) => text.replace(/[&<>"]/gu, (character) => `&#${character.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:${BACKGROUND_COLOR};color:#dbe4f0;font:15px system-ui,sans-serif;text-align:center">
<div><p>${PRODUCT_NAME} could not load ${escape(playURL.host)}.<br>Check the connection and retry.</p>
<p style="opacity:.6">${escape(description)}</p>
<p><a href="${escape(playURL.href)}" style="color:#7fc4ff">Retry</a></p></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(playURL: URL): BrowserWindow {
  const state = loadWindowState();
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const bounds = restorableBounds(state?.bounds, workAreas);
  const window = new BrowserWindow({
    ...(bounds ?? DEFAULT_WINDOW_SIZE),
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    title: PRODUCT_NAME,
    backgroundColor: BACKGROUND_COLOR,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Keep audio scheduling and rendering at full rate while another window covers this one.
      backgroundThrottling: false,
    },
  });
  if (state?.maximized === true) {
    window.maximize();
  }
  if (state?.fullScreen === true) {
    window.setFullScreen(true);
  }
  window.once('ready-to-show', () => window.show());
  window.on('close', () => saveWindowState(window));

  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationTarget(url, playURL.origin) !== 'refuse') {
      openInBrowser(url);
    }
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event) => {
    const target = navigationTarget(event.url, playURL.origin);
    if (target === 'window') {
      return;
    }
    event.preventDefault();
    if (target === 'browser') {
      openInBrowser(event.url);
    }
  });
  contents.on('will-redirect', (event) => {
    if (!allowsRedirect(event.url)) {
      event.preventDefault();
    }
  });
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== ERROR_ABORTED && isSameOrigin(validatedURL, playURL.origin)) {
      void contents.loadURL(loadFailurePage(playURL, errorDescription));
    }
  });

  void window.loadURL(playURL.href);
  return window;
}

function main(): void {
  let playURL: URL;
  try {
    playURL = resolvePlayURL(process.argv, process.env);
  } catch (error) {
    dialog.showErrorBox(PRODUCT_NAME, error instanceof Error ? error.message : String(error));
    app.exit(1);
    return;
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let window: BrowserWindow | undefined;
  app.on('second-instance', () => {
    if (window === undefined) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });
  // One window is the whole app: closing it quits, on macOS too.
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    const defaultSession = session.defaultSession;
    defaultSession.setUserAgent(chromeUserAgent(defaultSession.getUserAgent()));
    // The player asks for folders (File System Access), MIDI, full screen and the like; other pages get nothing.
    defaultSession.setPermissionRequestHandler((_contents, _permission, callback, details) => {
      callback(isSameOrigin(details.requestingUrl, playURL.origin));
    });
    defaultSession.setPermissionCheckHandler((_contents, _permission, requestingOrigin) => {
      return isSameOrigin(requestingOrigin, playURL.origin);
    });
    Menu.setApplicationMenu(buildMenu());
    window = createWindow(playURL);
  });
}

app.setName(PRODUCT_NAME);
main();
