/**
 * Log Commands Helpers - Utility functions for log command operations
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

export interface LogFileMetadata {
  name: string;
  path: string;
  size: number;
  mtime: Date;
  dateKey: string;
  lineCount?: number;
}

/**
 * Get log directory path
 */
export function getLogDirectory(): string {
  return process.env.LOG_DIR || path.join(process.cwd(), 'logs', 'text');
}

/**
 * Get log files with metadata
 */
export async function getLogFiles(): Promise<LogFileMetadata[]> {
  const logDir = getLogDirectory();
  if (!fs.existsSync(logDir)) {
    return [];
  }

  const files = await fs.promises.readdir(logDir);
  const filePrefix = 'text-logs-';
  const jsonlFiles = files.filter(f => f.startsWith(filePrefix) && f.endsWith('.jsonl'));

  const filesWithMetadata = await Promise.all(
    jsonlFiles.map(async fileName => {
      const filePath = path.join(logDir, fileName);
      const stat = await fs.promises.stat(filePath);
      // Extract date from filename (text-logs-YYYY-MM-DD.jsonl)
      const dateMatch = fileName.match(/text-logs-(\d{4}-\d{2}-\d{2})\.jsonl/);
      const dateKey = dateMatch ? dateMatch[1] : '';

      return {
        name: fileName,
        path: filePath,
        size: stat.size,
        mtime: stat.mtime,
        dateKey,
      };
    })
  );

  return filesWithMetadata;
}

/**
 * Count lines in a log file
 */
export async function countFileLines(filePath: string): Promise<number> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content.split('\n').filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Format file size to human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Prompt for confirmation
 */
export async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(`${message} (y/N): `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Calculate time range from days
 */
export function calculateTimeRange(days?: number): number | undefined {
  if (!days) return undefined;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * Parse date string to timestamp
 */
export function parseDate(dateString: string): number | null {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

/**
 * Parse date string and set to end of day
 */
export function parseDateEndOfDay(dateString: string): number | null {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return null;
  }
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/**
 * Filter logs by grep pattern
 */
export function filterLogsByGrep<T extends { message: string; context: string }>(
  logs: T[],
  grep?: string
): T[] {
  if (!grep) {
    return logs;
  }
  const pattern = new RegExp(grep, 'i');
  return logs.filter(log => pattern.test(log.message) || pattern.test(log.context));
}

/**
 * Parse and validate log level
 */
export function parseLogLevel(level?: string): 'info' | 'warn' | 'error' | 'debug' | undefined {
  if (!level) {
    return undefined;
  }
  const normalized = level.toLowerCase();
  if (['info', 'warn', 'error', 'debug'].includes(normalized)) {
    return normalized as 'info' | 'warn' | 'error' | 'debug';
  }
  return undefined;
}
