export type ExecutionMode = 'single' | 'arena';
export type ExecutionEnv = 'simulate' | 'simulation' | 'paper' | 'live';

export interface ExecutionSession {
  id: string;
  running: boolean;
  mode: ExecutionMode;
  env: ExecutionEnv;
  startTime: number;
}
