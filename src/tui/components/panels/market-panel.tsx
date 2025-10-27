import React from 'react';
import { Box, Text } from 'ink';
import { MarketDataSnapshot } from '../../types.js';
import { formatCurrency, formatPercent } from '../../utils/format-utils.js';

interface MarketPanelProps {
  marketData: MarketDataSnapshot[];
}

export function MarketPanel({ marketData }: MarketPanelProps) {
  if (marketData.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No market data</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        📈 Market Data
      </Text>

      <Box marginTop={1} flexDirection="column">
        {marketData.map((data, index) => {
          const trendColor = data.trend === 'bullish' ? 'green' : data.trend === 'bearish' ? 'red' : 'yellow';
          const volatilityColor = data.volatility === 'high' ? 'red' : data.volatility === 'medium' ? 'yellow' : 'green';

          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold>{data.coin}</Text>
                <Text color="white">
                  {formatCurrency(data.currentPrice)}
                </Text>
              </Box>

              <Box marginLeft={2} flexDirection="column">
                <Box flexDirection="row">
                  <Text color="gray">Trend: </Text>
                  <Text color={trendColor}>{data.trend.toUpperCase()}</Text>
                </Box>

                <Box flexDirection="row">
                  <Text color="gray">Volatility: </Text>
                  <Text color={volatilityColor}>{data.volatility.toUpperCase()}</Text>
                </Box>

                <Box flexDirection="row" marginTop={1}>
                  <Text color="gray">
                    EMA20: {formatCurrency(data.indicators.ema20)}
                  </Text>
                  <Text color="gray"> </Text>
                  <Text color="gray">
                    EMA50: {formatCurrency(data.indicators.ema50)}
                  </Text>
                </Box>

                <Box flexDirection="row">
                  <Text color="gray">
                    RSI(14): {data.indicators.rsi14.toFixed(1)}
                  </Text>
                  <Text color="gray"> </Text>
                  <Text color="gray">
                    MACD: {data.indicators.macd.toFixed(4)}
                  </Text>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
