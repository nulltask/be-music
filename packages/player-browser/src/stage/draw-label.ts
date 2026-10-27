/** Debug labels are immutable strings, retained only for the lifetime of their drawing owner. */
type LabelValue = string | number;
type DrawLabelKind =
  | 'note'
  | 'note-fallback'
  | 'mine'
  | 'mine-fallback'
  | 'ln-body'
  | 'ln-body-fallback'
  | 'ln-end'
  | 'ln-start'
  | 'invisible-note'
  | 'invisible-note-fallback'
  | 'bomb'
  | 'measure-line'
  | 'image'
  | 'number'
  | 'judgeline'
  | 'text'
  | 'bargraph'
  | 'slider'
  | 'nowcombo';

const labels = new WeakMap<object, Map<DrawLabelKind, Map<LabelValue, Map<LabelValue | undefined, string>>>>();

/** Reuses the exact diagnostic label without sharing any mutable render state. No formatted cache key is needed. */
export function drawLabel(owner: object, kind: DrawLabelKind, first: LabelValue, second?: LabelValue): string {
  let kinds = labels.get(owner);
  if (!kinds) labels.set(owner, (kinds = new Map()));
  let values = kinds.get(kind);
  if (!values) kinds.set(kind, (values = new Map()));
  let pairs = values.get(first);
  if (!pairs) values.set(first, (pairs = new Map()));
  let label = pairs.get(second);
  if (label !== undefined) return label;
  switch (kind) {
    case 'invisible-note':
    case 'invisible-note-fallback':
    case 'bomb':
      label = `${kind}[ch=${first}]`;
      break;
    case 'measure-line':
      label = `measure-line[idx=${first},beat=${second}]`;
      break;
    case 'image':
      label = `image[${first}]`;
      break;
    case 'number':
      label = `number[num=${first},cell=${second}]`;
      break;
    case 'judgeline':
      label = `judgeline[idx=${first}]`;
      break;
    case 'text':
      label = `text[st=${first}]`;
      break;
    case 'bargraph':
    case 'slider':
      label = `${kind}[type=${first}]`;
      break;
    case 'nowcombo':
      label = `nowcombo[digit=${first}]`;
      break;
    default:
      label = `${kind}[lane=${first},ch=${second}]`;
  }
  pairs.set(second, label);
  return label;
}
