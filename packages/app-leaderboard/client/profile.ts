/** Pure helpers of the pages' client script (main.ts): messages for API errors and the icon's square crop. */
import { clientMessages, type ClientMessages } from './messages.ts';

/** A message for an error the account API answered (`{ error, detail? }`), for the settings and play pages. */
export function describeAccountError(
  error: string,
  detail?: string,
  messages: ClientMessages = clientMessages('en'),
): string {
  const m = messages.errors;
  switch (error) {
    case 'invalid-handle':
      return detail === 'reserved' ? m.handleReserved : m.handleFormat;
    case 'invalid-display-name':
      if (detail === 'empty') return m.nameEmpty;
      if (detail === 'length') return m.nameLength;
      return m.nameCharacters;
    case 'handle-taken':
      return m.handleTaken;
    case 'avatar-too-large':
      return m.avatarTooLarge;
    case 'unsupported-image':
      return m.unsupportedImage;
    case 'sign-in-required':
      return m.signInRequired;
    case 'not-your-score':
      return m.notYourScore;
    case 'not-found':
      return m.notFound;
    default:
      return m.unknown(error);
  }
}

/** The largest centred square of a `width` x `height` image: the part an icon keeps. */
export function centerSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}
