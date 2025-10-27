import React from 'react';
import { Box, Text } from 'ink';
import { LogEntry } from '../../types.js';
import { formatTime } from '../../utils/format-utils.js';

interface LogsPanelProps {
  logs: LogEntry[];
  scrollOffset?: number;
}

export function LogsPanel({ logs, scrollOffset = 0 }: LogsPanelProps) {
  if (logs.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No logs yet</Text>
      </Box>
    );
  }

  const displayedLogs = logs.slice(scrollOffset, scrollOffset + 20);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        📋 Logs ({logs.length})
      </Text>

      <Box marginTop={1} flexDirection="column">
        {displayedLogs.map((log, index) => {
          const logColor =
            log.level === 'error'
              ? 'red'
              : log.level === 'warn'
              ? 'yellow'
              : log.level === 'success'
              ? 'green'
              : 'gray';

          return (
            <Box key={index} flexDirection="row">
              <Box width={8}>
                <Text color="gray" dimColor>{formatTime(log.timestamp)}</Text>
              </Box>
              <Box width={8}>
                <Text color={logColor} bold>
                  {log.level.toUpperCase()}
                </Text>
              </Box>
              <Box flexGrow={1}>
                <Text>{log.message}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
