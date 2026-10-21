import {
  judgeDisplayWord,
  resolveLaneRuns,
  type BeMusicGameplayFrame,
  type BeMusicSurface,
} from '@be-music/player-skin-sdk';

const COLORS = {
  white: '#e5efff',
  black: '#88b9ff',
  scratch: '#ffa8b3',
  'wheel-up': '#ffa8b3',
  'wheel-down': '#ffa8b3',
};

/** Only the timing-sensitive playfield is rasterized. The native HUD lives in a separate DOM mount. */
export function drawPlayfield(
  { context: ctx, width, height }: BeMusicSurface<'2d'>,
  frame: BeMusicGameplayFrame,
): void {
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, width, height);
  const bga = frame.layout.bga;
  if (bga && frame.runtime.hasBGA) ctx.clearRect(bga.x, bga.y, bga.w, bga.h);
  // Incoming notes may have overscan above the lanes; keep them out of the compact header.
  const runs = resolveLaneRuns(frame.lanes);
  ctx.save();
  ctx.beginPath();
  for (const run of runs) {
    ctx.rect(run.left, frame.layout.playfield.top, run.right - run.left, height - frame.layout.playfield.top);
  }
  ctx.clip();
  for (const lane of frame.lanes) {
    ctx.fillStyle = lane.kind === 'white' ? '#202d40' : '#152031';
    ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
    if (lane.beam > 0) {
      ctx.fillStyle = COLORS[lane.kind];
      ctx.globalAlpha = lane.beam * 0.3;
      ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
      ctx.globalAlpha = 1;
    }
    if (lane.holding) {
      ctx.fillStyle = '#abcaff';
      ctx.fillRect(lane.x, lane.bottom - 4, lane.w, 4);
    }
  }
  for (const note of frame.longNotes) {
    ctx.fillStyle = COLORS[note.kind];
    ctx.globalAlpha = note.state === 'dropped' ? 0.15 : 0.35;
    ctx.fillRect(note.x, note.top - 6, note.w, Math.max(1, note.bottom - note.top));
    ctx.globalAlpha = note.state === 'dropped' ? 0.5 : 1;
    ctx.fillRect(note.x, note.bottom - 6, note.w, 6);
    if (note.mode === 'ln') ctx.globalAlpha *= 0.4;
    ctx.fillRect(note.x, note.top - 6, note.w, 6);
    ctx.globalAlpha = 1;
  }
  for (const note of frame.notes) {
    ctx.fillStyle = COLORS[note.kind];
    ctx.fillRect(note.x, note.y - 6, note.w, 6);
  }
  ctx.fillStyle = '#ffa8b3';
  for (const run of runs) ctx.fillRect(run.left, frame.layout.playfield.judgementY, run.right - run.left, 2);
  for (const bomb of frame.bombs) {
    const age = Math.min(1, bomb.elapsedMs / 300);
    ctx.strokeStyle = '#e5efff';
    ctx.globalAlpha = 1 - age;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bomb.x + bomb.w / 2, bomb.y, 5 + age * 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.font = 'bold 20px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5efff';
  for (const side of frame.runtime.judgeSides ?? []) {
    if (!side.judge) continue;
    const bounds = frame.layout.playfield.sides[side.side];
    ctx.fillText(
      judgeDisplayWord(side.judge),
      bounds ? (bounds.left + bounds.right) / 2 : frame.layout.playfield.centerX,
      frame.layout.playfield.judgementY - 90,
    );
  }
  ctx.restore();
}
