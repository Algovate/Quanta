import React from 'react';
import { Box, Text } from 'ink';
import { PositionSnapshot } from '../../types.js';
import { formatCurrency, formatPercent } from '../../utils/format-utils.js';
import { getSideColor } from '../../utils/icon-utils.js';
import { getPnLColor } from '../../utils/color-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { EmptyState } from '../shared/empty-state.js';

interface PositionsPanelProps {
  positions: PositionSnapshot[];
}

export function PositionsPanel({ positions }: PositionsPanelProps) {
  if (positions.length === 0) {
    return (
      <Box flexDirection="column">
        <PanelHeader title="Positions" count={0} icon="💼" />
        <EmptyState message="No positions yet" subMessage="Waiting for trading signals..." />
      </Box>
    );
  }

  const totalPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
  const totalPnLColor = totalPnL >= 0 ? 'green' : 'red';
  const totalPnLSign = totalPnL >= 0 ? '+' : '';
  const totalNotional = positions.reduce((sum, pos) => sum + pos.notional, 0);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        💼 Positions ({positions.length})
      </Text>
      <Box flexDirection="row" justifyContent="flex-end" marginBottom={1}>
        <Text bold color={totalPnLColor}>
          Total: {totalPnLSign}
          {formatCurrency(totalPnL)} ({formatPercent((totalPnL / totalNotional) * 100)})
        </Text>
      </Box>

      <Box flexDirection="column">
        {/* Header */}
        <Box flexDirection="row" marginBottom={1}>
          <Box width={6}>
            <Text bold color="gray">Side</Text>
          </Box>
          <Box width={7}>
            <Text bold color="gray">Coin</Text>
          </Box>
          <Box width={8}>
            <Text bold color="gray">Size</Text>
          </Box>
          <Box width={9}>
            <Text bold color="gray">Entry</Text>
          </Box>
          <Box width={9}>
            <Text bold color="gray">Current</Text>
          </Box>
          <Box width={10}>
            <Text bold color="gray">P&L (%)</Text>
          </Box>
          <Box width={8}>
            <Text bold color="gray">Lev</Text>
          </Box>
        </Box>

        {/* Positions */}
        {positions.map((position, index) => {
          const sideColor = getSideColor(position.side);
          const pnlColor = getPnLColor(position.unrealizedPnL);
          const sideText = position.side.toUpperCase();
          const pnlPercent = (position.unrealizedPnL / (position.entryPrice * position.size)) * 100;

          return (
            <Box key={index} flexDirection="row">
              <Box width={6}>
                <Text color={sideColor}>{sideText}</Text>
              </Box>
              <Box width={7}>
                <Text>{position.coin}</Text>
              </Box>
              <Box width={8}>
                <Text>{position.size.toFixed(4)}</Text>
              </Box>
              <Box width={9}>
                <Text>${position.entryPrice.toFixed(2)}</Text>
              </Box>
              <Box width={9}>
                <Text>${position.currentPrice.toFixed(2)}</Text>
              </Box>
              <Box width={10}>
                <Text color={pnlColor}>
                  {pnlPercent >= 0 ? '+' : ''}
                  {pnlPercent.toFixed(2)}%
                </Text>
              </Box>
              <Box width={8}>
                <Text color="gray">{position.leverage}x</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
