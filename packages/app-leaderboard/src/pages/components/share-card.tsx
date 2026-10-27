/** @jsxImportSource hono/jsx */
import { useMessages } from '../i18n/index.ts';
import { CARD_FONT } from '../icons.ts';
import { xIntentURL } from '../score-card-data.ts';

/**
 * The share section of a play's or a course run's page: the card, a post on X (a plain link, so it works without
 * script), the system share sheet and a copy-link button. For the page's own player, the client script draws the card
 * (client/score-card.ts, or client/course-card.ts for `kind="course"`) and uploads it when there is none yet.
 */
export function ShareCard(props: {
  data: object;
  text: string;
  kind?: 'score' | 'course';
  pageURL: string;
  image: string;
  upload?: string;
  hasCard: boolean;
}) {
  const t = useMessages().score;
  return (
    <section class="card gap-4" data-size="sm" data-share>
      <header>
        <h2>{t.share}</h2>
        <p>{props.upload !== undefined && !props.hasCard ? t.shareDrawing : t.shareShown}</p>
      </header>
      <div class="space-y-4 px-4">
        <img
          src={props.image}
          width={600}
          height={315}
          alt={props.text}
          class="w-full max-w-[600px] rounded-lg border"
          data-card-preview
        />
        <div class="flex flex-wrap gap-2">
          <a class="btn" href={xIntentURL(props.text, props.pageURL)} target="_blank" rel="noopener" data-share-x>
            {t.postOnX}
          </a>
          <button type="button" class="btn" data-variant="outline" data-share-native hidden>
            {t.shareNative}
          </button>
          <button type="button" class="btn" data-variant="outline" data-share-copy>
            {t.copyLink}
          </button>
        </div>
        <p class="text-muted-foreground text-sm" data-share-status role="status" hidden />
      </div>
      <script
        type="application/json"
        data-score-card
        data-card-kind={props.kind ?? 'score'}
        data-upload={props.upload}
        data-has-card={props.hasCard ? 'true' : 'false'}
        data-font-family={CARD_FONT.family}
        data-font-url={CARD_FONT.url}
        data-share-text={props.text}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(props.data).replace(/</g, '\\u003c') }}
      />
    </section>
  );
}
