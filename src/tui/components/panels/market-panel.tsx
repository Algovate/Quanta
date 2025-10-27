import React from 'react';
import { Box, Text } from 'ink';
import { MarketDataSnapshot } from '../../types.js';
import { formatCurrency, formatPercent } from '../../utils/format-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { EmptyState } from '../shared/empty-state.js';

interface MarketPanelProps {
  marketData: MarketDataSnapshot[];
}

export function MarketPanel({ marketData }: MarketPanelProps) {
  if (marketData.length === 0) {
    return (
      <Box flexDirection="column">
        <PanelHeader title="Market Data" count={0} icon="📈" />
        <EmptyState message="No market data" />
      </Box>
    );
  }

  // Remove duplicates by coin
  const uniqueData = Array.from(
    new Map(marketData.map((data) => [data.coin, data])).values()
  );

  return (
    <Box flexDirection="column">
      <PanelHeader title="Market Data" count={uniqueData.length} icon="📈" />

      <Box marginTop={1} flexDirection="column">
        {uniqueData.map((data, index) => {
          const trendColor = data.trend === 'bullish' ? 'green' : data.trend === 'bearish' ? 'red' : 'yellow';
          const changeColor = data.changePercent24h >= 0 ? 'green' : 'red';
          const volatilityColor = data.volatility === 'high' ? 'red' : data.volatility === 'medium' ? 'yellow' : 'green';

          const hasValidChange = Math.abs(data.changePercent24h) > 0.001;
          const hasValidVolume = data.volume24h > 0;

          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              {/* Compact single-line header */}
              <Box flexDirection="row" justifyContent="space-between" marginBottom={0}>
                <Text bold>{data.coin}</Text>
                <Text color="white">{formatCurrency(data.currentPrice)}</Text>
                <Text color={hasValidChange ? changeColor : 'gray'}>
                  {hasValidChange ? (
                    <>
                      {data.changePercent24h >= 0 ? '+' : ''}
                      {data.changePercent24h.toFixed(2)}%
                    </>
                  ) : (
                    '--'
                  )}
                </Text>
              </Box>

              {/* Secondary line with additional info */}
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexDirection="row">
                  <Text color={trendColor} dimColor>
                    {data.trend.substring(0, 4).toUpperCase()}
                  </Text>
                  <Text dimColor> / </Text>
                  <Text color={volatilityColor} dimColor>
                    {data.volatility.substring(0, 3).toUpperCase()}
                  </Text>
                </Box>
                <Text color="gray" dimColor>
                  {hasValidVolume ? `Vol: ${formatCurrency(data.volume24h)}` : 'Vol: N/A'}
                </Text>
              </Box>

              {/* Collapsed indicators - expandable on demand */}
              <Box flexDirection="row" marginTop={0}>
                <Text color="gray" dimColor>
                  EMA20/50: {formatCurrency(data.indicators.ema20)} / {formatCurrency(data.indicators.ema50)} • 
                  RSI: {data.indicators.rsi14.toFixed(1)} • 
                  MACD: {data.indicators.macd.toFixed(2)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
