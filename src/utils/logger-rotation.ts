/**
 * Log file rotation and cleanup utilities
 */

import fs from 'fs';
import path from 'path';
import { LogConfig } from './logger-types.js';

export class LogRotation {
  constructor(private config: LogConfig) {}

  private getCurrentLogDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  checkAndRotateIfNeeded(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > this.config.maxFileSize) {
          this.rotateLogFile(filePath);
        }
      }
    } catch {
      // Ignore errors during size check
    }
  }

  private rotateLogFile(filePath: string): void {
    try {
      const basename = path.basename(filePath, '.log');
      const dateStamp = this.getCurrentLogDate();
      const rotatedPath = path.join(
        this.config.logDir,
        `${basename}.${dateStamp}.${Date.now()}.log`
      );
      fs.renameSync(filePath, rotatedPath);
    } catch (error: unknown) {
      console.error('Failed to rotate log file:', error);
    }
  }

  rotateLogs(): void {
    try {
      const files = fs.readdirSync(this.config.logDir);
      const logFiles = files.filter(f => f.endsWith('.log'));

      for (const file of logFiles) {
        const filePath = path.join(this.config.logDir, file);
        const stats = fs.statSync(filePath);

        if (stats.size > this.config.maxFileSize) {
          this.rotateLogFile(filePath);
        }
      }
    } catch (error: unknown) {
      console.error('Failed to rotate logs:', error);
    }
  }

  cleanupOldLogs(): void {
    try {
      const files = fs.readdirSync(this.config.logDir);
      const now = Date.now();
      const maxAge = this.config.maxFiles * 24 * 60 * 60 * 1000; // Convert days to ms

      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(this.config.logDir, file);
          const stats = fs.statSync(filePath);
          const fileAge = now - stats.mtimeMs;

          // Keep active log files
          if (fileAge > maxAge && file !== 'combined.log' && file !== 'error.log') {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
