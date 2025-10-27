import React from 'react';
import { Box } from 'ink';
import { AccountPanel } from '../components/panels/account-panel.js';
import { PositionsPanel } from '../components/panels/positions-panel.js';
import { MarketPanel } from '../components/panels/market-panel.js';
import { SignalsPanel } from '../components/panels/signals-panel.js';
import { LogsPanel } from '../components/panels/logs-panel.js';
import { StatusBar } from '../components/panels/status-bar.js';
import { TUIState } from '../types.js';

interface DashboardLayoutProps {
  state: TUIState;
}

export function DashboardLayout({ state }: DashboardLayoutProps) {
  return (
    <Box flexDirection="column" height="100%">
      <StatusBar status={state.systemStatus} />

      <Box flexGrow={1} flexDirection="row">
        {/* Left Column */}
        <Box flexDirection="column" width="50%" borderStyle="single">
          <AccountPanel account={state.account} />
          <PositionsPanel positions={state.positions} />
        </Box>

        {/* Right Column */}
        <Box flexDirection="column" width="50%" borderStyle="single">
          <MarketPanel marketData={state.marketData} />
          <SignalsPanel signals={state.signals} />
        </Box>
      </Box>

      {/* Bottom - Logs */}
      <Box height={10} borderStyle="single">
        <LogsPanel logs={state.logs} />
      </Box>
    </Box>
  );
}
