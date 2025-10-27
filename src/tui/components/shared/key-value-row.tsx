import React from 'react';
import { Box, Text } from 'ink';

interface KeyValueRowProps {
  label?: string;
  value: string | number;
  valueColor?: string;
  bold?: boolean;
  marginBottom?: number;
}

export function KeyValueRow({ 
  label, 
  value, 
  valueColor = 'white', 
  bold = false,
  marginBottom = 0 
}: KeyValueRowProps) {
  if (!label) {
    return <Box marginBottom={marginBottom} />;
  }

  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={marginBottom}>
      <Text>{label}</Text>
      <Text bold={bold} color={valueColor}>
        {value}
      </Text>
    </Box>
  );
}

