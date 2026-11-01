export { renderBuildInfo, type BuildInfo } from './build-info.ts';
export {
  renderServiceFooter,
  serviceOrigins,
  serviceSite,
  SERVICE_COPYRIGHT,
  SERVICE_FOOTER_CLASS,
  SERVICE_FOOTER_LINK_CLASS,
  SERVICE_FOOTER_NAV_CLASS,
  SERVICE_LABELS,
  SERVICE_NAMES,
  type ServiceFooterInput,
  type ServiceName,
} from './footer.ts';
export { renderServiceHeader, serviceSkipLink, type ServiceHeaderAccount } from './header.ts';
export { PUBLIC_BETA_DELETION, PUBLIC_BETA_LABEL, publicBetaNotice, renderPublicBetaNotice } from './public-beta.ts';
export {
  LOCALE_COOKIE,
  LOCALE_NAMES,
  LOCALES,
  isLocale,
  localeFromCookie,
  localeSetCookie,
  resolveLocale,
  withLocale,
  type Locale,
} from './locale.ts';
/** Compiled Tailwind CSS v4 and Basecoat. `prepare` regenerates it; see scripts/build-css.ts. */
export { SERVICE_CSS } from './styles.generated.ts';
