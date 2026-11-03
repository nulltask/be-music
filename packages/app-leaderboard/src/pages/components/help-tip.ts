import type { PageContent } from '../template.ts';
import { html, nothing } from '@be-music/service-web-theme/server';
import { CircleHelp } from 'lucide-static';
import { helpHref, type HelpId } from '../help-topics.ts';
import { Icon } from './icon.ts';
import { type Messages } from '../i18n/index.ts';

/** Ids for the tips on one response; unique enough as long as each page renders its tips once. */
let nextTipId = 0;

/**
 * A small "?" next to a switch or a term: hovering or focusing it shows a sentence on what it means, a click or a tap
 * pins it, and its link opens the Help page at the matching section. Same popover as a play's info card (`InfoButton`):
 * the Popover API opens it without script, and TOOLTIP_SCRIPT in layout.ts adds the hover and the placement.
 */
export function HelpTip(props: { topic: HelpId; label: string; children: PageContent }, messages: Messages) {
  const t = messages;
  const id = `help-${props.topic}-${(nextTipId = (nextTipId + 1) % 1_000_000)}`;
  const anchor = `--${id}`;
  return html`<button
      type="button"
      class="text-muted-foreground hover:text-foreground relative z-10 inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full align-middle"
      popovertarget=${id ?? nothing}
      data-tooltip-for=${id ?? nothing}
      aria-label=${t.help.whatItMeans(props.label) ?? nothing}
      style=${`anchor-name:${anchor}`}
    >
      ${Icon({ svg: CircleHelp, class: '[&>svg]:size-3.5' })}
    </button>
    <div
      id=${id ?? nothing}
      popover="auto"
      data-tooltip
      role="tooltip"
      class="bg-popover text-popover-foreground w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border p-3 text-xs leading-relaxed font-normal shadow-md"
      style=${`position-anchor:${anchor};inset:auto;margin:6px 0;position-area:block-end span-inline-end;position-try-fallbacks:flip-block,flip-inline`}
    >
      <p>${props.children}</p>
      <a class="text-foreground underline underline-offset-4" href=${helpHref(props.topic) ?? nothing}
        >${t.help.more}</a
      >
    </div>`;
}
