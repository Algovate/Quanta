#!/usr/bin/env node

import { CLIApplication } from './cli/app.js';
import { UnifiedLogger } from './logging/index.js';

// Main entry point
try {
  const app = new CLIApplication();
  app.run();
} catch (error) {
  // Try to use UnifiedLogger if available, otherwise fallback to console.error
  // This handles bootstrap errors before logger is fully initialized
  try {
    const logger = UnifiedLogger.getInstance();
    logger.initialize();
    logger.error(
      'Failed to start application',
      error instanceof Error ? error : new Error(String(error)),
      'Bootstrap'
    );
  } catch {
    // Fallback to console if logger initialization fails
    console.error('Failed to start application:', error);
  }
}
