import chalk from 'chalk';

export function fmtMoney(value: number): string {
  return (
    '$' +
    value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return 'N/A';
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

export function fmtSharpeColor(ratio: number): string {
  if (ratio > 1) return chalk.green(ratio.toFixed(2));
  if (ratio > 0) return chalk.yellow(ratio.toFixed(2));
  return chalk.red(ratio.toFixed(2));
}

export function fmtWinRate(rate: number): string {
  if (rate >= 50) return chalk.green(`${rate.toFixed(1)}%`);
  return chalk.red(`${rate.toFixed(1)}%`);
}

export function fmtProfitFactor(factor: number): string {
  if (factor > 1) return chalk.green(factor.toFixed(2));
  return chalk.red(factor.toFixed(2));
}

export function fmtVolatilityColor(vol: number): string {
  if (vol > 5) return chalk.red.bold(vol.toFixed(2) + '%');
  if (vol > 2) return chalk.yellow(vol.toFixed(2) + '%');
  return chalk.green(vol.toFixed(2) + '%');
}

export function fmtPercentage(pct: number): string {
  if (pct >= 50) return chalk.green(pct.toFixed(1) + '%');
  if (pct >= 30) return chalk.yellow(pct.toFixed(1) + '%');
  return chalk.red(pct.toFixed(1) + '%');
}

export function winRateBar(rate: number): string {
  const barLength = 20;
  const filled = Math.round((rate / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  const colored = rate >= 50 ? chalk.green(bar) : chalk.red(bar);
  return `${colored} ${fmtWinRate(rate)}`;
}
