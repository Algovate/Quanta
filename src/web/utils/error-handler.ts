/**
 * Unified error handling utilities for API routes
 */

import { Response } from 'express';
import { Logger } from '../../utils/logger.js';

const logger = Logger.getInstance('ErrorHandler');

export interface ApiError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: unknown;
}

/**
 * Sends an error response with proper status code and logging
 */
export function sendErrorResponse(
  res: Response,
  error: unknown,
  defaultMessage: string,
  statusCode: number = 500
): void {
  let message = defaultMessage;
  let code: string | undefined;
  let status = statusCode;

  if (error instanceof Error) {
    message = error.message || defaultMessage;
    // Check if error has a statusCode property (e.g., from HTTP errors)
    if (
      'statusCode' in error &&
      typeof (error as { statusCode?: number }).statusCode === 'number'
    ) {
      status = (error as { statusCode: number }).statusCode;
    }
  } else if (typeof error === 'string') {
    message = error;
  }

  logger.error(defaultMessage, error);
  res.status(status).json({
    error: message,
    code,
    timestamp: Date.now(),
  });
}

/**
 * Validates required fields in request body
 */
export function validateRequiredFields<T extends Record<string, unknown>>(
  body: unknown,
  fields: string[]
): body is T {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const bodyObj = body as Record<string, unknown>;
  return fields.every(field => field in bodyObj && bodyObj[field] != null);
}

/**
 * Validates required query parameters
 */
export function validateRequiredQuery(
  query: unknown,
  fields: string[]
): query is Record<string, string> {
  if (!query || typeof query !== 'object') {
    return false;
  }

  return fields.every(field => field in query && query[field as string] != null);
}

/**
 * Parses and validates a numeric query parameter with min/max bounds
 * @param value - The query parameter value
 * @param defaultVal - Default value if not provided or invalid
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns The parsed and validated number
 */
export function parseQueryLimit(
  value: unknown,
  defaultVal: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === null) {
    return defaultVal;
  }
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) {
    return defaultVal;
  }
  return Math.max(min, Math.min(max, parsed));
}
