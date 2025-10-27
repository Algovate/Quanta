import React from 'react';
import { Box, Text } from 'ink';
import { generateSparkline } from '../../utils/chart-utils.js';
import { formatCurrency } from '../../utils/format-utils.js';
import { getPnLColor } from '../../utils/color-utils.js';

interface PnLChartProps {
  data: number[];
  width?: number;
  height?: number;
}

export function PnLChart({ data, width = 40, height = 8 }: PnLChartProps) {
  if (data.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No P&L data</Text>
      </Box>
    );
  }

  const chart = generateSparkline(data, width, height);
  const maxValue = Math.max(...data, 0);
  const minValue = Math.min(...data, 0);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="cyan" bold>P&L Trend</Text>
        <Box flexDirection="row">
          <Text color="gray">Max: {formatCurrency(maxValue)}</Text>
          <Text color="gray"> </Text>
          <Text color="gray">Min: {formatCurrency(minValue)}</Text>
        </Box>
      </Box>

      {chart.map((line, index) => (
        <Text key={index} color={getPnLColor(data[data.length - 1])}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
