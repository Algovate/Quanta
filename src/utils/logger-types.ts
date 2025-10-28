/**
 * Type definitions for the logging system
 */

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

export type LogMetadata = Record<string, unknown>;

export interface LogConfig {
  level: LogLevel;
  fileOutput: boolean;
  logDir: string;
  maxFileSize: number;
  maxFiles: number;
  backgroundMode: boolean;
}

export interface BufferedLogEntry {
  level: LogLevel;
  message: string;
  metadata?: LogMetadata;
  error?: unknown;
  timestamp: string;
  context: string;
}
