import React from 'react';
import { Box, Text } from 'ink';
import { SystemStatus } from '../../types.js';
import { formatDuration } from '../../utils/format-utils.js';

interface StatusBarProps {
  status: SystemStatus;
}

export function StatusBar({ status }: StatusBarProps) {
  const runtime = Date.now() - status.startTime;
  const statusColor = status.isPaused ? 'yellow' : status.isRunning ? 'green' : 'red';
  const statusText = status.isPaused ? 'PAUSED' : status.isRunning ? 'RUNNING' : 'STOPPED';

  return (
    <Box flexDirection="row" paddingX={1} paddingY={1} borderStyle="single">
      <Box flexDirection="row" marginRight={2}>
        <Text>Status: </Text>
        <Text bold color={statusColor}>
          {statusText}
        </Text>
      </Box>

      <Box flexDirection="row" marginRight={2}>
        <Text>Cycle: </Text>
        <Text bold>{status.cycleCount}</Text>
      </Box>

      <Box flexDirection="row" marginRight={2}>
        <Text>Runtime: </Text>
        <Text bold>{formatDuration(runtime)}</Text>
      </Box>

      <Box flexDirection="row" marginRight={2}>
        <Text>Signals: </Text>
        <Text bold>{status.totalSignals}</Text>
      </Box>

      <Box flexDirection="row" marginRight={2}>
        <Text>Trades: </Text>
        <Text bold>{status.totalTrades}</Text>
      </Box>

      <Box flexDirection="row" marginRight={2}>
        <Text>Win Rate: </Text>
        <Text bold>{status.winRate.toFixed(1)}%</Text>
      </Box>

      <Box flexDirection="row">
        <Text>Risk: </Text>
        <Text bold color={status.riskLevel === 'high' ? 'red' : status.riskLevel === 'medium' ? 'yellow' : 'green'}>
          {status.riskLevel.toUpperCase()}
        </Text>
      </Box>
    </Box>
  );
}
