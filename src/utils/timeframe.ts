export type MinuteTimeframe = '1m' | '3m' | '5m' | '15m';
export type HourTimeframe = '1h' | '4h';
export type Timeframe = MinuteTimeframe | HourTimeframe;

export function timeframeToMs(tf: Timeframe): number {
  switch (tf) {
    case '1m':
      return 60_000;
    case '3m':
      return 180_000;
    case '5m':
      return 300_000;
    case '15m':
      return 900_000;
    case '1h':
      return 3_600_000;
    case '4h':
      return 14_400_000;
    default:
      return 180_000;
  }
}

export function isTimeframe(value: string): value is Timeframe {
  return ['1m', '3m', '5m', '15m', '1h', '4h'].includes(value);
}
