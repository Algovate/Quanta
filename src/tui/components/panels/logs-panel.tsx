import React from 'react';
import { Box, Text } from 'ink';
import { LogEntry } from '../../types.js';
import { formatTime } from '../../utils/format-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { EmptyState } from '../shared/empty-state.js';
import { getLogIcon } from '../../utils/icon-utils.js';
import { getRiskColor } from '../../utils/color-utils.js';

interface LogsPanelProps {
  logs: LogEntry[];
  scrollOffset?: number;
}

export function LogsPanel({ logs, scrollOffset = 0 }: LogsPanelProps) {
  if (logs.length === 0) {
    return (
      <Box flexDirection="column">
        <PanelHeader title="Logs" count={0} icon="📋" />
        <EmptyState message="No logs yet" />
      </Box>
    );
  }

  // Limit to 6 most recent logs to prevent layout overflow
  const displayedLogs = logs.slice(scrollOffset, scrollOffset + 6);

  const getLogColor = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error':
        return 'red';
      case 'warn':
        return 'yellow';
      case 'success':
        return 'green';
      default:
        return 'gray';
    }
  };

  return (
    <Box flexDirection="column">
      <PanelHeader title="Logs" count={logs.length} icon="📋" />

      <Box marginTop={1} flexDirection="column">
        {displayedLogs.map((log, index) => {
          const logColor = getLogColor(log.level);

          return (
            <Box key={index} flexDirection="row">
              <Box width={6}>
                <Text color="gray" dimColor>
                  {formatTime(log.timestamp).split(' ')[1]}
                </Text>
              </Box>
              <Box width={2}>
                <Text color={logColor}>{getLogIcon(log.level)}</Text>
              </Box>
              <Box flexGrow={1}>
                <Text color={logColor}>
                  {log.message}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
