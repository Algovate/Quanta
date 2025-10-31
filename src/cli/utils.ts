/**
 * Format a human-friendly exchange label for CLI output.
 * Accepts the exchange's reported name via getExchangeName() and whether testnet is enabled.
 * Examples:
 *  - 'simulator' => 'Simulator'
 *  - 'paper(okx)' (testnet=true) => 'Paper (OKX, testnet)'
 */
export function formatExchangeFriendlyName(
  exchangeReportedName: string | undefined,
  testnet: boolean
): string | undefined {
  if (!exchangeReportedName) return undefined;
  if (exchangeReportedName === 'simulator') return 'Simulator';
  if (exchangeReportedName.startsWith('paper(')) {
    const inner = exchangeReportedName.slice(6, -1);
    const innerName = inner?.toUpperCase?.() || inner;
    const net = testnet ? ', testnet' : '';
    return `Paper (${innerName}${net})`;
  }
  return exchangeReportedName;
}
