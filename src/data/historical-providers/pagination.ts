import type { Candlestick } from '../../types/index.js';
import { timeframeToMs } from '../timeframes.js';

export interface PaginateParams {
  fetch: (since: number, limit: number) => Promise<number[][]>; // ccxt OHLCV raw
  startMs: number;
  endMs: number;
  limitPerPage: number;
  maxPages?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  map: (raw: number[]) => Candlestick;
  onProgress?: (info: { pages: number; candles: number; elapsedSec: number }) => void;
}

export async function paginateOHLCV(
  params: PaginateParams,
  timeframe: string
): Promise<Candlestick[]> {
  const { fetch, startMs, endMs, limitPerPage, maxPages = 1000, map, log, onProgress } = params;
  const all: Candlestick[] = [];
  const seen = new Set<number>();
  let since = startMs;
  let pages = 0;
  const step = timeframeToMs(timeframe);
  const startTime = Date.now();
  let lastProgressUpdate = 0;
  const PROGRESS_UPDATE_INTERVAL_MS = 1000;

  while (since < endMs && pages < maxPages) {
    pages++;
    const raw = await fetch(since, limitPerPage);
    if (!raw || raw.length === 0) break;
    const candles = raw.map(map).sort((a, b) => a.timestamp - b.timestamp);

    let added = 0;
    for (const c of candles) {
      if (c.timestamp >= startMs && c.timestamp <= endMs && !seen.has(c.timestamp)) {
        seen.add(c.timestamp);
        all.push(c);
        added++;
      }
    }

    // Emit progress callback (throttled to every 1 second or on first page)
    if (onProgress) {
      const now = Date.now();
      const elapsedSec = (now - startTime) / 1000;
      const shouldUpdate = pages === 1 || now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL_MS;

      if (shouldUpdate) {
        onProgress({
          pages,
          candles: all.length,
          elapsedSec,
        });
        lastProgressUpdate = now;
      }
    }

    const newest = candles[candles.length - 1]?.timestamp ?? since;
    if (newest >= endMs || candles.length < limitPerPage) break;

    const next = newest + step;
    if (next <= since) {
      log?.('pagination_stall', { since, next, newest });
      break;
    }
    if (added === 0 && pages > 1) {
      log?.('no_new_candles', { since, next, newest });
      break;
    }
    since = next;
    await new Promise(r => setTimeout(r, 100));
  }

  // Emit final progress update
  if (onProgress) {
    const elapsedSec = (Date.now() - startTime) / 1000;
    onProgress({
      pages,
      candles: all.length,
      elapsedSec,
    });
  }

  return all.sort((a, b) => a.timestamp - b.timestamp);
}
