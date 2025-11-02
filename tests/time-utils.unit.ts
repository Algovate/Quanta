import { describe, it } from 'mocha';
import { assert } from 'node:assert';
import {
  parseUTCDateString,
  formatUTCTime,
  formatUTCLogTime,
  formatUTCTimeCompact,
  nowUTC,
} from '../src/utils/time.js';

describe('Time Utils - UTC Timezone Handling', () => {
  describe('parseUTCDateString', () => {
    it('should parse YYYY-MM-DD date string as UTC midnight', () => {
      const timestamp = parseUTCDateString('2024-01-01');
      const date = new Date(timestamp);

      // Verify it's UTC midnight
      assert.strictEqual(date.getUTCFullYear(), 2024);
      assert.strictEqual(date.getUTCMonth(), 0); // January is 0
      assert.strictEqual(date.getUTCDate(), 1);
      assert.strictEqual(date.getUTCHours(), 0);
      assert.strictEqual(date.getUTCMinutes(), 0);
      assert.strictEqual(date.getUTCSeconds(), 0);
      assert.strictEqual(date.getUTCMilliseconds(), 0);
    });

    it('should parse dates consistently regardless of system timezone', () => {
      // Parse the same date string
      const timestamp1 = parseUTCDateString('2024-06-15');
      const timestamp2 = parseUTCDateString('2024-06-15');

      // Should produce the same timestamp
      assert.strictEqual(timestamp1, timestamp2);

      // Should be UTC midnight
      const date = new Date(timestamp1);
      assert.strictEqual(date.getUTCHours(), 0);
      assert.strictEqual(date.getUTCMinutes(), 0);
    });

    it('should throw error for invalid date format', () => {
      assert.throws(() => parseUTCDateString('invalid'), /Invalid date format/);
      assert.throws(() => parseUTCDateString('2024/01/01'), /Invalid date format/);
      assert.throws(() => parseUTCDateString('01-01-2024'), /Invalid date format/);
    });

    it('should throw error for invalid date values', () => {
      assert.throws(() => parseUTCDateString('2024-13-01'), /Invalid date/);
      assert.throws(() => parseUTCDateString('2024-02-30'), /Invalid date/);
    });
  });

  describe('formatUTCTime', () => {
    it('should format timestamp as ISO 8601 UTC string', () => {
      const timestamp = parseUTCDateString('2024-01-01');
      const formatted = formatUTCTime(timestamp);

      // Should be ISO 8601 format ending with Z (UTC)
      assert.ok(formatted.endsWith('Z'));
      assert.ok(formatted.includes('2024-01-01T00:00:00'));
    });

    it('should format any valid timestamp consistently', () => {
      const timestamp = Date.UTC(2024, 5, 15, 14, 30, 45); // June 15, 2024 14:30:45 UTC
      const formatted = formatUTCTime(timestamp);

      assert.ok(formatted.includes('2024-06-15'));
      assert.ok(formatted.includes('14:30:45'));
      assert.ok(formatted.endsWith('Z'));
    });
  });

  describe('formatUTCLogTime', () => {
    it('should format timestamp as YYYY-MM-DD HH:mm:ss UTC', () => {
      const timestamp = parseUTCDateString('2024-01-01');
      const formatted = formatUTCLogTime(timestamp);

      assert.strictEqual(formatted, '2024-01-01 00:00:00 UTC');
    });

    it('should format with correct UTC time', () => {
      const timestamp = Date.UTC(2024, 5, 15, 14, 30, 45);
      const formatted = formatUTCLogTime(timestamp);

      assert.strictEqual(formatted, '2024-06-15 14:30:45 UTC');
    });
  });

  describe('formatUTCTimeCompact', () => {
    it('should format timestamp as HH:mm:ss UTC', () => {
      const timestamp = Date.UTC(2024, 0, 1, 14, 30, 45);
      const formatted = formatUTCTimeCompact(timestamp);

      assert.strictEqual(formatted, '14:30:45 UTC');
    });

    it('should pad single digits with zeros', () => {
      const timestamp = Date.UTC(2024, 0, 1, 5, 7, 9);
      const formatted = formatUTCTimeCompact(timestamp);

      assert.strictEqual(formatted, '05:07:09 UTC');
    });
  });

  describe('nowUTC', () => {
    it('should return current UTC timestamp', () => {
      const before = Date.now();
      const now = nowUTC();
      const after = Date.now();

      // Should be within reasonable time bounds
      assert.ok(now >= before);
      assert.ok(now <= after);
      assert.ok(typeof now === 'number');
    });

    it('should return milliseconds since epoch', () => {
      const now = nowUTC();
      const date = new Date(now);

      // Should be a valid date
      assert.ok(!isNaN(date.getTime()));
    });
  });

  describe('Timezone Consistency', () => {
    it('should ensure date parsing is timezone-independent', () => {
      // Parse a date that could be affected by timezone
      // January 1, 2024 in different timezones could produce different timestamps
      // if not parsed as UTC
      const timestamp = parseUTCDateString('2024-01-01');

      // Verify it's exactly UTC midnight
      const date = new Date(timestamp);
      const utcString = date.toISOString();

      // Should always be 2024-01-01T00:00:00.000Z
      assert.strictEqual(utcString, '2024-01-01T00:00:00.000Z');
    });

    it('should handle dates around daylight saving time transitions', () => {
      // March 10, 2024 (DST transition in some regions)
      const timestamp = parseUTCDateString('2024-03-10');
      const date = new Date(timestamp);

      // Should still be UTC midnight regardless of system timezone
      assert.strictEqual(date.getUTCHours(), 0);
      assert.strictEqual(date.getUTCMinutes(), 0);
    });

    it('should produce consistent results across different date ranges', () => {
      const dates = ['2024-01-01', '2024-06-15', '2024-12-31'];

      dates.forEach(dateStr => {
        const timestamp = parseUTCDateString(dateStr);
        const formatted = formatUTCTime(timestamp);

        // All should end with Z (UTC)
        assert.ok(formatted.endsWith('Z'), `Date ${dateStr} should be formatted as UTC`);

        // All should contain the date
        assert.ok(formatted.includes(dateStr), `Formatted string should contain ${dateStr}`);
      });
    });
  });
});
