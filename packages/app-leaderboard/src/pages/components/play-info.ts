import type { PageContent } from '../template.ts';
import { html, nothing } from '@be-music/service-web-theme/server';
/** A play's details: the info icon and its popover, and the compact time of a play. */
import type { PlayInfo } from '../data.ts';
import { LocalTime } from './basics.ts';
import { formatPlayTime, formatRecorder, RULESET_LABELS } from '../format.ts';
import { messagesFor, type Messages } from '../i18n/index.ts';

/** The rows {@link playInfoRows} can give, in its order, so a page can take some of them where it wants them. */
export const PLAY_INFO_ROW_IDS = [
  'played',
  'playedUnder',
  'gauge',
  'lanes',
  'assists',
  'length',
  'verified',
  'app',
  'sentFrom',
  'scoredBy',
] as const;

export type PlayInfoRowId = (typeof PLAY_INFO_ROW_IDS)[number];

/** Just the rows `ids` of a play's info, for a page that lays the info out around rows of its own. */
export function pickPlayInfoRows(
  info: PlayInfo,
  t: Messages,
  ids: readonly PlayInfoRowId[],
): Array<[string, PageContent]> {
  return playInfoRows(
    info,
    t,
    PLAY_INFO_ROW_IDS.filter((id) => !ids.includes(id)),
  );
}

/**
 * Everything a play's info popover lists: how it was played, how far it was verified, and which software recorded,
 * sent and scored it. The app that recorded a play is usually the one that sent it; then it gets one row. The score
 * page lists the same, leaving out (`omit`) the rows it writes with help tips of its own.
 */
export function playInfoRows(
  info: PlayInfo,
  t: Messages = messagesFor('en'),
  omit: readonly PlayInfoRowId[] = [],
): Array<[string, PageContent]> {
  const p = t.playInfo;
  const recorded = (value: Record<string, string> | null) => {
    const text = formatRecorder(value);
    return text === 'unknown' ? p.unknown : text.replace(/^unknown app/, p.unknownApp);
  };
  const recorder = info.recordedBy;
  const sentByRecorder =
    recorder !== null &&
    info.submittedBy !== null &&
    recorder.name !== undefined &&
    info.submittedBy.startsWith(`${recorder.name}/${recorder.version ?? ''}`);
  const rows: Array<[PlayInfoRowId, string, PageContent | undefined]> = [
    ['played', p.played, LocalTime({ at: info.createdAt })],
    ['playedUnder', p.playedUnder, t.rules.name(RULESET_LABELS[info.playedRuleset] ?? info.playedRuleset)],
    ['gauge', p.gauge, info.gauge],
    ['lanes', p.lanes, info.laneOption !== null && info.laneOption !== '-' ? info.laneOption : undefined],
    ['assists', p.assists, info.assistFlags.length > 0 ? info.assistFlags.join(', ') : p.none],
    [
      'length',
      p.length,
      info.durationMs !== null && info.durationMs > 0 ? formatPlayTime(info.durationMs, t.duration) : undefined,
    ],
    ['verified', p.verified, p.verification[info.verification] ?? info.verification],
    ['app', sentByRecorder ? p.app : p.recordedWith, recorded(recorder)],
    ['sentFrom', p.sentFrom, sentByRecorder ? undefined : (info.submittedBy ?? p.unknown)],
    ['scoredBy', p.scoredBy, p.engine(info.serverEngine)],
  ];
  return rows
    .filter(([id, , value]) => value !== undefined && !omit.includes(id))
    .map(([, label, value]) => [label, value as PageContent]);
}

/**
 * An info icon with a tooltip card of a play's details, anchored below the icon (above it when there is no room).
 * Hovering or focusing the icon shows the card; a click or a tap pins it until Escape or a click elsewhere. The card is
 * a Popover API popover (`popovertarget`), so clicking works without script; TOOLTIP_SCRIPT in layout.ts adds the
 * hover and the placement for browsers without CSS anchor positioning.
 */
export function InfoButton(props: { info: PlayInfo | undefined }, messages: Messages) {
  const t = messages;
  if (props.info === undefined) return null;
  const id = `info-${props.info.scoreId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const anchor = `--${id}`;
  return html`<button
      type="button"
      class="btn relative z-10"
      data-variant="ghost"
      data-size="icon-sm"
      popovertarget=${id ?? nothing}
      data-tooltip-for=${id ?? nothing}
      aria-label=${t.playInfo.details ?? nothing}
      style=${`anchor-name:${anchor}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 16v-4"></path>
        <path d="M12 8h.01"></path>
      </svg>
    </button>
    <div
      id=${id ?? nothing}
      popover="auto"
      data-tooltip
      role="tooltip"
      class="bg-popover text-popover-foreground w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 text-sm shadow-md"
      style=${`position-anchor:${anchor};inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-block,flip-inline`}
    >
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 whitespace-normal">
        ${playInfoRows(props.info, t).map(
          ([label, value]) =>
            html`<dt class="text-muted-foreground">${label}</dt>
              <dd class="break-words">${value}</dd>`,
        )}
      </dl>
    </div>`;
}

/** When a play happened, compact (`2026-10-13 15:20`, in the viewer's time; UTC on hover). */
export function When(props: { at: number }) {
  return LocalTime({ at: props.at, precision: 'relative', compact: true });
}
