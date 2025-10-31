import { getConfig } from '../config/settings.js';
import { Exchange } from '../exchange/types.js';

export async function createExchangeForMode(): Promise<Exchange> {
  const config = getConfig();
  const { SimulatorExchange } = await import('../exchange/simulator.js');
  const { PaperExchange } = await import('../exchange/paper.js');

  const mode = config.mode || 'simulation';
  const exchangeName = config.exchange?.name || 'simulator';
  const exchangeApiKey = config.exchange?.apiKey;
  const exchangeApiSecret = config.exchange?.apiSecret;
  const exchangeTestnet = config.exchange?.testnet ?? true;

  async function createRealExchange(name: string): Promise<Exchange> {
    const normalized = name.toLowerCase();
    if (normalized === 'simulator') return new SimulatorExchange(10000) as unknown as Exchange;
    const module = await import(`../exchange/${normalized}.js`);
    const ExchangeClass = Object.values(module)[0] as any;
    return new (ExchangeClass as any)(
      exchangeApiKey,
      exchangeApiSecret,
      exchangeTestnet
    ) as Exchange;
  }

  if (mode === 'simulation') {
    return new SimulatorExchange(10000) as unknown as Exchange;
  }
  if (mode === 'paper') {
    if (exchangeName === 'simulator') {
      throw new Error(
        'Paper mode requires a real exchange for data. Set exchange.name to okx/binance/etc.'
      );
    }
    const dataExchange = await createRealExchange(exchangeName);
    return new PaperExchange(dataExchange as any, 10000) as unknown as Exchange;
  }
  // live
  if (exchangeName === 'simulator') {
    throw new Error('Live mode cannot use simulator. Configure a real exchange.');
  }
  return await createRealExchange(exchangeName);
}

export function describeExchange(exchange: any, testnet: boolean): string | undefined {
  const getName = (exchange as any)?.getExchangeName?.() as string | undefined;
  if (!getName) return undefined;
  if (getName === 'simulator') return 'Simulator';
  if (getName.startsWith('paper(')) {
    const inner = getName.slice(6, -1);
    const innerName = inner?.toUpperCase?.() || inner;
    const net = testnet ? ', testnet' : '';
    return `Paper (${innerName}${net})`;
  }
  return getName;
}
