import type { Config } from '../../config/settings.js';
import type { ExecutionSession, ExecutionEnv, ExecutionMode } from '../types/execution-session.js';

/**
 * Get execution environment from config with safe fallback
 */
export function getExecutionEnv(config: Config): ExecutionEnv {
  const env = config.env;
  // Map 'simulate' from config to 'simulation' for ExecutionSession
  // or keep as 'simulate' if that's the expected type
  if (env === 'simulate') {
    return 'simulation'; // ExecutionSession uses 'simulation' not 'simulate'
  }
  return env as ExecutionEnv;
}

/**
 * Create an execution session object
 */
export function createExecutionSession(
  id: string,
  mode: ExecutionMode,
  env: ExecutionEnv,
  running: boolean = true
): ExecutionSession {
  return {
    id,
    running,
    mode,
    env,
    startTime: Date.now(),
  };
}
