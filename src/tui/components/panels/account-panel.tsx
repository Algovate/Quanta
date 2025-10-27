import React from 'react';
import { Box } from 'ink';
import { AccountSnapshot } from '../../types.js';
import { formatCurrency, formatPercent } from '../../utils/format-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { EmptyState } from '../shared/empty-state.js';
import { KeyValueRow } from '../shared/key-value-row.js';

interface AccountPanelProps {
  account: AccountSnapshot | null;
}

export function AccountPanel({ account }: AccountPanelProps) {
  if (!account) {
    return (
      <Box flexDirection="column">
        <PanelHeader title="Account" icon="📊" />
        <EmptyState message="No account data" />
      </Box>
    );
  }

  const pnlColor = account.totalPnL >= 0 ? 'green' : 'red';
  const pnlSign = account.totalPnL >= 0 ? '+' : '';

  return (
    <Box flexDirection="column">
      <PanelHeader title="Account" icon="📊" timestamp={account.timestamp} />

      <Box marginTop={1} flexDirection="column">
        <KeyValueRow label="Balance:" value={formatCurrency(account.balance)} valueColor="white" bold />
        <KeyValueRow label="Equity:" value={formatCurrency(account.equity)} valueColor="magenta" bold />
        <KeyValueRow label="Available:" value={formatCurrency(account.availableMargin)} valueColor="green" />
        <KeyValueRow label="Used Margin:" value={formatCurrency(account.usedMargin)} valueColor="yellow" />
        <KeyValueRow 
          label="Margin Ratio:" 
          value={`${(account.marginRatio * 100).toFixed(1)}%`}
          valueColor={account.marginRatio > 0.9 ? 'red' : 'green'} 
          marginBottom={1}
        />
        <KeyValueRow 
          label="Total P&L:" 
          value={`${pnlSign}${formatCurrency(account.totalPnL)} (${pnlSign}${formatPercent((account.totalPnL / account.balance) * 100)})`}
          valueColor={pnlColor}
          bold 
        />
      </Box>
    </Box>
  );
}
