/** Pure helpers of the pages' client script (main.ts): messages for API errors and the icon's square crop. */

/** A message for an error the account API answered (`{ error, detail? }`), for the settings page. */
export function describeAccountError(error: string, detail?: string): string {
  switch (error) {
    case 'invalid-handle':
      return detail === 'reserved'
        ? 'That handle is reserved. Pick another.'
        : 'Handles are 3 to 15 letters, digits or _.';
    case 'invalid-display-name':
      if (detail === 'empty') return 'The name cannot be empty.';
      if (detail === 'length') return 'Names are at most 32 characters.';
      return 'Names cannot contain line breaks or control characters.';
    case 'handle-taken':
      return 'That handle is taken.';
    case 'avatar-too-large':
      return 'The image is too large.';
    case 'unsupported-image':
      return 'Use a PNG, JPEG or WebP image.';
    case 'sign-in-required':
      return 'Sign in first.';
    default:
      return `Something went wrong (${error}).`;
  }
}

/** The largest centred square of a `width` x `height` image: the part an icon keeps. */
export function centerSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}
