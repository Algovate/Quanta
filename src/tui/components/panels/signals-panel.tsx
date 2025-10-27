import React from 'react';
import { Box, Text } from 'ink';
import { SignalSnapshot } from '../../types.js';
import { getSignalColor, getConfidenceColor } from '../../utils/color-utils.js';
import { formatRelativeTime } from '../../utils/format-utils.js';

interface SignalsPanelProps {
  signals: SignalSnapshot[];
}

export function SignalsPanel({ signals }: SignalsPanelProps) {
  if (signals.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No signals yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        🤖 AI Signals
      </Text>

      <Box marginTop={1} flexDirection="column">
        {signals.slice(0, 10).map((signal, index) => {
          const signalColor = getSignalColor(signal.action);
          const confidenceColor = getConfidenceColor(signal.confidence);

          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text>
                  <Text color={signalColor}>{signal.action}</Text>
                  <Text> {signal.coin}</Text>
                </Text>
                <Text color="gray">{formatRelativeTime(signal.timestamp)}</Text>
              </Box>

              <Box marginLeft={2} flexDirection="column">
                <Box flexDirection="row">
                  <Text color="gray">Confidence: </Text>
                  <Text color={confidenceColor}>{(signal.confidence * 100).toFixed(1)}%</Text>
                </Box>

                <Text color="gray" dimColor>
                  {signal.reasoning}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
