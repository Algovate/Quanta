// Unhandled error shutdown smoke test (opt-in)
// Run with: RUN_SHUTDOWN_TESTS=1 tsx tests/shutdown.errors.unit.ts

import { spawn } from 'node:child_process';

const run = async () => {
  if (!process.env.RUN_SHUTDOWN_TESTS) {
    console.log('Skipping shutdown error test (set RUN_SHUTDOWN_TESTS=1 to run)');
    return;
  }

  const program = `
    import { UnifiedLogger } from '../src/logging/index.ts';
    import { setupGracefulShutdown } from '../src/cli/shared/shutdown-handler.ts';
    const logger = UnifiedLogger.getInstance();
    logger.initialize();
    setupGracefulShutdown({ logger, loggerContext: 'Test' });
    // Trigger unhandled rejection
    Promise.reject(new Error('boom'));
    // Keep alive briefly
    setTimeout(() => {}, 5000);
  `;

  const child = spawn('tsx', ['--eval', program], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const code: number = await new Promise(resolve => {
    child.on('exit', c => resolve(c ?? 0));
  });

  if (code !== 1) {
    throw new Error(`Expected exit code 1 on unhandled error, got ${code}`);
  }
  console.log('Unhandled error shutdown test passed');
};

void run();
