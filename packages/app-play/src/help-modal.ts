// Virtual module produced by the `be-music:acknowledgements` Vite plugin (see `vite.config.ts`).
import loadAcknowledgements, { type Acknowledgement } from 'virtual:acknowledgements';
import { bindPlayerHeader } from './player-header.ts';
import { detectPlayerLang, playerText, setPlayerLang, type PlayerLang } from './player-copy.ts';
import { releaseFocusOnClose } from './ui/dialog-focus.ts';

export function wireHelpModal(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#help-modal');
  const closeButton = document.querySelector<HTMLButtonElement>('#help-modal-close');
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#help-modal [role="tab"]'));
  const panes = Array.from(document.querySelectorAll<HTMLElement>('#help-modal [role="tabpanel"]'));
  const ossList = document.querySelector<HTMLOListElement>('#help-oss-list');
  if (!dialog || !closeButton || tabs.length === 0 || panes.length === 0 || !ossList) {
    return;
  }

  let ossPopulated = false;
  // Basecoat's tabs: the selected tab and panel carry `aria-selected`, the others are hidden and out of the tab order.
  const activatePane = (paneId: string): void => {
    for (const tab of tabs) {
      const matches = tab.dataset.pane === paneId;
      tab.setAttribute('aria-selected', matches ? 'true' : 'false');
      tab.tabIndex = matches ? 0 : -1;
    }
    for (const pane of panes) {
      const matches = pane.id === `help-pane-${paneId}`;
      pane.setAttribute('aria-selected', matches ? 'true' : 'false');
      pane.toggleAttribute('hidden', !matches);
    }
    if (paneId === 'oss' && !ossPopulated) {
      ossPopulated = true;
      void renderAcknowledgementsList(ossList);
    }
  };

  // A native modal dialog, which Escape closes too.
  const open = (): void => {
    activatePane('usage');
    if (!dialog.open) dialog.showModal();
  };
  const close = (): void => dialog.close();
  // Closed, the keys go back to the play: left on the Help button, Enter (meant to start the chart) would reopen it.
  releaseFocusOnClose(dialog);

  bindPlayerHeader({ openHelp: open });
  closeButton.addEventListener('click', close);
  // A click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  // Keys stay in the dialog, so the play behind it does not take them.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      const pane = tab.dataset.pane;
      if (pane) activatePane(pane);
    });
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length]!;
      next.focus();
      next.click();
    });
  });

  wireUsageLanguageSwitch();
}

function wireUsageLanguageSwitch(): void {
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-lang-toggle'));
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.help-lang'));
  const initial = detectPlayerLang();
  if (toggles.length === 0 || blocks.length === 0) {
    setPlayerLang(initial);
    syncPublicBetaNotice(initial);
    return;
  }
  activate(initial);
  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const next = toggle.dataset.lang;
      if (next === 'ja' || next === 'en') activate(next);
    });
  }
}

/** Switches Help, the Public Beta line and the shell copy together. The header's language menu uses this too. */
export function applyPlayerLanguage(lang: PlayerLang): void {
  activate(lang);
}

function activate(lang: PlayerLang): void {
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-lang-toggle'));
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.help-lang'));
  for (const toggle of toggles) {
    const matches = toggle.dataset.lang === lang;
    toggle.dataset.variant = matches ? 'secondary' : 'outline';
    toggle.setAttribute('aria-pressed', matches ? 'true' : 'false');
  }
  for (const block of blocks) {
    const matches = block.dataset.lang === lang;
    block.classList.toggle('is-active', matches);
    block.toggleAttribute('hidden', !matches);
  }
  syncPublicBetaNotice(lang);
  setPlayerLang(lang);
}

function syncPublicBetaNotice(lang: PlayerLang): void {
  for (const notice of document.querySelectorAll<HTMLElement>('[data-public-beta-notice]')) {
    notice.toggleAttribute('hidden', notice.dataset.publicBetaNotice !== lang);
  }
}

async function renderAcknowledgementsList(list: HTMLOListElement): Promise<void> {
  const message = (text: string): void => {
    const item = document.createElement('li');
    item.className = 'ack-empty';
    item.textContent = text;
    list.replaceChildren(item);
  };
  message(playerText().shell.ackLoading);
  let acknowledgements: Acknowledgement[];
  try {
    acknowledgements = await loadAcknowledgements();
  } catch {
    message(playerText().shell.ackFailed);
    return;
  }
  if (acknowledgements.length === 0) {
    message(playerText().shell.ackEmpty);
    return;
  }
  list.replaceChildren(...acknowledgements.map(buildAcknowledgementCard));
}

function buildAcknowledgementCard(entry: Acknowledgement): HTMLLIElement {
  const card = document.createElement('li');
  card.className = 'ack-card';

  const heading = document.createElement('div');
  heading.className = 'ack-card-heading';
  const name = document.createElement('span');
  name.className = 'ack-card-name';
  name.textContent = entry.name;
  heading.appendChild(name);
  const version = document.createElement('span');
  version.className = 'ack-card-version';
  version.textContent = `v${entry.version}`;
  heading.appendChild(version);
  if (entry.license) {
    const license = document.createElement('span');
    license.className = 'ack-card-license';
    license.textContent = entry.license;
    heading.appendChild(license);
  }
  card.appendChild(heading);

  const meta = document.createElement('div');
  meta.className = 'ack-card-meta';
  const link = entry.homepage ?? cleanRepositoryURL(entry.repository);
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.textContent = link.replace(/^https?:\/\//u, '');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'ack-card-link';
    meta.appendChild(a);
  }
  if (entry.author) {
    const author = document.createElement('span');
    author.className = 'ack-card-author';
    author.textContent = entry.author;
    meta.appendChild(author);
  }
  if (meta.childNodes.length > 0) {
    card.appendChild(meta);
  }

  if (entry.licenseText) {
    // The copyright notice and license text stay folded until asked for: the list reads as names and licenses.
    const details = document.createElement('details');
    details.className = 'ack-card-license-details';
    const summary = document.createElement('summary');
    summary.textContent = playerText().shell.ackLicense;
    const pre = document.createElement('pre');
    pre.className = 'ack-card-license-text';
    pre.textContent = entry.licenseText;
    details.append(summary, pre);
    card.appendChild(details);
  } else {
    const note = document.createElement('div');
    note.className = 'ack-card-license-missing';
    note.textContent = playerText().shell.ackNoLicense;
    card.appendChild(note);
  }

  return card;
}

function cleanRepositoryURL(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/^git\+/u, '')
    .replace(/^git:\/\//u, 'https://')
    .replace(/\.git$/u, '');
}
