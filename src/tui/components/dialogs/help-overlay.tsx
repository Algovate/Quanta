import React from 'react';
import { Box, Text } from 'ink';

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  return (
    <Box flexDirection="column" padding={2} borderStyle="double" borderColor="cyan">
      <Text bold color="cyan" underline>
        Keyboard Shortcuts
      </Text>

      <Box flexDirection="column">
        <Box flexDirection="column">
          <Text bold color="yellow">System Control:</Text>
          <Text color="white">  p          : Pause/Resume trading cycles</Text>
          <Text color="white">  q          : Quit (graceful shutdown)</Text>
          <Text color="white">  r          : Force refresh / new cycle</Text>
          <Text color="white">  s          : Stop trading</Text>
        </Box>

        <Box flexDirection="column">
          <Text bold color="yellow">View Controls:</Text>
          <Text color="white">  h / ?      : Show/hide this help</Text>
          <Text color="white">  1-7        : Switch views (TODO)</Text>
        </Box>

        <Box flexDirection="column">
          <Text bold color="yellow">TUI Panels:</Text>
          <Text color="white">  Left Top   : Account & Balance</Text>
          <Text color="white">  Left Bottom: Open Positions</Text>
          <Text color="white">  Right Top  : Market Data</Text>
          <Text color="white">  Right Middle: AI Signals</Text>
          <Text color="white">  Bottom     : System Logs</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>Press 'h', '?', or 'q' to close this help</Text>
      </Box>
    </Box>
  );
}
