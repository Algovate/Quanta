import React from 'react';
import { Box, Text } from 'ink';

interface PanelHeaderProps {
  title: string;
  count?: number;
  timestamp?: number;
  icon?: string;
}

export function PanelHeader({ title, count, timestamp, icon }: PanelHeaderProps) {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold color="cyan">
        {icon && `${icon} `}{title}{count !== undefined && ` (${count})`}
      </Text>
      {timestamp && (
        <Text color="gray">{new Date(timestamp).toLocaleTimeString()}</Text>
      )}
    </Box>
  );
}

