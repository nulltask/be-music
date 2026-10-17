// Which `note.dst[]` block (lane geometry) a beatoraja play skin's note section uses for the live op set. Skins gate
// alternate layouts — lift, lane-width variants — on `if` ops that toggle mid-play, and the play bridge mutates one
// `activeOps` Set in place every frame, so the note layer keys its lane-rect cache on the block picked here rather than
// on the Set's identity.

import { isElementVisible, type BeatorajaNoteSection } from '@be-music/beatoraja-skin';

/**
 * Index of the `note.dst[]` block whose `if` ops `activeOps` satisfies — the first match in declaration order, the
 * block `pickBeatorajaNoteRects` returns — or `-1` when none does. The index moves exactly when a gating op flips which
 * block is live; ops the blocks don't reference leave it alone. Allocation-free, so it is safe to call every frame.
 */
export function resolveBeatorajaNoteDstBlockIndex(
  section: Pick<BeatorajaNoteSection, 'dst'>,
  activeOps: ReadonlySet<number>,
): number {
  const blocks = section.dst;
  for (let i = 0; i < blocks.length; i++) {
    if (isElementVisible(blocks[i]!.ifCodes, activeOps)) return i;
  }
  return -1;
}
