#!/usr/bin/env node

import { CLIApplication } from './cli/app.js';

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Main entry point
try {
  const app = new CLIApplication();
  app.run();
} catch (error) {
  console.error('Failed to start application:', error);
  process.exit(1);
}
