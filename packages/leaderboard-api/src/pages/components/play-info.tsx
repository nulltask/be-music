/** @jsxImportSource hono/jsx */
/** A play's details: the info icon and its popover, and the compact time cell that carries it. */
import type { Child } from 'hono/jsx';
import type { PlayInfo } from '../data.ts';
import { formatRecorder, formatTimestamp, RULESET_LABELS } from '../format.ts';

/** Everything a play's info popover lists: how it was played and which software recorded and sent it. */
function playInfoRows(info: PlayInfo): Array<[string, Child]> {
  return [
    ['Played', formatTimestamp(info.createdAt)],
    ['Ruleset played', RULESET_LABELS[info.playedRuleset] ?? info.playedRuleset],
    ['Gauge', info.gauge],
    ['Assists', info.assistFlags.length > 0 ? info.assistFlags.join(', ') : 'none'],
    ['Verification', info.verification],
    ['Recorded with', formatRecorder(info.recordedBy)],
    ['Sent from', info.submittedBy ?? 'unknown'],
    ['Scored by', `be-music engine ${info.serverEngine}`],
  ];
}

/**
 * An info icon with a tooltip card of a play's details, anchored below the icon (above it when there is no room).
 * Hovering or focusing the icon shows the card; a click or a tap pins it until Escape or a click elsewhere. The card is
 * a Popover API popover (`popovertarget`), so clicking works without script; TOOLTIP_SCRIPT in layout.tsx adds the
 * hover and the placement for browsers without CSS anchor positioning.
 */
function InfoButton(props: { info: PlayInfo | undefined }) {
  if (props.info === undefined) return null;
  const id = `info-${props.info.scoreId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const anchor = `--${id}`;
  return (
    <>
      <button
        type="button"
        class="btn relative z-10"
        data-variant="ghost"
        data-size="icon-sm"
        popovertarget={id}
        data-tooltip-for={id}
        aria-label="Play details"
        style={`anchor-name:${anchor}`}
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
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      <div
        id={id}
        // Spelled out: a bare `popover` renders as `popover="true"`, which browsers treat as `manual` (no Escape, no
        // outside click). `auto` closes on both.
        popover="auto"
        data-tooltip
        role="tooltip"
        class="bg-popover text-popover-foreground w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 text-sm shadow-md"
        // Below the icon, right edges aligned, flipping above or to the other side when it would not fit.
        style={`position-anchor:${anchor};inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-block,flip-inline`}
      >
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 whitespace-normal">
          {playInfoRows(props.info).map(([label, value]) => (
            <>
              <dt class="text-muted-foreground">{label}</dt>
              <dd class="break-words">{value}</dd>
            </>
          ))}
        </dl>
      </div>
    </>
  );
}

/** When a play happened, compact (`2026-10-13 06:20`, UTC in full on hover), with its info icon. */
export function When(props: { at: number; info: PlayInfo | undefined }) {
  const full = formatTimestamp(props.at);
  return (
    <span class="text-muted-foreground inline-flex items-center gap-1">
      <time datetime={new Date(props.at).toISOString()} title={full}>
        {full.replace(' UTC', '')}
      </time>
      <InfoButton info={props.info} />
    </span>
  );
}
