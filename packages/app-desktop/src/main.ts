// The desktop app's main process (README.md): one window that shows the web player from its server, so the player
// behaves as it does in Chrome, with the server's cross-origin isolation, sign-in, settings sync and URL load proxy.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserWindow, Menu, app, dialog, screen, session, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import {
  DESKTOP_SCHEME,
  accountsLoginOrigin,
  answersPending,
  browserSignInURL,
  createPendingSignIn,
  findReturnURL,
  parseReturnURL,
  playerSignInURL,
  redeemURL,
} from './browser-sign-in.ts';
import type { PendingSignIn } from './browser-sign-in.ts';
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

/** The sign-in the app sent to the default browser, until the browser comes back. */
let pendingSignIn: PendingSignIn | undefined;

function startBrowserSignIn(issuerOrigin: string, returnTo: string): void {
  pendingSignIn = createPendingSignIn(issuerOrigin, returnTo, Date.now());
  openInBrowser(browserSignInURL(pendingSignIn));
}

function signInFailedMessage(): string {
  return app.getLocale().startsWith('ja')
    ? 'ログインを終えられませんでした。プレイヤーからもう一度ログインしてください。'
    : 'Signing in did not finish. Sign in again from the player.';
}

/** Redeems the code the browser sent back, then runs the player's sign-in again in the window. */
async function finishBrowserSignIn(url: string, window: BrowserWindow | undefined, playURL: URL): Promise<void> {
  const returned = parseReturnURL(url);
  const pending = pendingSignIn;
  // A URL no sign-in of this app is waiting for is ignored: it may come from another app or an old tab.
  if (returned === null || !answersPending(pending, returned.state, Date.now())) {
    return;
  }
  pendingSignIn = undefined;
  try {
    // The session's own cookie store keeps the Accounts session the response sets, as the window's requests do.
    const response = await session.defaultSession.fetch(redeemURL(pending), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: returned.code, verifier: pending.verifier }),
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`redeem answered ${response.status}`);
    }
  } catch (error) {
    console.error('cannot finish signing in:', error);
    dialog.showErrorBox(PRODUCT_NAME, signInFailedMessage());
    return;
  }
  if (window === undefined || window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
  void window.loadURL(playerSignInURL(playURL.origin, pending.returnTo));
}

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
  // Identity providers refuse embedded browsers, so the Accounts login opens in the default browser instead.
  const sendLoginToBrowser = (event: { preventDefault(): void }, url: string): boolean => {
    const issuerOrigin = accountsLoginOrigin(url);
    if (issuerOrigin === null) {
      return false;
    }
    event.preventDefault();
    startBrowserSignIn(issuerOrigin, contents.getURL());
    return true;
  };
  contents.on('will-navigate', (event) => {
    if (sendLoginToBrowser(event, event.url)) {
      return;
    }
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
    if (sendLoginToBrowser(event, event.url)) {
      return;
    }
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
  // The browser returns a sign-in through the app's URL scheme: on macOS as an event, elsewhere as a second launch.
  if (process.defaultApp && process.argv[1] !== undefined) {
    app.setAsDefaultProtocolClient(DESKTOP_SCHEME, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(DESKTOP_SCHEME);
  }
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void finishBrowserSignIn(url, window, playURL);
  });
  app.on('second-instance', (_event, argv) => {
    const returnURL = findReturnURL(argv);
    if (returnURL !== undefined) {
      void finishBrowserSignIn(returnURL, window, playURL);
      return;
    }
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
