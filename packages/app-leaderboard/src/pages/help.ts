import { html, nothing, renderHTML } from '@be-music/service-web-theme/server';
import { HELP } from './help-content.ts';
import { HELP_SECTIONS } from './help-topics.ts';
import { Layout, PageHeader } from './layout.ts';
import { meta, PAGE_CACHE, pageLocale, pageMessages, type PageContext } from './page.ts';

/** What the figures and marks on the pages mean: one place for the legend, the terms and the switches. */
export function helpPage(c: PageContext<'/help'>) {
  c.header('cache-control', PAGE_CACHE);
  const content = HELP[pageLocale(c)];
  return c.html(
    renderHTML(
      Layout({
        meta: meta(c, content.title, content.description, [{ label: content.title, kind: 'help' }]),
        children: html`${PageHeader({ title: content.title, kind: 'help', children: html`${content.lead}` })}
          <nav aria-label=${content.contents ?? nothing} class="flex flex-wrap gap-2">
            ${HELP_SECTIONS.map(
              (section) =>
                html`<a class="btn" data-size="sm" data-variant="outline" href=${`#${section.id}`}
                  >${content.sections[section.id]}</a
                >`,
            )}
          </nav>
          <div class="space-y-10">${content.body(pageMessages(c))}</div>`,
      }),
    ),
  );
}
