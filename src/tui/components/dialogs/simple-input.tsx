import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface SimpleInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SimpleInput({ label, value, onChange, placeholder }: SimpleInputProps) {
  return (
    <Box flexDirection="column">
      <Text color="cyan">{label}:</Text>
      <Box borderStyle="single" paddingX={1}>
        <Text>{value || placeholder || ''}</Text>
        <Text color="gray">_</Text>
      </Box>
    </Box>
  );
}
