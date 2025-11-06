export { HistoricalDataProvider } from './historical.js';
export * from './historical-providers/index.js';
export {
  MarketDataProvider,
  type MarketData,
  type TechnicalIndicators,
  type Candlestick,
} from './market.js';
export {
  StreamingIngestion,
  type StreamingConfig,
  type StreamTimeframe,
  type GapInfo,
} from './streaming.js';

export type { NewsSource, UnifiedNewsEvent, NewsIngestionConfig } from './news/types.js';
export { NewsStore } from './news/news-store.js';
export { NewsIngestor } from './news/news-ingestor.js';
