import React from 'react';
import { Box, Text } from 'ink';
import { AccountSnapshot } from '../../types.js';
import { formatCurrency, formatPercent } from '../../utils/format-utils.js';

interface AccountPanelProps {
  account: AccountSnapshot | null;
}

export function AccountPanel({ account }: AccountPanelProps) {
  if (!account) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No account data</Text>
      </Box>
    );
  }

  const pnlColor = account.totalPnL >= 0 ? 'green' : 'red';
  const pnlSign = account.totalPnL >= 0 ? '+' : '';

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="cyan">
          📊 Account
        </Text>
        <Text color="gray">{new Date(account.timestamp).toLocaleTimeString()}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text>Balance:</Text>
          <Text bold color="white">
            {formatCurrency(account.balance)}
          </Text>
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Text>Equity:</Text>
          <Text bold color="magenta">
            {formatCurrency(account.equity)}
          </Text>
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Text>Available:</Text>
          <Text color="green">{formatCurrency(account.availableMargin)}</Text>
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Text>Used Margin:</Text>
          <Text color="yellow">{formatCurrency(account.usedMargin)}</Text>
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Text>Margin Ratio:</Text>
          <Text color={account.marginRatio > 0.9 ? 'red' : 'green'}>
            {(account.marginRatio * 100).toFixed(1)}%
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="row" justifyContent="space-between">
          <Text bold>Total P&L:</Text>
          <Text bold color={pnlColor}>
            {pnlSign}
            {formatCurrency(account.totalPnL)} ({pnlSign}
            {formatPercent((account.totalPnL / account.balance) * 100)})
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
