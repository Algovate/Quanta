import React from 'react';
import { Box, Text } from 'ink';
import { PositionSnapshot } from '../../types.js';
import { formatCurrency, formatPercent } from '../../utils/format-utils.js';
import { getPnLColor } from '../../utils/color-utils.js';

interface PositionsPanelProps {
  positions: PositionSnapshot[];
}

export function PositionsPanel({ positions }: PositionsPanelProps) {
  if (positions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No open positions</Text>
      </Box>
    );
  }

  const totalPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
  const totalPnLColor = totalPnL >= 0 ? 'green' : 'red';
  const totalPnLSign = totalPnL >= 0 ? '+' : '';

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          💼 Positions ({positions.length})
        </Text>
        <Text bold color={totalPnLColor}>
          Total: {totalPnLSign}
          {formatCurrency(totalPnL)}
        </Text>
      </Box>

      <Box flexDirection="column">
        {/* Header */}
        <Box flexDirection="row" marginBottom={1}>
          <Box width={8}>
            <Text bold color="gray">
              Side
            </Text>
          </Box>
          <Box width={8}>
            <Text bold color="gray">
              Symbol
            </Text>
          </Box>
          <Box width={8}>
            <Text bold color="gray">
              Size
            </Text>
          </Box>
          <Box width={10}>
            <Text bold color="gray">
              Entry
            </Text>
          </Box>
          <Box width={10}>
            <Text bold color="gray">
              Current
            </Text>
          </Box>
          <Box width={10}>
            <Text bold color="gray">
              P&L
            </Text>
          </Box>
        </Box>

        {/* Positions */}
        {positions.map((position, index) => {
          const sideColor = position.side === 'long' ? 'green' : 'red';
          const pnlColor = getPnLColor(position.unrealizedPnL);
          const sideText = position.side.toUpperCase().padEnd(4);

          return (
            <Box key={index} flexDirection="row">
              <Box width={8}>
                <Text color={sideColor}>{sideText}</Text>
              </Box>
              <Box width={8}>
                <Text>{position.coin}</Text>
              </Box>
              <Box width={8}>
                <Text>{position.size.toFixed(4)}</Text>
              </Box>
              <Box width={10}>
                <Text>${position.entryPrice.toFixed(2)}</Text>
              </Box>
              <Box width={10}>
                <Text>${position.currentPrice.toFixed(2)}</Text>
              </Box>
              <Box width={10}>
                <Text color={pnlColor}>
                  {position.unrealizedPnL >= 0 ? '+' : ''}
                  {formatCurrency(position.unrealizedPnL)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
