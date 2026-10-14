/** @jsxImportSource hono/jsx */
import { HELP } from './help-content.tsx';
import { HELP_SECTIONS } from './help-topics.ts';
import { Layout, PageHeader } from './layout.tsx';
import { meta, PAGE_CACHE, pageLocale, pageMessages, type PageContext } from './page.tsx';

/** What the figures and marks on the pages mean: one place for the legend, the terms and the switches. */
export function helpPage(c: PageContext<'/leaderboard/help'>) {
  c.header('cache-control', PAGE_CACHE);
  const content = HELP[pageLocale(c)];
  return c.html(
    <Layout meta={meta(c, content.title, content.description, [{ label: content.title, kind: 'help' }])}>
      <PageHeader title={content.title} kind="help">
        {content.lead}
      </PageHeader>
      <nav aria-label={content.contents} class="flex flex-wrap gap-2">
        {HELP_SECTIONS.map((section) => (
          <a class="btn" data-size="sm" data-variant="outline" href={`#${section.id}`}>
            {content.sections[section.id]}
          </a>
        ))}
      </nav>
      <div class="space-y-10">{content.body(pageMessages(c))}</div>
    </Layout>,
  );
}
