/** @jsxImportSource hono/jsx */
import { ABOUT } from './about-content.tsx';
import { Layout, PageHeader } from './layout.tsx';
import { meta, PAGE_CACHE, pageLocale, type PageContext } from './page.tsx';

/** What the Leaderboard is and how it counts a play: scoring, charts, accounts, checks, and its beta state. */
export function aboutPage(c: PageContext<'/leaderboard/about'>) {
  c.header('cache-control', PAGE_CACHE);
  const content = ABOUT[pageLocale(c)];
  return c.html(
    <Layout meta={meta(c, content.title, content.description, [{ label: content.title, kind: 'about' }])}>
      <PageHeader title={content.title} kind="about">
        {content.lead}
      </PageHeader>
      <section aria-labelledby="different" class="space-y-3">
        <h2 id="different" class="text-base font-semibold tracking-tight">
          {content.apart}
        </h2>
        <ul class="grid gap-3 sm:grid-cols-3">
          {content.highlights.map((item) => (
            <li class="card flex flex-col gap-2 px-4 py-4">
              <h3 class="text-sm font-semibold">{item.title}</h3>
              <p class="text-muted-foreground text-sm leading-relaxed">{item.text}</p>
              <a class="text-foreground mt-auto pt-1 text-xs underline underline-offset-4" href={`#${item.more}`}>
                {content.moreBelow}
              </a>
            </li>
          ))}
        </ul>
        <ul class="text-muted-foreground grid gap-x-6 gap-y-1.5 pt-2 text-sm sm:grid-cols-2">
          {content.also.map((item) => (
            <li>
              <a class="text-foreground underline-offset-4 hover:underline" href={`#${item.more}`}>
                {item.title}
              </a>{' '}
              — {item.text}
            </li>
          ))}
        </ul>
      </section>
      <div class="space-y-8">{content.body()}</div>
    </Layout>,
  );
}
