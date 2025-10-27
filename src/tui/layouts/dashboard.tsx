import React from 'react';
import { Box } from 'ink';
import { AccountPanel } from '../components/panels/account-panel.js';
import { PositionsPanel } from '../components/panels/positions-panel.js';
import { MarketPanel } from '../components/panels/market-panel.js';
import { SignalsPanel } from '../components/panels/signals-panel.js';
import { LogsPanel } from '../components/panels/logs-panel.js';
import { OrdersPanel } from '../components/panels/orders-panel.js';
import { PerformancePanel } from '../components/panels/performance-panel.js';
import { StatusBar } from '../components/panels/status-bar.js';
import { TUIState } from '../types.js';

interface DashboardLayoutProps {
  state: TUIState;
}

export function DashboardLayout({ state }: DashboardLayoutProps) {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Status bar with its own border */}
      <StatusBar status={state.systemStatus} />

      {/* Main content grid - single border container, NO internal borders */}
      <Box flexDirection="column" width="100%" flexGrow={1} borderStyle="single">
        {/* Top half - Account/Performance | Market (40% of content area) */}
        <Box flexDirection="row" height="40%">
          {/* Left: Account + Performance */}
          <Box width="50%" flexDirection="column" paddingX={1} paddingTop={1} paddingRight={2}>
            <AccountPanel account={state.account} />
            <PerformancePanel status={state.systemStatus} />
          </Box>

          {/* Right: Market (with extra left padding as visual separator) */}
          <Box width="50%" flexDirection="column" paddingX={2} paddingTop={1}>
            <MarketPanel marketData={state.marketData} />
          </Box>
        </Box>

        {/* Bottom half - Positions/Orders | Signals/Logs (60% of content area) */}
        <Box flexDirection="row" height="60%" paddingTop={1}>
          {/* Left: Positions + Orders */}
          <Box width="50%" flexDirection="column" paddingX={1} paddingY={1} paddingRight={2}>
            <PositionsPanel positions={state.positions} />
            <Box marginTop={1}>
              <OrdersPanel orders={state.orders} />
            </Box>
          </Box>

          {/* Right: Signals + Logs (with extra left padding as visual separator) */}
          <Box width="50%" flexDirection="column" paddingX={2} paddingY={1}>
            <SignalsPanel signals={state.signals} />
            <Box marginTop={1}>
              <LogsPanel logs={state.logs} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

