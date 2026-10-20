/** A query flag: `1` and `true` turn it on; anything else, or no flag, leaves it off. */
export const isOn = (value: string | undefined): boolean => value === '1' || value === 'true';
