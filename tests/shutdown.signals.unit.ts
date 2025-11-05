// Shutdown signal behavior smoke test (opt-in)
// Run with: RUN_SHUTDOWN_TESTS=1 tsx tests/shutdown.signals.unit.ts

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = async () => {
  if (!process.env.RUN_SHUTDOWN_TESTS) {
    console.log('Skipping shutdown signal test (set RUN_SHUTDOWN_TESTS=1 to run)');
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const entry = join(__dirname, '../src/index.ts');

  // Start the CLI in a mode that stays alive (log follow is enough)
  const child = spawn('tsx', [entry, 'log', 'view', '--follow'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>(resolve => setTimeout(resolve, 1000));
  child.kill('SIGINT');

  const code: number = await new Promise(resolve => {
    child.on('exit', c => resolve(c ?? 0));
  });

  if (code !== 0) {
    throw new Error(`Expected graceful exit code 0, got ${code}`);
  }
  console.log('Shutdown signal test passed');
};

void run();
