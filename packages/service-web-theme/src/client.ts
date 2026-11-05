import { LitElement, css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

/** A client message with server-rendered fallback text, isolated from htmx's light-DOM morphs. */
export class BeMusicStatusElement extends LitElement {
  static override properties: PropertyDeclarations = { message: { attribute: false } };
  static override styles = css`
    :host {
      display: block;
    }
    :host([hidden]) {
      display: none;
    }
  `;
  declare message: string | undefined;

  protected override render(): TemplateResult {
    return this.message === undefined ? html`<slot></slot>` : html`<span part="message">${this.message}</span>`;
  }
}

/** Register on the client explicitly; importing the module has no registration side effect. */
export function defineServiceUI(registry: CustomElementRegistry = customElements): void {
  const existing = registry.get('be-music-status');
  if (existing === undefined) registry.define('be-music-status', BeMusicStatusElement);
  else if (existing !== BeMusicStatusElement) throw new Error('Conflicting be-music-status element');
}

export { serviceHeaderTemplate, serviceSkipLinkTemplate } from './header-template.ts';
export type { ServiceHeaderInput } from './header-model.ts';

export { buildInfoTemplate, publicBetaNoticeTemplate, serviceFooterTemplate } from './footer-template.ts';

export { authButtonTemplate, authPanelTemplate, type AuthButtonInput } from './auth-template.ts';
export { avatarTemplate, accountIdentityTemplate } from './account-identity-template.ts';
export type { ServiceAccountIdentity } from './account-model.ts';
export {
  popoverTemplate,
  languageMenuTemplate,
  languageLinksTemplate,
  type PopoverInput,
  type LanguageChoice,
} from './popover-template.ts';
