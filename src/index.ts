#!/usr/bin/env node

import { CLIApplication } from './cli/app.js';

// Main entry point
try {
  const app = new CLIApplication();
  app.run();
} catch (error) {
  console.error('Failed to start application:', error);
}
