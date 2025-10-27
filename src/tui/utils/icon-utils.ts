// Icon and symbol utilities for TUI display

export function getSideIcon(side: 'long' | 'short' | 'buy' | 'sell'): string {
  if (side === 'buy' || side === 'long') return '🟢';
  if (side === 'sell' || side === 'short') return '🔴';
  return '⚪';
}

export function getStatusIcon(status: string): string {
  switch (status) {
    case 'filled':
      return '✓';
    case 'cancelled':
      return '✗';
    case 'open':
      return '⏳';
    default:
      return '•';
  }
}

export function getLogIcon(level: 'info' | 'warn' | 'error' | 'success'): string {
  switch (level) {
    case 'error':
      return '✗';
    case 'warn':
      return '⚠';
    case 'success':
      return '✓';
    case 'info':
    default:
      return '·';
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'filled':
      return 'green';
    case 'cancelled':
      return 'red';
    case 'open':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function getSideColor(side: 'long' | 'short' | 'buy' | 'sell'): string {
  return side === 'long' || side === 'buy' ? 'green' : 'red';
}

