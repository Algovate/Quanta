export const CycleEvents = {
  Start: 'cycle:start' as const,
  Signals: 'cycle:signals' as const,
  Execution: 'cycle:execution' as const,
  Complete: 'cycle:complete' as const,
  Error: 'cycle:error' as const,
};

export type CycleEvent = (typeof CycleEvents)[keyof typeof CycleEvents];
