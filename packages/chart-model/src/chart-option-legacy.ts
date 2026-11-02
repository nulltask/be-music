/**
 * nanasigroove's legacy (1.260 and earlier) `774:HID-*` / `774:CRA-*` option IDs and the modern ID each stands for,
 * from hitkey's option catalog (https://hitkey.nekokan.dyndns.info/option.htm). Like the legacy HSP values, they are
 * accepted in initial `#OPTION` declarations only: `#CHANGEOPTION` / channel A6 disregards old IDs, so a timed one is
 * diagnosed `initial-only-alias`.
 *
 * Not listed, and so still diagnosed `unsupported-option`: `CRA-RHS1/2/3` (a playback-rate change, which Be-Music keeps
 * apart from display options), and `CRA-HYPER` / `CRA-CPDOUBLE` (they stand for `NOTES_DOUBLE` / `NOTES_COPY`, which
 * are unsupported). The catalog lists `CRA-2JUDGE` as `CRAZY_HELLJUDGE` like `CRA-ULTHARD`; Be-Music follows it.
 */
const LEGACY_OPTION_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    'HID-NORMAL': 'HIDDEN_OFF',
    'HID-HIDDEN1': 'HIDDEN_HIDDEN',
    'HID-HIDDEN2': 'HIDDEN_HIDDEN2',
    'HID-SUDDEN1': 'HIDDEN_SUDDEN',
    'HID-SUDDEN2': 'HIDDEN_SUDDEN2',
    'HID-HIDSUD1': 'HIDDEN_HID-SUD',
    'HID-HIDSUD2': 'HIDDEN_HID-SUD2',
    'HID-HIDSUD3': 'HIDDEN_HID-SUD3',
    'HID-BLINK1': 'HIDDEN_BLINK',
    'HID-BLINK2': 'HIDDEN_BLINK2',
    'HID-STEALTH': 'HIDDEN_STEALTH',
    'HID-HIDJUDGE': 'CRAZY_HIDJUDGE',
    'CRA-NORMAL': 'CRAZY_OFF',
    'CRA-STAR': 'CRAZY_STAR',
    'CRA-LINEMOVE': 'CRAZY_LINEMOVE',
    'CRA-HARD1': 'CRAZY_GOOD2BAD',
    'CRA-HARD2': 'CRAZY_GREAT2BAD',
    'CRA-ULTHARD': 'CRAZY_HELLJUDGE',
    'CRA-2JUDGE': 'CRAZY_HELLJUDGE',
    'CRA-XWAVE1': 'CRAZY_XWAVE',
    'CRA-XWAVE2': 'CRAZY_XWAVE2',
    'CRA-YWAVE1': 'CRAZY_YWAVE',
    'CRA-YWAVE2': 'CRAZY_YWAVE2',
    'CRA-XYWAVE1': 'CRAZY_XYWAVE',
    'CRA-XYWAVE2': 'CRAZY_XYWAVE2',
    'CRA-3DWAVE1': 'CRAZY_3DWAVE',
    'CRA-3DWAVE2': 'CRAZY_3DWAVE2',
    'CRA-DARK': 'CRAZY_DARK',
    'CRA-ACCEL': 'CHANGE-HS_ACCEL',
    'CRA-BRAKE': 'CHANGE-HS_BRAKE',
  }),
);

/**
 * The modern declaration an exact-case legacy `774:HID-*` / `774:CRA-*` declaration stands for, or `undefined` when
 * `declaration` is not one of the mapped legacy IDs.
 */
export function resolveChartLegacyOptionAlias(declaration: string): string | undefined {
  if (!declaration.startsWith('774:')) return undefined;
  const modern = LEGACY_OPTION_ALIASES.get(declaration.slice(4));
  return modern === undefined ? undefined : `774:${modern}`;
}
