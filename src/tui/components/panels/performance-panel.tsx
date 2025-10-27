import React from 'react';
import { Box, Text } from 'ink';
import { SystemStatus } from '../../types.js';
import { formatCurrency } from '../../utils/format-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { KeyValueRow } from '../shared/key-value-row.js';

interface PerformancePanelProps {
  status: SystemStatus;
}

export function PerformancePanel({ status }: PerformancePanelProps) {
  const avgPnL = status.avgPnL || 0;
  const largestWin = status.largestWin || 0;
  const largestLoss = status.largestLoss || 0;
  const sharpeRatio = status.sharpeRatio || 0;
  const profitFactor = status.profitFactor || 0;

  return (
    <Box flexDirection="column" marginTop={1}>
      <PanelHeader title="Performance" icon="📊" />

      <Box marginTop={1} flexDirection="row">
        {/* Left column */}
        <Box flexDirection="column" width="50%" paddingRight={1}>
          <KeyValueRow 
            label="Win Rate:" 
            value={`${status.winRate.toFixed(1)}%`}
            valueColor={status.winRate >= 50 ? 'green' : 'red'}
            bold 
          />
          <KeyValueRow 
            label="Best:" 
            value={`+${formatCurrency(largestWin)}`}
            valueColor="green"
            bold 
          />
          <KeyValueRow 
            label="Sharpe:" 
            value={sharpeRatio.toFixed(2)}
            valueColor={sharpeRatio >= 1 ? 'green' : 'yellow'}
            bold 
          />
        </Box>

        {/* Right column */}
        <Box flexDirection="column" width="50%" paddingLeft={1}>
          <KeyValueRow 
            label="Avg P&L:" 
            value={`${avgPnL >= 0 ? '+' : ''}${formatCurrency(avgPnL)}`}
            valueColor={avgPnL >= 0 ? 'green' : 'red'}
            bold 
          />
          <KeyValueRow 
            label="Worst:" 
            value={formatCurrency(largestLoss)}
            valueColor="red"
            bold 
          />
          <KeyValueRow 
            label="P-Factor:" 
            value={profitFactor.toFixed(2)}
            valueColor={profitFactor >= 1 ? 'green' : 'red'}
            bold 
          />
        </Box>
      </Box>
    </Box>
  );
}

