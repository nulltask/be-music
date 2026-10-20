import { BEATORAJA_TEXT } from '../runtime-ids.ts';

/** What a skin's song texts read of a chart. */
export interface BeatorajaChartTextInput {
  readonly title?: string;
  readonly subtitle?: string;
  readonly genre?: string;
  readonly artist?: string;
  /** The sub-artist line: BMS `#SUBARTIST`, or bmson's `subartists` joined. */
  readonly subartist?: string;
  /** The folder the chart sits in. */
  readonly directory?: string;
}

/** What a skin's own texts read: the skin header's name and author. */
export interface BeatorajaSkinTextInput {
  readonly name?: string;
  readonly author?: string;
}

/** The non-empty parts joined with a space, as beatoraja's full title and full artist join them. */
export function joinBeatorajaText(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/**
 * A song text (`text[].ref`, `StringPropertyFactory`) of a chart, or `undefined` for another id: the title (10), the
 * subtitle (11), the full title (12, title and subtitle), the genre (13), the artist (14), the sub-artist (15), the full
 * artist (16, artist and sub-artist) and the folder (1000). Each reads empty without a chart or without the field.
 */
export function resolveBeatorajaChartText(
  id: number,
  chartEntry: BeatorajaChartTextInput | undefined,
): string | undefined {
  switch (id) {
    case BEATORAJA_TEXT.TITLE:
      return chartEntry?.title ?? '';
    case BEATORAJA_TEXT.SUBTITLE:
      return chartEntry?.subtitle ?? '';
    case BEATORAJA_TEXT.FULLTITLE:
      return joinBeatorajaText(chartEntry?.title, chartEntry?.subtitle);
    case BEATORAJA_TEXT.GENRE:
      return chartEntry?.genre ?? '';
    case BEATORAJA_TEXT.ARTIST:
      return chartEntry?.artist ?? '';
    case BEATORAJA_TEXT.SUBARTIST:
      return chartEntry?.subartist ?? '';
    case BEATORAJA_TEXT.FULLARTIST:
      return joinBeatorajaText(chartEntry?.artist, chartEntry?.subartist);
    case BEATORAJA_TEXT.DIRECTORY:
      return chartEntry?.directory ?? '';
    default:
      return undefined;
  }
}

/** The skin's name (50) or author (51) text, empty when its header has none; `undefined` for another id. */
export function resolveBeatorajaSkinText(id: number, skin: BeatorajaSkinTextInput | undefined): string | undefined {
  switch (id) {
    case BEATORAJA_TEXT.SKIN_NAME:
      return skin?.name ?? '';
    case BEATORAJA_TEXT.SKIN_AUTHOR:
      return skin?.author ?? '';
    default:
      return undefined;
  }
}
