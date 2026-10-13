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
 * An info icon that opens a small card with a play's details. It uses the browser's Popover API (`popovertarget`), so
 * it opens, closes on Escape or an outside click, and is announced as a dialog without any script.
 */
function InfoButton(props: { info: PlayInfo | undefined }) {
  if (props.info === undefined) return null;
  const id = `info-${props.info.scoreId}`;
  return (
    <>
      <button
        type="button"
        class="btn relative z-10"
        data-variant="ghost"
        data-size="icon-sm"
        popovertarget={id}
        aria-label="Play details"
        title="Play details"
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
        class="bg-popover text-popover-foreground m-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 text-sm shadow-md"
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
