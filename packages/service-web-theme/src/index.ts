export type { BuildInfo } from './build-info.ts';
export {
  serviceOrigins,
  serviceSite,
  SERVICE_COPYRIGHT,
  SERVICE_FOOTER_CLASS,
  SERVICE_FOOTER_COLUMNS_CLASS,
  SERVICE_FOOTER_LINK_CLASS,
  SERVICE_FOOTER_NAV_CLASS,
  SERVICE_LABELS,
  SERVICE_NAMES,
  type ServiceFooterInput,
  type ServiceName,
} from './footer.ts';
export type { ServiceHeaderAccount, ServiceHeaderInput } from './header-model.ts';
export { PUBLIC_BETA_DELETION, PUBLIC_BETA_LABEL, publicBetaNotice } from './public-beta.ts';
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
export {
  resolveSkeleton,
  skeletonLabel,
  skeletonLength,
  type SkeletonInput,
  type SkeletonLength,
  type SkeletonShape,
} from './skeleton-model.ts';
