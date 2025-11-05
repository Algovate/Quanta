import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from './workflow-types.js';

/**
 * Run a list of workflow stages sequentially, passing along a shared IO object.
 * - Short-circuits on stage aborts.
 * - Shallow-merges each stage's ioDelta into the IO accumulator.
 */
export async function runStages(
  operationId: string,
  ctx: WorkflowContext,
  initialIO: CycleIO,
  stages: WorkflowStage[]
): Promise<{ io: CycleIO; lastResult?: StageResult; aborted?: boolean }> {
  let io = initialIO;
  let lastResult: StageResult | undefined;

  for (const stage of stages) {
    // Each stage is responsible for its own logging using ctx.unifiedLogger and ctx.loggerContext
    // We keep the runner minimal to avoid cross-cutting concerns here.
    lastResult = await stage.run(operationId, ctx, io);

    if (lastResult?.abort) {
      return { io, lastResult, aborted: true };
    }

    if (lastResult?.ioDelta) {
      io = { ...io, ...lastResult.ioDelta };
    }
  }

  return { io, lastResult, aborted: false };
}
