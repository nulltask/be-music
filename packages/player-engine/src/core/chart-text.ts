import { pickChartText, type ChartTextTimeline } from '@be-music/chart-model';
import { findLastIndexAtOrBefore } from '@be-music/shared-utils/core';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from './bga-timeline.ts';
import type { JudgeCoreEffect } from './judge-core-types.ts';

/** A source text program placed in one exclusive NONSTOP ownership window. */
export interface ChartTextStage {
  startSeconds: number;
  endSeconds: number;
  offsetSeconds: number;
  rate: number;
  timeline: ChartTextTimeline;
  /** Source-chart reversal time, before placement and FIT scaling. */
  freezeSeconds?: number;
}

export interface ChartTextInput {
  seconds: number;
  action: 'trigger' | 'clear';
}

/** The same effects drive live presentation and silent AUTO/replay seek reconstruction. */
export function resolveChartTextInput(effect: JudgeCoreEffect): ChartTextInput | undefined {
  return effect.kind === 'poor-bga' ? { seconds: effect.seconds, action: effect.action } : undefined;
}

/**
 * Be-Music's TEXT00 policy: miss text temporarily replaces channel-99 text for the shared miss-display interval.
 * A clear judgment ends it early. No host timer or wall clock participates; absent TEXT00 leaves normal text intact.
 */
export class ChartTextController {
  private inputs: ChartTextInput[] = [];
  private readonly stages?: { definition: ChartTextStage; controller: ChartTextController }[];
  private readonly timeline: ChartTextTimeline;
  private readonly freezeSeconds: number;
  constructor(timeline: ChartTextTimeline, freezeSeconds: number = Infinity, stages?: readonly ChartTextStage[]) {
    this.timeline = timeline;
    this.freezeSeconds = freezeSeconds;
    this.stages = stages?.map((definition) => ({
      definition,
      controller: new ChartTextController(definition.timeline, definition.freezeSeconds),
    }));
  }
  addInput(input: ChartTextInput): void {
    if (this.stages) {
      const stage = this.stageAt(input.seconds);
      if (stage) stage.controller.addInput({ ...input, seconds: this.sourceSeconds(stage.definition, input.seconds) });
      return;
    }
    if (this.timeline.missText === undefined || !Number.isFinite(input.seconds) || input.seconds > this.freezeSeconds)
      return;
    const index = findLastIndexAtOrBefore(this.inputs, input.seconds, (entry) => entry.seconds);
    this.inputs.splice(index + 1, 0, { ...input });
  }
  reset(inputs: readonly ChartTextInput[] = []): void {
    if (this.stages) {
      for (const stage of this.stages) {
        const { definition } = stage;
        stage.controller.reset(
          inputs
            .filter((input) => input.seconds >= definition.startSeconds && input.seconds < definition.endSeconds)
            .map((input) => ({ ...input, seconds: this.sourceSeconds(definition, input.seconds) })),
        );
      }
      return;
    }
    this.inputs = inputs
      .filter((input) => Number.isFinite(input.seconds) && input.seconds <= this.freezeSeconds)
      .map((input) => ({ ...input }))
      .sort((left, right) => left.seconds - right.seconds);
  }
  private sourceSeconds(stage: ChartTextStage, seconds: number): number {
    return (seconds - stage.offsetSeconds) * stage.rate;
  }
  private stageAt(seconds: number): { definition: ChartTextStage; controller: ChartTextController } | undefined {
    return this.stages?.find(({ definition }) => seconds >= definition.startSeconds && seconds < definition.endSeconds);
  }
  read(seconds: number): string {
    const at = Math.min(seconds, this.freezeSeconds);
    if (this.stages) {
      const stage = this.stageAt(at);
      return stage ? stage.controller.read(this.sourceSeconds(stage.definition, at)) : '';
    }
    const input = this.inputs[findLastIndexAtOrBefore(this.inputs, at, (entry) => entry.seconds)];
    if (
      this.timeline.missText !== undefined &&
      input?.action === 'trigger' &&
      at < input.seconds + DEFAULT_POOR_BGA_DISPLAY_SECONDS
    ) {
      return this.timeline.missText;
    }
    return pickChartText(this.timeline, at);
  }
}
