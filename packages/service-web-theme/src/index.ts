export { renderBuildInfo, type BuildInfo } from './build-info.ts';
export { renderServiceHeader, serviceSkipLink, type ServiceHeaderAccount } from './header.ts';
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
