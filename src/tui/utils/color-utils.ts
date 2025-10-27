// Color utilities for TUI

export function getPnLColor(value: number): string {
  if (value > 0) return 'green';
  if (value < 0) return 'red';
  return 'gray';
}

export function getRiskColor(level: 'low' | 'medium' | 'high'): string {
  switch (level) {
    case 'low':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'high':
      return 'red';
    default:
      return 'gray';
  }
}

export function getSignalColor(action: string): string {
  switch (action) {
    case 'LONG':
      return 'green';
    case 'SHORT':
      return 'red';
    case 'CLOSE':
      return 'yellow';
    case 'HOLD':
      return 'blue';
    default:
      return 'gray';
  }
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'green';
  if (confidence >= 0.5) return 'yellow';
  return 'red';
}
