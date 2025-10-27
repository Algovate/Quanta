import React from 'react';
import { Box, Text } from 'ink';
import { generateGauge } from '../../utils/chart-utils.js';
import { getRiskColor } from '../../utils/color-utils.js';

interface IndicatorGaugeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  width?: number;
  unit?: string;
}

export function IndicatorGauge({ label, value, min, max, width = 30 }: IndicatorGaugeProps) {
  const gauge = generateGauge(value, min, max, width);
  const percent = ((value - min) / (max - min)) * 100;
  
  let color = 'green';
  if (percent > 70) color = 'red';
  else if (percent > 50) color = 'yellow';

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="gray">{label}:</Text>
        <Text color={color} bold>{value.toFixed(2)}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={color}>{gauge}</Text>
      </Box>
    </Box>
  );
}

interface RSIProps {
  value: number;
}

export function RSI({ value }: RSIProps) {
  return <IndicatorGauge label="RSI(14)" value={value} min={0} max={100} />;
}

interface MACDProps {
  macd: number;
  signal: number;
}

export function MACD({ macd, signal }: MACDProps) {
  const diff = Math.abs(macd - signal);
  const max = Math.max(Math.abs(macd), Math.abs(signal), 0.1);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="gray">MACD:</Text>
        <Box flexDirection="row">
          <Text color={macd >= 0 ? 'green' : 'red'}>{macd.toFixed(4)}</Text>
          <Text color="gray"> / </Text>
          <Text color={signal >= 0 ? 'green' : 'red'}>{signal.toFixed(4)}</Text>
        </Box>
      </Box>
    </Box>
  );
}
