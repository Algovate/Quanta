import React from 'react';
import { Box, Text } from 'ink';
import { SignalSnapshot } from '../../types.js';
import { getSignalColor, getConfidenceColor } from '../../utils/color-utils.js';
import { formatRelativeTime } from '../../utils/format-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { EmptyState } from '../shared/empty-state.js';

interface SignalsPanelProps {
  signals: SignalSnapshot[];
}

export function SignalsPanel({ signals }: SignalsPanelProps) {
  if (signals.length === 0) {
    return (
      <Box flexDirection="column">
        <PanelHeader title="AI Signals" count={0} icon="🤖" />
        <EmptyState message="No signals yet" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <PanelHeader title="AI Signals" count={signals.length} icon="🤖" />

      <Box marginTop={1} flexDirection="column">
        {signals.slice(0, 4).map((signal, index) => {
          const signalColor = getSignalColor(signal.action);
          const confidenceColor = getConfidenceColor(signal.confidence);

          return (
            <Box key={index} flexDirection="row" marginBottom={0}>
              <Box width={6}>
                <Text color={signalColor}>{signal.action}</Text>
              </Box>
              <Box width={6}>
                <Text bold>{signal.coin}</Text>
              </Box>
              <Box width={8}>
                <Text color={confidenceColor}>{(signal.confidence * 100).toFixed(0)}%</Text>
              </Box>
              <Box width={8}>
                <Text color="gray" dimColor>
                  {formatRelativeTime(signal.timestamp)}
                </Text>
              </Box>
              <Box width={8}>
                <Text color={signal.executed ? 'green' : 'yellow'}>
                  {signal.executed ? '✓' : '⏳'}
                </Text>
              </Box>
            </Box>
          );
        })}
        {signals.length > 4 && (
          <Text color="gray" dimColor italic>
            ... and {signals.length - 4} more
          </Text>
        )}
      </Box>
    </Box>
  );
}
