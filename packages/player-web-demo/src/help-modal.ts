// Virtual module produced by the `be-music:acknowledgements` Vite plugin (see `vite.config.ts`).
import acknowledgements from 'virtual:acknowledgements';

export function wireHelpModal(): void {
  const button = document.querySelector<HTMLButtonElement>('#help-button');
  const modal = document.querySelector<HTMLDivElement>('#help-modal');
  const backdrop = document.querySelector<HTMLDivElement>('#help-modal-backdrop');
  const closeButton = document.querySelector<HTMLButtonElement>('#help-modal-close');
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-modal-tab'));
  const panes = Array.from(document.querySelectorAll<HTMLElement>('.help-modal-pane'));
  const ossList = document.querySelector<HTMLOListElement>('#help-oss-list');
  if (!button || !modal || !backdrop || !closeButton || tabs.length === 0 || panes.length === 0 || !ossList) {
    return;
  }

  let ossPopulated = false;
  const activatePane = (paneId: string): void => {
    for (const tab of tabs) {
      const matches = tab.dataset.pane === paneId;
      tab.classList.toggle('is-active', matches);
      tab.setAttribute('aria-selected', matches ? 'true' : 'false');
    }
    for (const pane of panes) {
      const matches = pane.id === `help-pane-${paneId}`;
      pane.classList.toggle('is-active', matches);
      pane.toggleAttribute('hidden', !matches);
    }
    if (paneId === 'oss' && !ossPopulated) {
      renderAcknowledgementsList(ossList);
      ossPopulated = true;
    }
  };

  const open = (): void => {
    activatePane('usage');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    closeButton.focus();
  };
  const close = (): void => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    button.focus();
  };

  button.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const pane = tab.dataset.pane;
      if (pane) activatePane(pane);
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!modal.classList.contains('visible')) return;
    event.preventDefault();
    close();
  });

  wireUsageLanguageSwitch();
}

function wireUsageLanguageSwitch(): void {
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-lang-toggle'));
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.help-lang'));
  if (toggles.length === 0 || blocks.length === 0) return;

  const activate = (lang: string): void => {
    for (const toggle of toggles) {
      const matches = toggle.dataset.lang === lang;
      toggle.classList.toggle('is-active', matches);
      toggle.setAttribute('aria-pressed', matches ? 'true' : 'false');
    }
    for (const block of blocks) {
      const matches = block.dataset.lang === lang;
      block.classList.toggle('is-active', matches);
      block.toggleAttribute('hidden', !matches);
    }
  };

  const initial = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  activate(initial);

  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const lang = toggle.dataset.lang;
      if (lang) activate(lang);
    });
  }
}

function renderAcknowledgementsList(list: HTMLOListElement): void {
  list.replaceChildren();
  if (acknowledgements.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'ack-empty';
    empty.textContent = 'No third-party dependencies were detected at build time.';
    list.appendChild(empty);
    return;
  }
  for (const entry of acknowledgements) {
    list.appendChild(buildAcknowledgementCard(entry));
  }
}

function buildAcknowledgementCard(entry: (typeof acknowledgements)[number]): HTMLLIElement {
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
  const link = entry.homepage ?? cleanRepositoryUrl(entry.repository);
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
    const pre = document.createElement('pre');
    pre.className = 'ack-card-license-text';
    pre.textContent = entry.licenseText;
    card.appendChild(pre);
  } else {
    const note = document.createElement('div');
    note.className = 'ack-card-license-missing';
    note.textContent = 'No LICENSE file shipped with this package.';
    card.appendChild(note);
  }

  return card;
}

function cleanRepositoryUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/^git\+/u, '')
    .replace(/^git:\/\//u, 'https://')
    .replace(/\.git$/u, '');
}
