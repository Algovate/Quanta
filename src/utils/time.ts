/**
 * Time utility functions for consistent UTC time handling across the system.
 *
 * All timestamps are represented as UTC milliseconds since epoch.
 * This module provides utilities to parse date strings as UTC and format
 * timestamps consistently.
 */

/**
 * Parse a date string in YYYY-MM-DD format as UTC time at midnight.
 * This ensures consistent parsing regardless of the system's local timezone.
 *
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns UTC timestamp in milliseconds
 * @throws Error if the date string is invalid
 *
 * @example
 * parseUTCDateString('2024-01-01') // Returns timestamp for 2024-01-01T00:00:00Z
 */
export function parseUTCDateString(dateString: string): number {
  // Validate format (basic check for YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD`);
  }

  // Parse as UTC by appending 'T00:00:00Z'
  const date = new Date(dateString + 'T00:00:00Z');

  // Validate the date is valid
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateString}`);
  }

  return date.getTime();
}

/**
 * Format a UTC timestamp to ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ).
 * This is consistent UTC format suitable for logs and APIs.
 *
 * @param timestamp - UTC timestamp in milliseconds
 * @returns ISO 8601 formatted string in UTC
 *
 * @example
 * formatUTCTime(1704067200000) // Returns "2024-01-01T00:00:00.000Z"
 */
export function formatUTCTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format a UTC timestamp to a human-readable UTC string for logs.
 * Format: YYYY-MM-DD HH:mm:ss UTC
 *
 * @param timestamp - UTC timestamp in milliseconds
 * @returns Formatted string in UTC
 *
 * @example
 * formatUTCLogTime(1704067200000) // Returns "2024-01-01 00:00:00 UTC"
 */
export function formatUTCLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

/**
 * Format a UTC timestamp to a compact UTC time string (HH:mm:ss UTC).
 * Suitable for concise log entries.
 *
 * @param timestamp - UTC timestamp in milliseconds
 * @returns Formatted time string
 *
 * @example
 * formatUTCTimeCompact(1704067200000) // Returns "00:00:00 UTC"
 */
export function formatUTCTimeCompact(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds} UTC`;
}

/**
 * Format a UTC timestamp to local time string for user display.
 * This should be used when displaying time to users in UI.
 *
 * @param timestamp - UTC timestamp in milliseconds
 * @returns Formatted string in local timezone
 *
 * @example
 * formatLocalTime(1704067200000) // Returns local time string
 */
export function formatLocalTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format a UTC timestamp to local time string (time only).
 *
 * @param timestamp - UTC timestamp in milliseconds
 * @returns Formatted time string in local timezone
 */
export function formatLocalTimeOnly(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Get current UTC timestamp in milliseconds.
 * Alias for Date.now() for clarity.
 *
 * @returns Current UTC timestamp in milliseconds
 */
export function nowUTC(): number {
  return Date.now();
}
