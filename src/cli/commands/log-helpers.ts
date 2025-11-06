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

/**
 * Decision information extracted from logs
 */
export interface DecisionInfo {
  cycleId?: number;
  timestamp: number;
  symbol?: string;
  reasoning?: string;
  confidence?: number;
  action?: string;
  validation?: {
    passed: boolean;
    reason?: string;
  };
  sizing?: {
    passed: boolean;
    leverage?: number;
    size?: number;
    riskAmount?: number;
  };
  execution?: {
    orderId?: string;
    expectedPrice?: number;
    actualPrice?: number;
    slippage?: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Extract decision information from text logs
 */
export function extractDecisionInfo(
  logs: Array<{ message: string; metadata?: Record<string, any>; timestamp: number }>
): DecisionInfo[] {
  const decisions: DecisionInfo[] = [];

  for (const log of logs) {
    const decision: DecisionInfo = {
      timestamp: log.timestamp,
    };

    // Extract cycle ID
    if (log.metadata?.cycleId !== undefined) {
      decision.cycleId = log.metadata.cycleId;
    }

    // Extract symbol/coin from message or metadata
    const coinMatch = log.message.match(/\b([A-Z]{2,10})\/(?:USDT|USD)\b/i);
    if (coinMatch) {
      decision.symbol = coinMatch[1];
    } else if (log.metadata?.coin) {
      decision.symbol = log.metadata.coin;
    } else if (log.metadata?.symbol) {
      decision.symbol = log.metadata.symbol;
    }

    // Extract reasoning
    if (log.metadata?.reasoning) {
      decision.reasoning = log.metadata.reasoning;
    } else if (log.message.includes('Reasoning:')) {
      const reasoningMatch = log.message.match(/Reasoning:\s*(.+)/i);
      if (reasoningMatch) {
        decision.reasoning = reasoningMatch[1].trim();
      }
    }

    // Extract confidence
    if (log.metadata?.confidence !== undefined) {
      decision.confidence = log.metadata.confidence;
    } else {
      const confidenceMatch = log.message.match(/confidence[:\s]+([\d.]+)/i);
      if (confidenceMatch) {
        decision.confidence = parseFloat(confidenceMatch[1]);
      }
    }

    // Extract action (LONG/SHORT/HOLD/CLOSE)
    if (log.metadata?.action) {
      decision.action = log.metadata.action;
    } else {
      const actionMatch = log.message.match(/\b(LONG|SHORT|HOLD|CLOSE)\b/i);
      if (actionMatch) {
        decision.action = actionMatch[1].toUpperCase();
      }
    }

    // Extract validation info
    if (log.metadata?.validation) {
      decision.validation = {
        passed: log.metadata.validation.passed === true,
        reason: log.metadata.validation.reason,
      };
    } else if (log.message.includes('validation') || log.message.includes('Validation')) {
      const validationMatch = log.message.match(/validation[:\s]+(passed|failed)/i);
      if (validationMatch) {
        decision.validation = {
          passed: validationMatch[1].toLowerCase() === 'passed',
        };
      }
    }

    // Extract sizing info
    if (log.metadata?.sizing) {
      decision.sizing = {
        passed: log.metadata.sizing.passed === true,
        leverage: log.metadata.sizing.leverage,
        size: log.metadata.sizing.size || log.metadata.sizing.suggestedSize,
        riskAmount: log.metadata.sizing.riskAmount,
      };
    }

    // Extract execution info
    if (log.metadata?.execution) {
      decision.execution = {
        orderId: log.metadata.execution.orderId,
        expectedPrice: log.metadata.execution.expectedPrice,
        actualPrice: log.metadata.execution.actualPrice,
        slippage: log.metadata.execution.slippage,
      };
    } else if (log.message.includes('orderId') || log.message.includes('Order ID')) {
      const orderIdMatch = log.message.match(/orderId[:\s]+([\w-]+)/i);
      if (orderIdMatch) {
        decision.execution = {
          orderId: orderIdMatch[1],
        };
      }
    }

    // Store other metadata
    if (log.metadata && Object.keys(log.metadata).length > 0) {
      decision.metadata = log.metadata;
    }

    // Only add if we have meaningful decision data
    if (
      decision.symbol ||
      decision.reasoning ||
      decision.action ||
      decision.cycleId !== undefined
    ) {
      decisions.push(decision);
    }
  }

  return decisions;
}

/**
 * Parse decision path from structured data
 */
export function parseDecisionPath(data: any): {
  choices: Array<{
    step: string;
    decision: string;
    reason: string;
    confidence?: number;
    factors?: Record<string, any>;
  }>;
} | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  // If it's already a DecisionPath structure
  if (data.choices && Array.isArray(data.choices)) {
    return {
      choices: data.choices.map((choice: any) => ({
        step: choice.step || '',
        decision: choice.decision || '',
        reason: choice.reason || '',
        confidence: choice.confidence,
        factors: choice.factors,
      })),
    };
  }

  // Try to extract from factors structure
  if (data.factors) {
    const choices: Array<{
      step: string;
      decision: string;
      reason: string;
      confidence?: number;
      factors?: Record<string, any>;
    }> = [];

    if (data.factors.signals) {
      choices.push({
        step: 'signal_generation',
        decision: data.decision || 'Signals generated',
        reason: data.reason || 'AI analysis completed',
        factors: data.factors,
      });
    }

    if (choices.length > 0) {
      return { choices };
    }
  }

  return null;
}

/**
 * Group decisions by cycle ID
 */
export function groupDecisionsByCycle(decisions: DecisionInfo[]): Map<number, DecisionInfo[]> {
  const grouped = new Map<number, DecisionInfo[]>();

  for (const decision of decisions) {
    if (decision.cycleId !== undefined) {
      if (!grouped.has(decision.cycleId)) {
        grouped.set(decision.cycleId, []);
      }
      grouped.get(decision.cycleId)!.push(decision);
    }
  }

  return grouped;
}
