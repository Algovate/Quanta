import React from 'react';
import { Box, Text } from 'ink';
import { OrderSnapshot } from '../../types.js';
import { formatCurrency, formatTime } from '../../utils/format-utils.js';
import { getSideIcon, getStatusIcon, getStatusColor, getSideColor } from '../../utils/icon-utils.js';
import { PanelHeader } from '../shared/panel-header.js';
import { EmptyState } from '../shared/empty-state.js';

interface OrdersPanelProps {
  orders: OrderSnapshot[];
}

export function OrdersPanel({ orders }: OrdersPanelProps) {
  if (orders.length === 0) {
    return (
      <Box flexDirection="column">
        <PanelHeader title="Recent Orders" count={0} />
        <EmptyState message="No recent orders" />
      </Box>
    );
  }

  // Show only recent orders (last 5)
  const recentOrders = orders.slice(0, 5);

  return (
    <Box flexDirection="column">
      <PanelHeader title="Recent Orders" count={orders.length} icon="📝" />

      <Box marginTop={1} flexDirection="column">
        {/* Orders - Compact format without headers */}
        {recentOrders.map((order, index) => {
          const sideColor = getSideColor(order.side);
          const statusColor = getStatusColor(order.status);
          const statusIcon = getStatusIcon(order.status);

          return (
            <Box key={index} flexDirection="row" marginBottom={0}>
              <Box width={7}>
                <Text color="gray" dimColor>
                  {formatTime(order.timestamp).split(' ')[1]}
                </Text>
              </Box>
              <Box width={4}>
                <Text color={sideColor}>{getSideIcon(order.side)}</Text>
              </Box>
              <Box width={8}>
                <Text bold>{order.symbol.split('/')[0]}</Text>
              </Box>
              <Box width={10}>
                <Text>{order.amount.toFixed(3)}</Text>
              </Box>
              <Box width={12}>
                <Text color="gray">
                  {order.price ? `${order.price.toFixed(0)}` : 'Market'}
                </Text>
              </Box>
              <Box width={8}>
                <Text color={statusColor}>
                  {statusIcon} {order.status.substring(0, 4).toUpperCase()}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

