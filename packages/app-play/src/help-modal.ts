import { html, nothing, render, type TemplateResult } from 'lit';
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
    render(html`<li class="ack-empty">${text}</li>`, list);
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
  render(acknowledgements.map(acknowledgementCard), list);
}

function acknowledgementCard(entry: Acknowledgement): TemplateResult {
  const link = entry.homepage ?? cleanRepositoryURL(entry.repository);
  const copy = playerText().shell;
  return html`<li class="ack-card">
    <div class="ack-card-heading">
      <span class="ack-card-name">${entry.name}</span>
      <span class="ack-card-version">v${entry.version}</span>
      ${entry.license ? html`<span class="ack-card-license">${entry.license}</span>` : nothing}
    </div>
    ${
      link || entry.author
        ? html`<div class="ack-card-meta">
            ${link ? html`<a class="ack-card-link" href=${link} target="_blank" rel="noopener noreferrer">${link.replace(/^https?:\/\//u, '')}</a>` : nothing}
            ${entry.author ? html`<span class="ack-card-author">${entry.author}</span>` : nothing}
          </div>`
        : nothing
    }
    ${
      entry.licenseText
        ? html`<details class="ack-card-license-details">
            <summary>${copy.ackLicense}</summary>
            <pre class="ack-card-license-text">${entry.licenseText}</pre>
          </details>`
        : html`<div class="ack-card-license-missing">${copy.ackNoLicense}</div>`
    }
  </li>`;
}

function cleanRepositoryURL(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/^git\+/u, '')
    .replace(/^git:\/\//u, 'https://')
    .replace(/\.git$/u, '');
}
