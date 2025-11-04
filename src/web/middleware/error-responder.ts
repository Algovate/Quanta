/**
 * Error Responder Middleware - Unified error response handler
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../utils/logger.js';
import type { ApiErrorResponse } from '../types/dto.js';

const { logger, context: loggerContext } = createLogger('ErrorHandler');

/**
 * Map error to error code
 */
function getErrorCode(error: unknown): string {
  if (error instanceof ZodError) {
    return 'E_VALIDATION_ERROR';
  }
  if (error instanceof Error) {
    // Check for common error patterns
    if (error.message.includes('session')) {
      return 'E_SESSION_ACTIVE';
    }
    if (error.message.includes('API key') || error.message.includes('apiKey')) {
      return 'E_MISSING_API_KEY';
    }
    if (error.message.includes('config') || error.message.includes('configuration')) {
      return 'E_INVALID_CONFIG';
    }
    if (error.message.includes('not found')) {
      return 'E_NOT_FOUND';
    }
  }
  return 'E_INTERNAL_ERROR';
}

/**
 * Get HTTP status code from error
 */
function getStatusCode(error: unknown, code: string): number {
  if (error instanceof ZodError) {
    return 400;
  }
  if (code === 'E_NOT_FOUND') {
    return 404;
  }
  if (code === 'E_SESSION_ACTIVE' || code === 'E_MISSING_API_KEY' || code === 'E_INVALID_CONFIG') {
    return 400;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in (error as Record<string, unknown>) &&
    typeof (error as { statusCode?: number }).statusCode === 'number'
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return 500;
}

/**
 * Error responder middleware
 * Standardizes error responses across all routes
 */
export function errorResponder(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // If response already sent, delegate to default error handler
  if (res.headersSent) {
    return next(error);
  }

  const code = getErrorCode(error);
  const statusCode = getStatusCode(error, code);

  let message = 'An error occurred';
  let details: unknown = undefined;

  if (error instanceof ZodError) {
    message = 'Validation error';
    details = error.errors.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }));
  } else if (error instanceof Error) {
    message = error.message || message;
  } else if (typeof error === 'string') {
    message = error;
  }

  // Log error
  logger.error(
    `[${code}] ${message}`,
    error instanceof Error ? error : new Error(String(error)),
    loggerContext
  );

  // Send standardized error response
  const response: ApiErrorResponse = {
    code,
    message,
    details,
    timestamp: Date.now(),
  };

  res.status(statusCode).json(response);
}
