export type Timeframe =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'
  | '1w'
  | '1M';

export function normalizeTimeframe(tf: string): Timeframe | string {
  const t = tf.trim().toLowerCase();
  const mapping: Record<string, Timeframe> = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '6h',
    '12h': '12h',
    '1d': '1d',
    '1w': '1w',
    '1mth': '1M',
    '1mo': '1M',
    '1month': '1M',
    '1m_utc': '1m',
  };
  return mapping[t] || t;
}

export function timeframeToMs(tf: string): number {
  const t = normalizeTimeframe(tf) as string;
  const map: Record<string, number> = {
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h': 14_400_000,
    '6h': 21_600_000,
    '12h': 43_200_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
    '1M': 2_592_000_000, // approx 30d
  };
  return map[t] ?? 60_000;
}

export const OKX_SUPPORTED: Set<string> = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
  '1w',
  '1M',
]);

export const BINANCE_SUPPORTED: Set<string> = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
  '1w',
]);
