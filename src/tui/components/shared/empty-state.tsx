import React from 'react';
import { Box, Text } from 'ink';

interface EmptyStateProps {
  message: string;
  subMessage?: string;
}

export function EmptyState({ message, subMessage }: EmptyStateProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="gray">{message}</Text>
      {subMessage && (
        <Box marginTop={1}>
          <Text color="gray" dimColor italic>
            {subMessage}
          </Text>
        </Box>
      )}
    </Box>
  );
}

